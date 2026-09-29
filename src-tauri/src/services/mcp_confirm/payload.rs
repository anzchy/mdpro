//! The two confirmation events on the wire (ADR-0042 decision 1):
//! `mcp:confirm_request` to the owning window, and `mcp:confirm_resolved`
//! when a shown request ends. Keys are camelCase; the shapes are pinned to
//! `tests/fixtures/mcp-confirm-contract.json`, which the TS model reads too.

use serde::Serialize;

use super::queue::{Outcome, RequestId};

pub const CONFIRM_REQUEST_EVENT: &str = "mcp:confirm_request";
pub const CONFIRM_RESOLVED_EVENT: &str = "mcp:confirm_resolved";

/// The table actions an MCP client can ask for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TableAction {
    InsertTable,
    SetCell,
    AddRow,
    DeleteRow,
    AddColumn,
    DeleteColumn,
}

impl TableAction {
    pub fn as_str(self) -> &'static str {
        match self {
            TableAction::InsertTable => "insert_table",
            TableAction::SetCell => "set_cell",
            TableAction::AddRow => "add_row",
            TableAction::DeleteRow => "delete_row",
            TableAction::AddColumn => "add_column",
            TableAction::DeleteColumn => "delete_column",
        }
    }
}

/// The write being confirmed (ADR-0042 decision 5: all three paths).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Operation {
    Replace,
    Insert,
    Table(TableAction),
}

impl Operation {
    /// The wire name: `replace`, `insert` or `table`.
    pub fn as_str(self) -> &'static str {
        match self {
            Operation::Replace => "replace",
            Operation::Insert => "insert",
            Operation::Table(_) => "table",
        }
    }

    pub fn action(self) -> Option<TableAction> {
        match self {
            Operation::Replace | Operation::Insert => None,
            Operation::Table(action) => Some(action),
        }
    }
}

/// What a pending request carries. The title is shown in the prompt and is
/// never log material (`logging.rs`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfirmMeta {
    pub document_id: String,
    pub document_title: String,
    pub operation: Operation,
}

/// `mcp:confirm_request`. `action` is present only for table operations;
/// `expiresInMs` is what remains of the request's own 60 s budget when it
/// is shown, so a request that waited in the queue shows less.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmRequestPayload {
    pub request_id: RequestId,
    pub document_id: String,
    pub document_title: String,
    pub operation: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<TableAction>,
    pub expires_in_ms: u64,
}

impl ConfirmRequestPayload {
    pub fn new(id: &str, meta: &ConfirmMeta, expires_in_ms: u64) -> Self {
        Self {
            request_id: id.to_string(),
            document_id: meta.document_id.clone(),
            document_title: meta.document_title.clone(),
            operation: meta.operation.as_str(),
            action: meta.operation.action(),
            expires_in_ms,
        }
    }
}

/// How a shown request ended, as the webview sees it. Every cancel cause is
/// `cancelled` (the cause is not a UI concern). `Withdrawn` exists only on
/// the wire: the waiter went away, so no `confirm` future returns it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ResolvedOutcome {
    Approved,
    Rejected,
    TimedOut,
    Cancelled,
    Withdrawn,
}

impl From<Outcome> for ResolvedOutcome {
    fn from(outcome: Outcome) -> Self {
        match outcome {
            Outcome::Approved => ResolvedOutcome::Approved,
            Outcome::Rejected => ResolvedOutcome::Rejected,
            Outcome::TimedOut => ResolvedOutcome::TimedOut,
            Outcome::Cancelled(_) => ResolvedOutcome::Cancelled,
        }
    }
}

impl ResolvedOutcome {
    /// The wire string, for log lines.
    pub fn as_str(self) -> &'static str {
        match self {
            ResolvedOutcome::Approved => "approved",
            ResolvedOutcome::Rejected => "rejected",
            ResolvedOutcome::TimedOut => "timedOut",
            ResolvedOutcome::Cancelled => "cancelled",
            ResolvedOutcome::Withdrawn => "withdrawn",
        }
    }
}

/// `mcp:confirm_resolved`: closes the prompt for `requestId`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmResolvedPayload {
    pub request_id: RequestId,
    pub outcome: ResolvedOutcome,
}

#[cfg(test)]
#[path = "payload_tests.rs"]
mod tests;
