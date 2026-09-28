//! Purpose: a listener whose accepted connections can all be killed at once
//! (ADR-0040 PC-1), and the serve future built on it.
//!
//! Key decisions:
//! - axum 0.8 runs every connection on its own spawned task, so aborting the
//!   serve task drops the listener but leaves in-flight handlers running.
//!   Every accepted stream is therefore wrapped in `KillableIo`. After
//!   `KillSwitch::kill`, each read/write fails, hyper ends the connection,
//!   and the connection task drops its handler future and closes the socket.
//! - The graceful serve future resolves only after every connection task has
//!   ended, so a joined serve task means no handler of that generation is
//!   still alive.
//!
//! @coordinates-with src/services/mcp_controller/serve.rs (`map_serve_result`)
//! @coordinates-with src/services/mcp_controller/transitions.rs (`stop`)

use crate::services::mcp_controller::serve::{map_serve_result, ServeError};
use axum::Router;
use std::collections::HashMap;
use std::future::Future;
use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::task::{Context, Poll, Waker};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

/// Back-off after a failed `accept` (e.g. out of file descriptors), so the
/// accept loop cannot spin.
const ACCEPT_BACKOFF: Duration = Duration::from_millis(50);

/// Kills every connection accepted through its `KillableListener`.
#[derive(Debug, Default)]
pub struct KillSwitch {
    killed: AtomicBool,
    next_id: AtomicU64,
    /// The latest waker of each live connection, by connection id.
    wakers: Mutex<HashMap<u64, Waker>>,
}

impl KillSwitch {
    pub fn new() -> Arc<Self> {
        Arc::new(KillSwitch::default())
    }

    /// Make every current and future read/write on the connections fail,
    /// and wake each connection so it notices now.
    pub fn kill(&self) {
        self.killed.store(true, Ordering::SeqCst);
        let wakers: Vec<Waker> = self.wakers().drain().map(|(_, w)| w).collect();
        for waker in wakers {
            waker.wake();
        }
    }

    /// The waker map. A poisoned map is still just wakers, so it is used.
    fn wakers(&self) -> MutexGuard<'_, HashMap<u64, Waker>> {
        self.wakers.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Register `waker` for connection `id`, then report whether killed.
    /// Registering first means a concurrent `kill` either sees this waker
    /// or has already set the flag this check reads.
    fn check(&self, id: u64, waker: &Waker) -> bool {
        if self.killed.load(Ordering::SeqCst) {
            return true;
        }
        let mut wakers = self.wakers();
        match wakers.get(&id) {
            Some(w) if w.will_wake(waker) => {}
            _ => {
                wakers.insert(id, waker.clone());
            }
        }
        drop(wakers);
        self.killed.load(Ordering::SeqCst)
    }
}

/// A `TcpListener` whose accepted streams obey a `KillSwitch`.
pub struct KillableListener {
    inner: TcpListener,
    kill: Arc<KillSwitch>,
}

impl KillableListener {
    pub fn new(inner: TcpListener, kill: Arc<KillSwitch>) -> Self {
        KillableListener { inner, kill }
    }
}

impl axum::serve::Listener for KillableListener {
    type Io = KillableIo;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            match self.inner.accept().await {
                Ok((stream, addr)) => {
                    let id = self.kill.next_id.fetch_add(1, Ordering::Relaxed);
                    let io = KillableIo {
                        inner: stream,
                        id,
                        kill: self.kill.clone(),
                    };
                    return (io, addr);
                }
                Err(_) => tokio::time::sleep(ACCEPT_BACKOFF).await,
            }
        }
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.inner.local_addr()
    }
}

/// An accepted stream that fails every operation once killed.
pub struct KillableIo {
    inner: TcpStream,
    id: u64,
    kill: Arc<KillSwitch>,
}

fn killed() -> io::Error {
    io::Error::from(io::ErrorKind::ConnectionAborted)
}

impl Drop for KillableIo {
    fn drop(&mut self) {
        self.kill.wakers().remove(&self.id);
    }
}

impl AsyncRead for KillableIo {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        if this.kill.check(this.id, cx.waker()) {
            return Poll::Ready(Err(killed()));
        }
        Pin::new(&mut this.inner).poll_read(cx, buf)
    }
}

impl AsyncWrite for KillableIo {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        if this.kill.check(this.id, cx.waker()) {
            return Poll::Ready(Err(killed()));
        }
        Pin::new(&mut this.inner).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        if this.kill.check(this.id, cx.waker()) {
            return Poll::Ready(Err(killed()));
        }
        Pin::new(&mut this.inner).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        if this.kill.check(this.id, cx.waker()) {
            return Poll::Ready(Err(killed()));
        }
        Pin::new(&mut this.inner).poll_shutdown(cx)
    }
}

/// A serve future: resolves to the serve result.
pub type ServeFuture = Pin<Box<dyn Future<Output = Result<(), ServeError>> + Send>>;

/// The serve seam the controller spawns (`ControllerEnv::serve`).
pub type ServeFn =
    Arc<dyn Fn(KillableListener, Router, oneshot::Receiver<()>) -> ServeFuture + Send + Sync>;

/// Serve `router` on `listener` until `shutdown` fires (or its sender is
/// dropped), then drain gracefully. Resolves only after every connection
/// task has ended; the result goes through `map_serve_result`.
pub fn serve_killable(
    listener: KillableListener,
    router: Router,
    shutdown: oneshot::Receiver<()>,
) -> ServeFuture {
    Box::pin(async move {
        let served = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = shutdown.await;
            })
            .await;
        map_serve_result(served)
    })
}

/// The production `ServeFn`: `serve_killable`.
pub fn default_serve() -> ServeFn {
    Arc::new(serve_killable)
}
