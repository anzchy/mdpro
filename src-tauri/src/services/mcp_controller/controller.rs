//! Purpose: `McpController`, the one owner of the MCP server's lifecycle
//! (ADR-0040 WI-3): serialized start/stop/reconcile, a lock-free-to-read
//! snapshot, and the in-memory token the auth middleware reads.
//!
//! Pipeline: `reconcile(enabled, make_router)` -> the async transition lock
//! (its first await, PC-8) -> `start_locked` / `stop_locked` in
//! `transitions.rs` -> the snapshot cell.
//!
//! Key decisions:
//! - Transitions are serialized by a FIFO `tokio::sync::Mutex<Inner>`; the
//!   snapshot has its own `std::sync::Mutex`, so `snapshot()` never waits on
//!   a transition (it answers while `stop` is parked in drain).
//! - `exiting` is an `AtomicBool` outside both locks: once set, no start
//!   binds, and a start already past bind never leaves files published
//!   (PC-2): it checks before publishing and re-checks after, taking the
//!   files back if `begin_exit` landed in between (M2). `begin_exit` sets
//!   it and unpublishes without taking the transition lock; app exit then
//!   waits on `stop` for at most `exit_budget` (WI-5).
//! - `ControllerEnv::pre_publish` is a `#[cfg(test)]` seam that parks a
//!   start in that window, and `post_serve_exit` one that parks a serve
//!   task right after it applied its own exit (D205); production builds
//!   have neither field.
//! - `switch_lock` (a `tokio::sync::Mutex<()>`) serializes whole switches
//!   in `switch.rs` (WI-7b), so a persist and its reconcile are never split
//!   by another switch. Only the switch takes it; launch and exit do not.
//! - Parameterised by `ControllerEnv` (address, files dir, budgets, serve
//!   seam), never `dirs::data_dir()` or an `AppHandle`, so tests run on
//!   `127.0.0.1` and a temp dir.
//! - `ControllerEnv::stop_hook` (ADR-0042, `with_stop_hook`) is told
//!   `ServerStop` before a live server is halted and `AppExit` from
//!   `begin_exit`, so pending MCP write confirmations end while their
//!   connections can still carry the answer. `None` (the default) changes
//!   nothing; the controller does not know what the hook does.
//!
//! @coordinates-with src/services/mcp_controller/transitions.rs
//! @coordinates-with src/services/mcp_controller/snapshot.rs
//! @coordinates-with src/services/mcp_controller/launch.rs (launch)
//! @coordinates-with src/services/app_exit.rs (exit)
//! @coordinates-with src/services/mcp_confirm/mod.rs (`stop_hook`)
//! @coordinates-with src/services/http_server.rs (`with_token_auth` reads
//!   the shared config this controller writes)

use crate::models::{ServerConfig, SharedServerConfig};
use crate::services::mcp_controller::files;
use crate::services::mcp_controller::killable::{default_serve, ServeFn};
use crate::services::mcp_controller::snapshot::{
    McpPhase, McpSnapshot, SnapshotCell, SnapshotError,
};
use axum::Router;
use std::future::Future;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// How long `stop` waits for in-flight requests before killing them.
pub const DRAIN: Duration = Duration::from_secs(2);
/// How long `stop` waits for killed connections to close before aborting.
pub const JOIN_GRACE: Duration = Duration::from_secs(1);
/// The most app exit may wait on the controller (WI-5). Must exceed
/// `DRAIN + JOIN_GRACE`.
pub const EXIT_BUDGET: Duration = Duration::from_secs(4);

/// Where and how the controller runs its server.
#[derive(Clone)]
pub struct ControllerEnv {
    /// Address to bind. The app uses `127.0.0.1:55045`, or port 0 (ephemeral)
    /// in a `verify-run` build (`http_server::mcp_server_port`).
    pub bind_addr: SocketAddr,
    /// Directory `server.port` / `server.token` are published into.
    pub files_dir: PathBuf,
    /// Graceful drain budget of `stop`.
    pub drain: Duration,
    /// Budget for killed connections to close after the drain.
    pub join_grace: Duration,
    /// Budget app exit gives the controller (used from WI-5).
    pub exit_budget: Duration,
    /// Runs the server on a bound listener. Tests wrap the real one.
    pub serve: ServeFn,
    /// Told before a live server stops and when the app begins to exit
    /// (ADR-0042), so pending confirmations end before connections die.
    pub stop_hook: Option<StopHook>,
    /// Test-only: runs inside `start` between its last `exiting` check and
    /// the publish, so a test can land `begin_exit` in that window (M2).
    #[cfg(test)]
    pub(crate) pre_publish: Option<PrePublishHook>,
    /// Test-only: runs in a serve task right after it applied its own exit
    /// to the snapshot, so a test can look at the files and the token, or
    /// start the next generation, in that moment (D205).
    #[cfg(test)]
    pub(crate) post_serve_exit: Option<PrePublishHook>,
}

/// Why the controller is ending in-flight work (ADR-0042).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopCause {
    /// A live server is stopping (switch off, restart); a later start may
    /// serve again.
    ServerStop,
    /// The app is exiting; nothing will be served again.
    AppExit,
}

/// The `stop_hook` callback.
pub type StopHook = Arc<dyn Fn(StopCause) + Send + Sync>;

/// The `pre_publish` and `post_serve_exit` test seams.
#[cfg(test)]
pub(crate) type PrePublishHook = Arc<dyn Fn() + Send + Sync>;

impl ControllerEnv {
    /// The production budgets and serve seam for `bind_addr` / `files_dir`.
    pub fn new(bind_addr: SocketAddr, files_dir: PathBuf) -> Self {
        ControllerEnv {
            bind_addr,
            files_dir,
            drain: DRAIN,
            join_grace: JOIN_GRACE,
            exit_budget: EXIT_BUDGET,
            serve: default_serve(),
            stop_hook: None,
            #[cfg(test)]
            pre_publish: None,
            #[cfg(test)]
            post_serve_exit: None,
        }
    }

    /// Install the stop hook (production: `mcp_confirm::stop_hook`).
    pub fn with_stop_hook(mut self, hook: StopHook) -> Self {
        self.stop_hook = Some(hook);
        self
    }
}

/// State guarded by the transition lock.
#[derive(Default)]
pub(super) struct Inner {
    /// The live (or dead but not yet joined) server, if any.
    pub(super) server: Option<super::transitions::RunningServer>,
    /// Start attempts so far; the snapshot's `generation`.
    pub(super) generation: u64,
}

/// The MCP server's lifecycle owner.
pub struct McpController {
    pub(super) env: ControllerEnv,
    pub(super) inner: Arc<tokio::sync::Mutex<Inner>>,
    pub(super) snapshot: Arc<SnapshotCell>,
    pub(super) server_config: SharedServerConfig,
    pub(super) exiting: AtomicBool,
    /// Serializes whole switches (persist + reconcile + status, WI-7b);
    /// only `switch.rs` takes it. Distinct from the transition lock, which
    /// guards one reconcile and is not held across the persist.
    pub(super) switch_lock: tokio::sync::Mutex<()>,
}

impl McpController {
    pub fn new(env: ControllerEnv) -> Self {
        McpController {
            env,
            inner: Arc::new(tokio::sync::Mutex::new(Inner::default())),
            snapshot: Arc::new(Mutex::new(McpSnapshot::initial())),
            server_config: Arc::new(Mutex::new(None)),
            exiting: AtomicBool::new(false),
            switch_lock: tokio::sync::Mutex::new(()),
        }
    }

    /// The current state. Never waits on a transition.
    pub fn snapshot(&self) -> Result<McpSnapshot, SnapshotError> {
        super::snapshot::read(&self.snapshot)
    }

    /// The shared config the router's auth layer must read.
    pub fn shared_config(&self) -> SharedServerConfig {
        self.server_config.clone()
    }

    /// The in-memory port and token, if a server is live. A poisoned config
    /// lock reads as `None`, the same fail-closed answer auth gives.
    pub fn server_config(&self) -> Option<ServerConfig> {
        self.server_config
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
    }

    /// Mark the app as exiting: no later start binds or publishes.
    pub fn mark_exiting(&self) {
        self.exiting.store(true, Ordering::SeqCst);
    }

    /// The exit's first step, outside the transition lock (WI-5): mark
    /// exiting, tell the stop hook `AppExit` (ADR-0042: pending
    /// confirmations end before the exit's stop waits), remove the server
    /// files and forget the token, so they are gone even while a
    /// transition holds the lock.
    pub fn begin_exit(&self) {
        self.mark_exiting();
        self.notify_stop(StopCause::AppExit);
        files::unpublish(&self.env.files_dir);
        if let Ok(mut guard) = self.server_config.lock() {
            *guard = None;
        }
    }

    /// Run the stop hook, if one is installed.
    pub(super) fn notify_stop(&self, cause: StopCause) {
        if let Some(hook) = &self.env.stop_hook {
            hook(cause);
        }
    }

    /// How long app exit may wait on `stop`.
    pub fn exit_budget(&self) -> Duration {
        self.env.exit_budget
    }

    /// Bring the server to `enabled`: on + Running and off + Disabled are
    /// no-ops; on from Disabled/Failed starts; off from anything else stops.
    pub async fn reconcile<F, Fut>(
        &self,
        enabled: bool,
        make_router: F,
    ) -> Result<McpSnapshot, SnapshotError>
    where
        F: FnOnce(SharedServerConfig) -> Fut + Send,
        Fut: Future<Output = Router> + Send,
    {
        let mut inner = self.inner.lock().await;
        let phase = self.snapshot()?.phase;
        match (enabled, phase) {
            (true, McpPhase::Running) | (false, McpPhase::Disabled) => {}
            (true, _) => self.start_locked(&mut inner, make_router).await,
            (false, _) => self.stop_locked(&mut inner).await,
        }
        self.snapshot()
    }

    /// Start a server (stopping a previous one first).
    pub async fn start<F, Fut>(&self, make_router: F) -> Result<McpSnapshot, SnapshotError>
    where
        F: FnOnce(SharedServerConfig) -> Fut + Send,
        Fut: Future<Output = Router> + Send,
    {
        let mut inner = self.inner.lock().await;
        self.start_locked(&mut inner, make_router).await;
        self.snapshot()
    }

    /// Stop the server, if any. Bounded by `drain + join_grace + ε`.
    pub async fn stop(&self) -> Result<McpSnapshot, SnapshotError> {
        let mut inner = self.inner.lock().await;
        self.stop_locked(&mut inner).await;
        self.snapshot()
    }

    /// True iff the transition lock is free right now (L-2c).
    #[cfg(test)]
    pub(crate) fn inner_try_lock_for_test(&self) -> bool {
        self.inner.try_lock().is_ok()
    }

    /// Poison the snapshot lock: a thread panics while holding it (C-11).
    #[cfg(test)]
    pub(crate) fn poison_snapshot_for_test(&self) {
        let cell = self.snapshot.clone();
        let _ = std::thread::spawn(move || {
            let _guard = cell.lock();
            panic!("poisoning the snapshot lock on purpose");
        })
        .join();
    }

    /// Overwrite the snapshot (L-7's `Stopping` row).
    #[cfg(test)]
    pub(crate) fn set_snapshot_for_test(&self, snap: McpSnapshot) {
        super::snapshot::write(&self.snapshot, snap);
    }
}
