//! Purpose: the controller's start and stop transitions (ADR-0040 WI-3).
//! Every function here runs with the transition lock held (`&mut Inner`).
//!
//! Pipeline:
//! - start: generation += 1, `Starting` -> bind -> router factory (PC-8) ->
//!   `exiting` check (PC-2) -> fresh token into memory -> spawn (watched) ->
//!   `exiting` check -> publish -> `exiting` re-check (unpublish + halt if
//!   set) -> `Running`.
//! - stop (a live server only): stop hook `ServerStop` -> `Stopping` ->
//!   unpublish (port, then token) -> clear the token ->
//!   graceful shutdown -> wait `drain` -> kill every connection (PC-1) ->
//!   wait `join_grace` -> abort -> `Disabled`, only after the join.
//!
//! Key decisions:
//! - The serve task watches itself: when its future returns, it applies
//!   `apply_serve_exit` with the generation captured at spawn (PC-5), and
//!   if that turned the snapshot `Failed` it unpublishes and clears the
//!   token inside that same snapshot update. A reader that sees this
//!   generation `Failed` therefore never finds its files or token, and a
//!   next generation (which must write `Starting` through the same cell
//!   first) never loses its files or token to an older one (D205). Files
//!   can still be present while a start is `Starting`, and `begin_exit`
//!   removes them without the cell. An abort (`Cancelled`) never runs
//!   that code.
//! - Nothing is published once `exiting` is set, and a start whose server
//!   died before it could report `Running` removes what it published.
//!   `begin_exit` runs outside the transition lock, so it can land between
//!   the pre-publish check and the publish; the post-publish re-check then
//!   unpublishes, clears the token and ends `Disabled` (final review M2).
//! - Every await is bounded: `drain`, `join_grace`, `ABORT_JOIN`.
//! - The stop hook runs in `stop_locked`, so every stop path (stop, off,
//!   restart) takes it, and before `Stopping` and `halt` (ADR-0042 F2): a
//!   waiting confirmation is answered 503 over a live connection, and a
//!   request gated after it is bounded by the drain and the kill.
//!
//! @coordinates-with src/services/mcp_controller/controller.rs (the lock)
//! @coordinates-with src/services/mcp_controller/killable.rs (kill switch)
//! @coordinates-with src/services/mcp_controller/files.rs (publish/unpublish)

use crate::models::{ServerConfig, SharedServerConfig};
use crate::services::mcp_controller::controller::{Inner, McpController, StopCause};
use crate::services::mcp_controller::files;
use crate::services::mcp_controller::killable::{KillSwitch, KillableListener, ServeFuture};
use crate::services::mcp_controller::serve::{self, BindError, ServeHandle};
use crate::services::mcp_controller::snapshot::{
    self as snap, apply_serve_exit, McpPhase, McpServerError, McpSnapshot, ServeExit,
};
use axum::Router;
use std::future::Future;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::oneshot;
use tokio::time::timeout;

/// How long `stop` waits for an aborted serve task to be dropped.
const ABORT_JOIN: Duration = Duration::from_millis(100);

/// A spawned server of one generation.
pub(crate) struct RunningServer {
    shutdown: oneshot::Sender<()>,
    handle: ServeHandle,
    kill: Arc<KillSwitch>,
}

fn at(phase: McpPhase, port: Option<u16>, error: Option<McpServerError>, gen: u64) -> McpSnapshot {
    McpSnapshot {
        phase,
        port,
        error,
        generation: gen,
    }
}

/// Set the in-memory config. A poisoned lock is left as is: auth already
/// rejects every request through a poisoned config (fail-closed).
fn set_config(config: &SharedServerConfig, value: Option<ServerConfig>) {
    if let Ok(mut guard) = config.lock() {
        *guard = value;
    }
}

impl McpController {
    pub(super) async fn start_locked<F, Fut>(&self, inner: &mut Inner, make_router: F)
    where
        F: FnOnce(SharedServerConfig) -> Fut + Send,
        Fut: Future<Output = Router> + Send,
    {
        if inner.server.is_some() {
            self.stop_locked(inner).await;
        }
        if self.exiting.load(Ordering::SeqCst) {
            return;
        }
        inner.generation += 1;
        let gen = inner.generation;
        snap::write(&self.snapshot, at(McpPhase::Starting, None, None, gen));

        let bound = serve::bind(self.env.bind_addr).await;
        let port = bound.as_ref().ok().and_then(|l| l.local_addr().ok());
        let (listener, port) = match (bound, port) {
            (Ok(listener), Some(addr)) => (listener, addr.port()),
            (Err(BindError::InUse), _) => return self.fail(McpServerError::BindInUse, gen),
            (Err(BindError::Other), _) | (Ok(_), None) => {
                return self.fail(McpServerError::BindFailed, gen)
            }
        };

        let router = make_router(self.server_config.clone()).await;
        if self.exiting.load(Ordering::SeqCst) {
            drop(listener);
            snap::write(&self.snapshot, at(McpPhase::Disabled, None, None, gen));
            return;
        }

        let token = serve::generate_token();
        let config = ServerConfig {
            port,
            token: token.clone(),
        };
        set_config(&self.server_config, Some(config));
        let (shutdown, rx) = oneshot::channel();
        let kill = KillSwitch::new();
        let served = (self.env.serve)(KillableListener::new(listener, kill.clone()), router, rx);
        let server = RunningServer {
            shutdown,
            handle: self.spawn_watched(served, gen),
            kill,
        };

        if self.exiting.load(Ordering::SeqCst) {
            snap::write(&self.snapshot, at(McpPhase::Disabled, None, None, gen));
            set_config(&self.server_config, None);
            return self.halt(server, Duration::ZERO).await;
        }
        #[cfg(test)]
        if let Some(hook) = &self.env.pre_publish {
            hook();
        }
        if files::publish(&self.env.files_dir, port, &token).is_err() {
            self.fail(McpServerError::PublishFailed, gen);
            return self.halt(server, Duration::ZERO).await;
        }
        // `begin_exit` does not take the transition lock: if it ran between
        // the check above and the publish, its unpublish came first and the
        // publish re-created the files. Take them back and halt.
        if self.exiting.load(Ordering::SeqCst) {
            files::unpublish(&self.env.files_dir);
            snap::write(&self.snapshot, at(McpPhase::Disabled, None, None, gen));
            set_config(&self.server_config, None);
            return self.halt(server, Duration::ZERO).await;
        }
        let now = snap::update(&self.snapshot, |s| {
            if s.generation == gen && s.phase == McpPhase::Starting {
                at(McpPhase::Running, Some(port), None, gen)
            } else {
                s
            }
        });
        if now.map(|s| s.phase) == Some(McpPhase::Running) {
            inner.server = Some(server);
        } else {
            // The server died before it could be reported (or the snapshot
            // is poisoned): take back what was published.
            files::unpublish(&self.env.files_dir);
            set_config(&self.server_config, None);
            self.halt(server, Duration::ZERO).await;
        }
    }

    pub(super) async fn stop_locked(&self, inner: &mut Inner) {
        let gen = inner.generation;
        let Some(server) = inner.server.take() else {
            snap::write(&self.snapshot, at(McpPhase::Disabled, None, None, gen));
            return;
        };
        // Before `Stopping` and `halt` (ADR-0042 F2): a waiting confirmation
        // is answered while its connection is still alive.
        self.notify_stop(StopCause::ServerStop);
        snap::update(&self.snapshot, |s| McpSnapshot {
            phase: McpPhase::Stopping,
            ..s
        });
        files::unpublish(&self.env.files_dir);
        set_config(&self.server_config, None);
        self.halt(server, self.env.drain).await;
        snap::write(&self.snapshot, at(McpPhase::Disabled, None, None, gen));
    }

    /// Record a failed start: `Failed(error)`, no token in memory.
    fn fail(&self, error: McpServerError, gen: u64) {
        snap::write(&self.snapshot, at(McpPhase::Failed, None, Some(error), gen));
        set_config(&self.server_config, None);
    }

    /// Shut a server down: graceful for `drain`, then kill every connection
    /// and wait `join_grace`, then abort. Returns once the task has joined
    /// (or `ABORT_JOIN` after the abort).
    async fn halt(&self, server: RunningServer, drain: Duration) {
        let RunningServer {
            shutdown,
            mut handle,
            kill,
        } = server;
        let _ = shutdown.send(());
        if timeout(drain, &mut handle).await.is_ok() {
            return;
        }
        kill.kill();
        if timeout(self.env.join_grace, &mut handle).await.is_ok() {
            return;
        }
        handle.abort();
        let _ = timeout(ABORT_JOIN, handle).await;
    }

    /// Spawn the serve future of generation `gen`; when it returns by
    /// itself, apply `apply_serve_exit`, and if that failed it, unpublish and
    /// clear the token **inside the same snapshot update** (D205). Done after
    /// the update, a reader saw `Failed` with the files still there, and a
    /// next generation started in between lost its files and its token.
    /// Lock order is cell -> config; nothing takes config -> cell.
    fn spawn_watched(&self, served: ServeFuture, gen: u64) -> ServeHandle {
        let cell = self.snapshot.clone();
        let dir = self.env.files_dir.clone();
        let config = self.server_config.clone();
        #[cfg(test)]
        let post_serve_exit = self.env.post_serve_exit.clone();
        tokio::spawn(async move {
            let result = served.await;
            snap::update(&cell, |s| {
                let next = apply_serve_exit(s, gen, ServeExit::Finished(result));
                if next != s {
                    files::unpublish(&dir);
                    set_config(&config, None);
                }
                next
            });
            #[cfg(test)]
            if let Some(hook) = &post_serve_exit {
                hook();
            }
            result
        })
    }
}
