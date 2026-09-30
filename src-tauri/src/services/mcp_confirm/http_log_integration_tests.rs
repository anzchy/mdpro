//! L-3 (ADR-0042 WI-5, integration): the real JSONL log lines written by
//! one gated write and its reply carry no title, content, path or token.
//! Real logger, real file under a temp `$HOME`, real shadow store; the only
//! fake is `RecordingEffects`.

use std::sync::Arc;

use serde_json::Value;

use super::tests::{spawn_gate, store_with_d, uuid_ids};
use crate::commands::mcp_confirm::reply_from;
use crate::services::logger;
use crate::services::mcp_confirm::broker::ConfirmBroker;
use crate::services::mcp_confirm::queue::ReplyVerdict;
use crate::services::mcp_confirm::test_effects::{paused_runtime, settle, RecordingEffects};
use crate::services::mcp_controller::test_support::force_logger_on;
use crate::services::window_restore::test_home::TestHome;

const SENTINELS: [&str; 4] = [
    "TITLE-SENTINEL-秘",
    "CONTENT-SENTINEL",
    "PATH-SENTINEL",
    "TOKEN-SENTINEL",
];

fn lines_for(home: &std::path::Path, id: &str) -> Vec<Value> {
    let text = std::fs::read_to_string(home.join(".mdpro").join("mdpro.log")).unwrap_or_default();
    for sentinel in SENTINELS {
        assert!(!text.contains(sentinel), "{sentinel} reached the log");
    }
    text.lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v["context"]["requestId"] == id)
        .collect()
}

fn count(lines: &[Value], event: &str, status: &str) -> usize {
    lines
        .iter()
        .filter(|v| v["event"] == event && v["status"] == status)
        .count()
}

#[test]
fn l3_real_log_lines_through_the_gate_carry_no_secrets() {
    let home = TestHome::new("mcp_confirm_l3");
    let _log = force_logger_on();
    let _token_in_scope = "TOKEN-SENTINEL";
    let rt = paused_runtime();
    let id = rt.block_on(async {
        let fx = RecordingEffects::new();
        let broker = Arc::new(
            ConfirmBroker::new_with(fx, uuid_ids()).with_log_sink(Arc::new(logger::log_event)),
        );
        let store = store_with_d("B", "TITLE-SENTINEL-秘", "CONTENT-SENTINEL");
        let handle = spawn_gate(&broker, &store);
        settle().await;
        let id = broker.shown("B").expect("shown in B");
        assert_eq!(reply_from(&broker, "B", &id, true), Ok(ReplyVerdict::Resolved));
        assert!(handle.await.expect("gate task").is_ok(), "approved proceeds");
        id
    });

    let lines = lines_for(&home.dir, &id);
    assert!(count(&lines, "mcp.confirm", "start") >= 1, "lines: {lines:?}");
    assert_eq!(count(&lines, "mcp.confirm", "success"), 1, "lines: {lines:?}");
    assert_eq!(count(&lines, "mcp.confirm.reply", "success"), 1, "lines: {lines:?}");
    let reply = lines
        .iter()
        .find(|v| v["event"] == "mcp.confirm.reply" && v["status"] == "success")
        .expect("reply line");
    assert_eq!(reply["context"]["requestId"], id.as_str());
    assert_eq!(reply["context"]["verdict"], "resolved");
    for line in &lines {
        assert!(line["context"].get("documentTitle").is_none(), "{line}");
    }
}
