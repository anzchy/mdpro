//! Purpose: the live quit request — every window's position in it, and the one
//! deadline it is running.
//!
//! Extracted from `coordinator.rs` under rule 50 §6. The split is by role, not
//! by size: this file knows *where each window stands*, and the coordinator
//! knows *what the driver is owed because of it*. Nothing here returns a `Step`.
//!
//! Key decisions:
//! - **One deadline per request, not one per window.** At most one window is
//!   ever bounded: phase 1 bounds the whole snapshot at once, and phase 2
//!   prompts serially. A per-window deadline would be four ways to express the
//!   same instant and three ways to get it wrong.
//! - **Per-window and per-request re-check state lives here** (ADR-0035), so
//!   it is dropped with the request. The transitions are in `rounds.rs`.
//! - **Each window remembers what it discarded** (ADR-0035 review M-1), so a
//!   backstop redraft can cancel only that window's own deletion, never a
//!   sibling's.
//! - **`Drafting` is outstanding but not machine-side** (ADR-0035 §5). The
//!   request waits for it, but its deadline commits instead of raising the
//!   ADR-0027 alert, so it is never in `machine_side_outstanding`.
//! - **`Deciding` is unbounded on purpose** (ADR-0029). It is the state a window
//!   is in while a person reads its dialog, and a person is not a machine
//!   failing to make progress.
//!
//! @coordinates-with docs/adr/0029-quit-deadlines-bound-machine-progress-not-people.md

use super::coordinator::{QUIT_ACK_TIMEOUT_MS, QUIT_PROMPT_DELIVERY_TIMEOUT_MS};
use super::types::BackstopTally;

/// Where one window has got to within the live request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Status {
    /// Has not sent its ack for the current round (phase 1 or a re-check) yet,
    /// and can still time out.
    Pending,
    /// Acked `dirty`, waiting for its turn to be prompted.
    Queued,
    /// Prompted, and its delivery ack has NOT arrived yet. This is the only
    /// phase-2 state a deadline applies to: what is outstanding is a webview
    /// drawing a dialog, which is a machine making progress.
    Prompted,
    /// Its dialog is up and the user is reading it (ADR-0029 §1). Nothing bounds
    /// this — a person taking a minute over unsaved work is not a fault.
    Deciding,
    /// Answered this round: clean, discarded, or capped (ADR-0035 §3). The
    /// next re-check round asks it again.
    Settled,
    /// Asked to draft its dirty documents before the commit (ADR-0035 §4).
    /// Outstanding, but never machine-side: its deadline commits, it does not
    /// raise the ADR-0027 alert.
    Drafting,
    /// Destroyed mid-request. Counts as `clean`, and is absorbing: no round
    /// asks it again and no deadline waits on it.
    Gone,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Window {
    pub label: String,
    pub status: Status,
    /// A re-check has already queued this window once (ADR-0035 §3). A phase-1
    /// prompt does not set it.
    pub reprompted: bool,
    /// This window has been refused a further re-prompt, and counted in
    /// `Request::capped` — once, however many later rounds find it dirty.
    pub capped: bool,
    /// Every id this window's own `Discard` answers named (ADR-0035 review M-1).
    pub discarded: Vec<String>,
    /// The subset of `discarded` it redrafted in the backstop; the commit keeps
    /// those drafts unless another window discarded the same id.
    pub undiscarded: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Request {
    pub id: u64,
    pub windows: Vec<Window>,
    pub discard_document_ids: Vec<String>,
    /// The instant the driver must wake at, or `None` when nothing machine-side
    /// is outstanding.
    pub deadline_ms: Option<u64>,
    /// The native alert has taken the request over (ADR-0027).
    pub fallback: bool,
    /// 0 for phase 1, then +1 at every re-check round (ADR-0035 A5).
    pub round: u32,
    /// A re-check must run before the commit: set at open and at every prompt.
    pub recheck_due: bool,
    /// Windows dirty again after their one re-prompt, settled without a third
    /// prompt. A window counts once, not once per round that refuses it.
    pub capped: u32,
    /// The draft backstop's running tally, `Some` once it has been issued
    /// (ADR-0035 §4). It runs at most once per request.
    pub backstop: Option<BackstopTally>,
}

impl Request {
    /// Open a request over the snapshot `window_labels`, on the phase-1 clock.
    pub fn open<S: AsRef<str>>(id: u64, window_labels: &[S], now_ms: u64) -> Self {
        Self {
            id,
            windows: window_labels
                .iter()
                .map(|label| Window {
                    label: label.as_ref().to_string(),
                    status: Status::Pending,
                    reprompted: false,
                    capped: false,
                    discarded: Vec::new(),
                    undiscarded: Vec::new(),
                })
                .collect(),
            discard_document_ids: Vec::new(),
            deadline_ms: Some(now_ms.saturating_add(QUIT_ACK_TIMEOUT_MS)),
            fallback: false,
            round: 0,
            recheck_due: true,
            capped: 0,
            backstop: None,
        }
    }

    pub fn position_of(&self, label: &str) -> Option<usize> {
        self.windows.iter().position(|w| w.label == label)
    }

    pub fn status_of(&self, label: &str) -> Option<Status> {
        self.position_of(label).map(|at| self.windows[at].status)
    }

    /// Is any window still owed something before the request can resolve?
    pub fn outstanding(&self) -> bool {
        self.windows.iter().any(|w| {
            matches!(
                w.status,
                Status::Pending | Status::Prompted | Status::Deciding | Status::Drafting
            )
        })
    }

    /// Prompt the next dirty window, and start ITS delivery deadline at
    /// `now_ms` — never at the start of the request, which a slow phase 1 would
    /// already have spent.
    pub fn promote_next_queued(&mut self, now_ms: u64) -> Option<(String, u64)> {
        let at = self
            .windows
            .iter()
            .position(|w| w.status == Status::Queued)?;
        self.windows[at].status = Status::Prompted;
        self.recheck_due = true;
        let deadline_ms = now_ms.saturating_add(QUIT_PROMPT_DELIVERY_TIMEOUT_MS);
        self.deadline_ms = Some(deadline_ms);
        Some((self.windows[at].label.clone(), deadline_ms))
    }

    /// The windows a reached deadline is waiting on: one that never acked, or
    /// one whose dialog never reported itself drawn. A `Deciding` window is
    /// never here — the deadline is not measuring it.
    pub fn machine_side_outstanding(&self) -> Vec<String> {
        self.windows
            .iter()
            .filter(|w| matches!(w.status, Status::Pending | Status::Prompted))
            .map(|w| w.label.clone())
            .collect()
    }

    /// Add `ids` to the delete list, without duplicating one already there.
    pub fn add_discards(&mut self, ids: &[String]) {
        for id in ids {
            if !self.discard_document_ids.contains(id) {
                self.discard_document_ids.push(id.clone());
            }
        }
    }
}
