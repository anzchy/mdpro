//! Purpose: the ADR-0027 fallback alert's wording, picked by why the alert is
//! shown (`FallbackCause`).
//!
//! Key decisions:
//! - **A pure function**, so the text for every cause is tested on every
//!   target, not only through `NSAlert` on a Mac.
//! - **A named struct, not a `(&str, &str)` tuple**, so a title/body swap is
//!   visible at every construction and every read.
//! - **The `match` has no `_` arm**: a new cause fails to compile until it has
//!   its own wording.

use super::FallbackCause;

/// The timeout wording (ADR-0027 §2), byte-identical to the text macos.rs held
/// before the escape got its own. It names
/// no document and offers no save: at timeout the coordinator does not know
/// which windows are dirty, so the text has to state the worst case.
const TIMEOUT_TITLE: &str = "mdpro isn’t responding to the quit request";
const TIMEOUT_BODY: &str = "One or more editor windows didn’t answer in time, so mdpro can’t check them for unsaved changes.\n\nQuitting now will discard unsaved changes in every window. Drafts are kept, so you may be able to recover them the next time you open mdpro.";

/// The escape wording (ADR-0030, ADR-0036). The user asked to stop waiting, so
/// it blames no window for being slow; the loss paragraph is the timeout's.
const ESCAPE_TITLE: &str = "Stop waiting and quit mdpro?";
const ESCAPE_BODY: &str = "mdpro hasn’t finished checking every editor window for unsaved changes, so it can’t tell which ones have them.\n\nQuitting now will discard unsaved changes in every window. Drafts are kept, so you may be able to recover them the next time you open mdpro.";

/// The alert's bold message line and its informative text. The macOS adapter
/// (`macos::present_fallback_alert`) reads both by name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AlertText {
    pub title: &'static str,
    pub body: &'static str,
}

/// The wording for `cause`. Called by `macos::present_fallback_alert`.
pub(crate) fn fallback_alert_text(cause: FallbackCause) -> AlertText {
    match cause {
        FallbackCause::Timeout => AlertText {
            title: TIMEOUT_TITLE,
            body: TIMEOUT_BODY,
        },
        FallbackCause::Escape => AlertText {
            title: ESCAPE_TITLE,
            body: ESCAPE_BODY,
        },
    }
}

#[cfg(test)]
#[path = "alert_text_tests.rs"]
mod tests;
