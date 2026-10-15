use std::net::SocketAddr;
use std::sync::Arc;

use tauri::{AppHandle, Manager, Runtime};
use tokio::runtime::Runtime as TokioRuntime;
use tokio::sync::RwLock;

pub mod auth;
pub mod handlers;
pub mod response;
pub mod router;

use crate::platform::{create_executor, FrameId, PlatformExecutor};
use crate::server::response::WebDriverErrorResponse;
use crate::webdriver::{SessionManager, Timeouts};

/// Shared state for the `WebDriver` server
pub struct AppState<R: Runtime> {
    pub app: AppHandle<R>,
    pub sessions: RwLock<SessionManager>,
}

impl<R: Runtime + 'static> AppState<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self {
            app,
            sessions: RwLock::new(SessionManager::new()),
        }
    }

    /// Get a platform executor for a specific window by label
    pub fn get_executor_for_window(
        &self,
        window_label: &str,
        timeouts: Timeouts,
        frame_context: Vec<FrameId>,
    ) -> Result<Arc<dyn PlatformExecutor<R>>, WebDriverErrorResponse> {
        self.app
            .webview_windows()
            .get(window_label)
            .cloned()
            .map(|window| create_executor(window, timeouts, frame_context))
            .ok_or_else(WebDriverErrorResponse::no_such_window)
    }

    /// Whether a window with this label is still registered
    pub fn has_window_label(&self, window_label: &str) -> bool {
        self.app.webview_windows().contains_key(window_label)
    }

    /// Get all window labels
    pub fn get_window_labels(&self) -> Vec<String> {
        self.app.webview_windows().keys().cloned().collect()
    }
}

/// Start the `WebDriver` HTTP server on loopback (mdpro patch: authenticated, see `auth`).
pub fn start<R: Runtime + 'static>(app: AppHandle<R>, config: crate::Config) {
    std::thread::spawn(move || {
        let report = &config.on_listen;
        let rt = match TokioRuntime::new() {
            Ok(rt) => rt,
            Err(e) => return report(Err(format!("tokio runtime: {e}"))),
        };

        rt.block_on(async {
            let addr = SocketAddr::from(([127, 0, 0, 1], config.port));
            let listener = match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => l,
                Err(e) => return report(Err(format!("bind {addr}: {e}"))),
            };
            let bound = match listener.local_addr() {
                Ok(a) => a,
                Err(e) => return report(Err(format!("local_addr: {e}"))),
            };
            let guard = Arc::new(auth::Guard::new(&config.token, bound.port()));
            let router = router::create_router(Arc::new(AppState::new(app)), config.allow_eval)
                .layer(axum::middleware::from_fn_with_state(guard, auth::check));
            report(Ok(bound));

            if let Err(e) = axum::serve(listener, router).await {
                report(Err(format!("serve: {e}")));
            }
        });
    });
}
