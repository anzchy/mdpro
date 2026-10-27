use serde_json::{json, Value};

pub(crate) fn build(window_id: &str, window_label: &str) -> Value {
    json!({
        "windowId": window_id,
        "windowLabel": window_label,
        "pid": std::process::id()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_window_event_carries_the_current_process_pid() {
        let event = json!({
            "event": "window.open",
            "context": build("main", "main")
        });
        let encoded = serde_json::to_string(&event).expect("serialize startup window event");
        let decoded: Value = serde_json::from_str(&encoded).expect("parse event");
        assert_eq!(decoded["context"]["pid"], std::process::id());
    }
}
