//! Test routers for the ADR-0042 stop-hook cases (WI-4): `POST /confirm/{id}`
//! behind `with_token_auth`, gated through the real
//! `mcp_confirm::http::confirm_gate` (owner/focus -> `gate::decide` ->
//! `ConfirmBroker::confirm` -> the HTTP mapping) as a `Replace`.
//!
//! When WI-4 was written the mapping (WI-5) did not exist yet and this file
//! carried a local stand-in with the same codes; WI-9 switched it to the real
//! gate. The WI-4 assertions read only the status and the body's `code`,
//! which the two agree on, so none of them changed. A gate that lets the
//! write through answers 200 `{"code":"OK"}`.
//!
//! - `confirm_gated(broker, store)`: the route as described.
//! - `confirm_parked(broker, store)`: the same route, parked before the gate
//!   (signal `entered`, await `release`), as `Blocking` does (S-4).

use crate::models::mcp::DocumentState;
use crate::models::{SharedServerConfig, SharedShadowStore, SyncDocumentsPayload};
use crate::services::http_server::with_token_auth;
use crate::services::mcp_confirm::http::confirm_gate;
use crate::services::mcp_confirm::payload::Operation;
use crate::services::mcp_confirm::test_effects::TestBroker;
use crate::services::shadow_store::{create_shadow_store, sync_documents};
use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use std::future::{ready, Ready};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

/// A store where window B holds document `d` and no window is focused.
pub(crate) fn store_with_d_in_b() -> SharedShadowStore {
    let store = create_shadow_store();
    let doc = DocumentState {
        id: "d".to_string(),
        title: "d".to_string(),
        path: Some("/test/d.md".to_string()),
        content: String::new(),
        cursor: 0,
        is_dirty: false,
        is_active: true,
        over_limit: false,
    };
    let payload = SyncDocumentsPayload {
        window_label: "B".to_string(),
        documents: vec![doc],
        active_document_id: Some("d".to_string()),
        routable: true,
    };
    sync_documents(&store, payload).expect("sync d into B");
    store
}

async fn gate(broker: &TestBroker, store: &SharedShadowStore, id: &str) -> Response {
    match confirm_gate(broker, store, id, Operation::Replace).await {
        Ok(()) => (StatusCode::OK, Json(json!({ "code": "OK" }))).into_response(),
        Err(refused) => refused,
    }
}

/// The park of `confirm_parked`: each is taken once.
#[derive(Default)]
struct Park {
    entered: Option<oneshot::Sender<()>>,
    release: Option<oneshot::Receiver<()>>,
}

async fn wait_in(park: &Mutex<Park>) {
    let (entered, release) = {
        let mut guard = park.lock().expect("park lock");
        (guard.entered.take(), guard.release.take())
    };
    if let Some(tx) = entered {
        let _ = tx.send(());
    }
    if let Some(rx) = release {
        let _ = rx.await;
    }
}

fn routes(broker: TestBroker, store: SharedShadowStore, park: Option<Arc<Mutex<Park>>>) -> Router {
    let handler = move |Path(id): Path<String>| {
        let (broker, store, park) = (broker.clone(), store.clone(), park.clone());
        async move {
            if let Some(park) = park {
                wait_in(&park).await;
            }
            gate(&broker, &store, &id).await
        }
    };
    Router::new().route("/confirm/{id}", post(handler))
}

/// A factory for the gated route on the controller's shared config.
pub(crate) fn confirm_gated(
    broker: TestBroker,
    store: SharedShadowStore,
) -> impl FnOnce(SharedServerConfig) -> Ready<Router> + Send {
    move |config| ready(with_token_auth(routes(broker, store, None), config))
}

/// A parked gated route, its `entered` signal and its `release` trigger.
pub(crate) struct Parked<F> {
    pub(crate) factory: F,
    pub(crate) entered: oneshot::Receiver<()>,
    pub(crate) release: oneshot::Sender<()>,
}

pub(crate) fn confirm_parked(
    broker: TestBroker,
    store: SharedShadowStore,
) -> Parked<impl FnOnce(SharedServerConfig) -> Ready<Router> + Send> {
    let (entered_tx, entered) = oneshot::channel();
    let (release, release_rx) = oneshot::channel();
    let park = Arc::new(Mutex::new(Park {
        entered: Some(entered_tx),
        release: Some(release_rx),
    }));
    let factory = move |config| ready(with_token_auth(routes(broker, store, Some(park)), config));
    Parked {
        factory,
        entered,
        release,
    }
}

/// POST `/confirm/{doc}` with the token; returns status and parsed body.
pub(crate) async fn post_confirm(
    port: u16,
    token: String,
    doc: &'static str,
    client_timeout: Duration,
) -> reqwest::Result<(u16, Value)> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(client_timeout)
        .build()?;
    let response = client
        .post(format!("http://127.0.0.1:{port}/confirm/{doc}"))
        .header("X-MDPRO-Token", token)
        .send()
        .await?;
    let status = response.status().as_u16();
    let body = response.json::<Value>().await.unwrap_or(Value::Null);
    Ok((status, body))
}
