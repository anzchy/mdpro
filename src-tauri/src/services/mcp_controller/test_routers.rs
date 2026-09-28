//! Test routers and serve wrappers for the `McpController` cases (WI-3).
//!
//! - `plain()`: a router factory with `/ping` behind `with_token_auth`.
//! - `gated()`: a factory that signals `entered` and waits for `release`
//!   before returning its router (PC-8).
//! - `Blocking`: `/block`, `/block-forever`, `/block-done` and `/ping`, all
//!   behind `with_token_auth`, for the stop-order and abort cases.
//! - `failable_serve()` / `stuck_serve_once()`: `ServeFn`s that run the
//!   real `serve_killable` and hand the test one `fail` sender per spawn.

use crate::models::SharedServerConfig;
use crate::services::http_server::with_token_auth;
use crate::services::mcp_controller::killable::{serve_killable, ServeFn};
use crate::services::mcp_controller::serve::ServeError;
use axum::{http::StatusCode, routing::get, Router};
use std::future::{ready, Future, Ready};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use tokio::sync::oneshot;

fn ping_routes() -> Router {
    Router::new().route("/ping", get(|| async { StatusCode::OK }))
}

/// A factory for `/ping` behind auth on the controller's shared config.
pub(crate) fn plain() -> impl FnOnce(SharedServerConfig) -> Ready<Router> + Send {
    |config| ready(with_token_auth(ping_routes(), config))
}

/// A gated factory, its `entered` signal and its `release` trigger.
pub(crate) struct Gated<F> {
    pub(crate) factory: F,
    pub(crate) entered: oneshot::Receiver<()>,
    pub(crate) release: oneshot::Sender<()>,
}

/// A factory that parks inside `start` between bind and spawn.
pub(crate) fn gated() -> Gated<
    impl FnOnce(SharedServerConfig) -> std::pin::Pin<Box<dyn Future<Output = Router> + Send>> + Send,
> {
    let (entered_tx, entered) = oneshot::channel();
    let (release, release_rx) = oneshot::channel::<()>();
    let factory = move |config: SharedServerConfig| {
        Box::pin(async move {
            let _ = entered_tx.send(());
            let _ = release_rx.await;
            with_token_auth(ping_routes(), config)
        }) as std::pin::Pin<Box<dyn Future<Output = Router> + Send>>
    };
    Gated {
        factory,
        entered,
        release,
    }
}

#[derive(Default)]
struct Slots {
    entered: Option<oneshot::Sender<()>>,
    release: Option<oneshot::Receiver<()>>,
    done: Option<oneshot::Sender<()>>,
}

/// `blocking_router()`: the test keeps `entered`, `release` and `done`.
pub(crate) struct Blocking {
    slots: Arc<Mutex<Slots>>,
    pub(crate) entered: oneshot::Receiver<()>,
    pub(crate) release: oneshot::Sender<()>,
    pub(crate) done: oneshot::Receiver<()>,
}

fn take<T>(slots: &Mutex<Slots>, pick: impl FnOnce(&mut Slots) -> Option<T>) -> Option<T> {
    let mut guard = slots.lock().expect("blocking router slots");
    pick(&mut guard)
}

pub(crate) fn blocking_router() -> Blocking {
    let (entered_tx, entered) = oneshot::channel();
    let (release, release_rx) = oneshot::channel();
    let (done_tx, done) = oneshot::channel();
    let slots = Arc::new(Mutex::new(Slots {
        entered: Some(entered_tx),
        release: Some(release_rx),
        done: Some(done_tx),
    }));
    Blocking {
        slots,
        entered,
        release,
        done,
    }
}

async fn enter_and_wait(slots: Arc<Mutex<Slots>>) {
    if let Some(tx) = take(&slots, |s| s.entered.take()) {
        let _ = tx.send(());
    }
    if let Some(rx) = take(&slots, |s| s.release.take()) {
        let _ = rx.await;
    }
}

impl Blocking {
    /// A router factory over this `Blocking`'s channels. Callable per start.
    pub(crate) fn factory(&self) -> impl FnOnce(SharedServerConfig) -> Ready<Router> + Send {
        let slots = self.slots.clone();
        move |config| {
            let (s1, s2, s3) = (slots.clone(), slots.clone(), slots);
            let routes = ping_routes()
                .route(
                    "/block",
                    get(move || {
                        let slots = s1.clone();
                        async move {
                            enter_and_wait(slots).await;
                            StatusCode::OK
                        }
                    }),
                )
                .route(
                    "/block-forever",
                    get(move || {
                        let slots = s2.clone();
                        async move {
                            if let Some(tx) = take(&slots, |s| s.entered.take()) {
                                let _ = tx.send(());
                            }
                            std::future::pending::<StatusCode>().await
                        }
                    }),
                )
                .route(
                    "/block-done",
                    get(move || {
                        let slots = s3.clone();
                        async move {
                            let done = take(&slots, |s| s.done.take());
                            enter_and_wait(slots).await;
                            if let Some(done) = done {
                                let _ = done.send(());
                            }
                            StatusCode::OK
                        }
                    }),
                );
            ready(with_token_auth(routes, config))
        }
    }
}

/// A `ServeFn` running the real `serve_killable`, raced against a per-spawn
/// `fail` oneshot; the fail senders arrive on the returned receiver. When
/// `stuck_first`, the first spawn ignores the shutdown signal entirely.
fn fail_serve(stuck_first: bool) -> (ServeFn, mpsc::Receiver<oneshot::Sender<()>>) {
    let (fails_tx, fails_rx) = mpsc::channel();
    let fails_tx = Mutex::new(fails_tx);
    let spawns = AtomicUsize::new(0);
    let serve: ServeFn = Arc::new(move |listener, router, shutdown| {
        let (fail_tx, fail_rx) = oneshot::channel::<()>();
        let _ = fails_tx.lock().expect("fail senders").send(fail_tx);
        let stuck = stuck_first && spawns.fetch_add(1, Ordering::SeqCst) == 0;
        Box::pin(async move {
            // A stuck spawn keeps its own never-firing shutdown sender alive.
            let (keep, never) = oneshot::channel::<()>();
            let signal = if stuck { never } else { shutdown };
            let served = serve_killable(listener, router, signal);
            let result = tokio::select! {
                r = served => r,
                Ok(()) = fail_rx => Err(ServeError::Io),
            };
            drop(keep);
            result
        })
    });
    (serve, fails_rx)
}

pub(crate) fn failable_serve() -> (ServeFn, mpsc::Receiver<oneshot::Sender<()>>) {
    fail_serve(false)
}

pub(crate) fn stuck_serve_once() -> (ServeFn, mpsc::Receiver<oneshot::Sender<()>>) {
    fail_serve(true)
}
