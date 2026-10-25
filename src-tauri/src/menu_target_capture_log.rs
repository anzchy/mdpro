//! Purpose: the content-free `menu.capture` log lines of D319's click-time
//! capture: native Begin / WillSend / End, the stored capture, each discard
//! with its reason, and the route decision. A device run reads them to see
//! where a click's owner was kept or lost. No line carries an item title, a
//! menu id, a value or a path: only steps, enums, booleans and counters.
//!
//! @coordinates-with menu_capture_state.rs (records the steps)
//! @coordinates-with menu_target.rs (records the route decision)

use crate::models::{LogEntryPayload, LogLevel, LogStatus};
use crate::services::logger;
use serde_json::Value;

/// One `menu.capture` line. A discard is a `cancel`; every other step is a
/// `success`.
pub(super) fn entry(context: Value) -> LogEntryPayload {
    let status = if context["step"] == "discard" {
        LogStatus::Cancel
    } else {
        LogStatus::Success
    };
    LogEntryPayload {
        level: LogLevel::Info,
        event: "menu.capture".to_string(),
        status,
        action_id: None,
        context: Some(context),
        duration_ms: None,
        error: None,
    }
}

/// Write lines collected under the `MenuFocus` lock, after it is released.
pub(super) fn emit(entries: Vec<LogEntryPayload>) {
    for entry in entries {
        #[cfg(test)]
        let entry = match test_sink::push(entry) {
            Some(entry) => entry,
            None => continue,
        };
        logger::log_event(entry);
    }
}

/// Test seam: while `record` runs on this thread, the payloads production
/// would hand to `logger::log_event` are kept instead of written to a file
/// another test may share.
#[cfg(test)]
pub(crate) mod test_sink {
    use crate::models::LogEntryPayload;
    use serde_json::Value;
    use std::cell::RefCell;

    thread_local! {
        static SINK: RefCell<Option<Vec<Value>>> = const { RefCell::new(None) };
    }

    pub(crate) fn record<T>(run: impl FnOnce() -> T) -> (T, Vec<Value>) {
        SINK.with(|sink| *sink.borrow_mut() = Some(Vec::new()));
        let result = run();
        let lines = SINK.with(|sink| sink.borrow_mut().take().unwrap_or_default());
        (result, lines)
    }

    pub(super) fn push(entry: LogEntryPayload) -> Option<LogEntryPayload> {
        SINK.with(|sink| match sink.borrow_mut().as_mut() {
            Some(lines) => {
                lines.push(serde_json::to_value(&entry).unwrap_or(Value::Null));
                None
            }
            None => Some(entry),
        })
    }
}
