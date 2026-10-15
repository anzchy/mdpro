//! mdpro patch (ADR-0047 WI-006, S1.1-S1.4): every request is checked before
//! any handler runs. Refused, in this order: any `Origin` header (403); a
//! `Host` other than this listener's loopback address (403); a missing or
//! wrong bearer token (401, constant-time compare); a mutating request
//! without a fresh `X-Request-Id` (400), or one whose id was already seen
//! (409, at-most-once).

use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use axum::extract::{Request, State};
use axum::http::{header, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;

const SEEN_CAP: usize = 4096;
const ID_MAX: usize = 128;

pub struct Guard {
    token: Vec<u8>,
    hosts: [String; 2],
    seen: Mutex<(HashSet<String>, VecDeque<String>)>,
}

impl Guard {
    pub fn new(token: &str, port: u16) -> Self {
        Self {
            token: token.as_bytes().to_vec(),
            hosts: [format!("127.0.0.1:{port}"), format!("localhost:{port}")],
            seen: Mutex::new((HashSet::new(), VecDeque::new())),
        }
    }

    /// Records `id`; false when it was already seen. Keeps the last `SEEN_CAP` ids.
    fn first_use(&self, id: &str) -> bool {
        let Ok(mut seen) = self.seen.lock() else { return false };
        let (set, order) = &mut *seen;
        if !set.insert(id.to_owned()) {
            return false;
        }
        order.push_back(id.to_owned());
        if order.len() > SEEN_CAP {
            if let Some(old) = order.pop_front() {
                set.remove(&old);
            }
        }
        true
    }
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn refuse(status: StatusCode, error: &str) -> Response {
    let body = serde_json::json!({ "value": { "error": error, "message": error } });
    (status, Json(body)).into_response()
}

pub async fn check(State(g): State<Arc<Guard>>, req: Request, next: Next) -> Response {
    let h = req.headers();
    if h.contains_key(header::ORIGIN) {
        return refuse(StatusCode::FORBIDDEN, "origin not allowed");
    }
    let host = h.get(header::HOST).and_then(|v| v.to_str().ok());
    if !host.is_some_and(|v| g.hosts.iter().any(|ok| ok == v)) {
        return refuse(StatusCode::FORBIDDEN, "host not allowed");
    }
    let token = h
        .get(header::AUTHORIZATION)
        .and_then(|v| v.as_bytes().strip_prefix(b"Bearer "));
    if !token.is_some_and(|t| ct_eq(t, &g.token)) {
        return refuse(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    if req.method() != Method::GET {
        let id = h.get("x-request-id").and_then(|v| v.to_str().ok());
        let Some(id) = id.filter(|i| !i.is_empty() && i.len() <= ID_MAX) else {
            return refuse(StatusCode::BAD_REQUEST, "x-request-id required");
        };
        if !g.first_use(id) {
            return refuse(StatusCode::CONFLICT, "duplicate request id");
        }
    }
    next.run(req).await
}
