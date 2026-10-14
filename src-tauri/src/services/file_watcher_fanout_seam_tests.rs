//! D185-WI-1: the watcher's emit seam, with no behaviour change.
//! - `d185_wi1_a`: with no holds, every event the route emits reaches the
//!   sink exactly once, at its own path, byte-identical to what
//!   `observe_event` returned, and logs no `file.watch.fanout` line.
//! - `d185_wi1_h`: a refused emit is sent once, never retried, and yields
//!   one `file.watch.fanout` line at error level.
//! - `d185_wi1_k` (source tripwire): the callback's sink cannot reach lock
//!   T, and the leaf's lookup canonicalizes outside H.
use super::super::holders::Holders;
use super::super::kinds_fixture::{all_event_kinds, code_lines, stat_spy, unique_path, T};
use super::super::observe_event;
use super::super::test_support::NoticeRecorder;
use super::super::{BaselineStore, FileChangedEvent};
use super::{fan_out, EventSink};
use crate::models::log_entry::{LogLevel, LogStatus};
use notify::Event;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

const FANOUT_SRC: &str = include_str!("file_watcher_fanout.rs");
const LEAF_SRC: &str = include_str!("file_watcher_holders_fanout.rs");
const WATCHER_SRC: &str = include_str!("file_watcher.rs");

fn sink() -> (EventSink, Arc<NoticeRecorder>) {
    let recorder = Arc::new(NoticeRecorder::default());
    let sink = EventSink {
        notices: Arc::clone(&recorder) as _,
        holders: Holders::default().leaf(),
    };
    (sink, recorder)
}

/// Every event the route emits for a fresh, never-held path, one per kind.
fn routed_events() -> Vec<FileChangedEvent> {
    let mut out = Vec::new();
    for kind in all_event_kinds() {
        let event = Event::new(kind).add_path(unique_path("d185_wi1"));
        let map = Mutex::new(HashMap::new());
        let (_, spy) = stat_spy();
        let (emitted, _) = observe_event(&event, &map, &BaselineStore::default(), T, spy);
        out.extend(emitted);
    }
    out
}

fn prod(src: &str) -> String {
    let cut = src.find("\n#[cfg(test)]").unwrap_or(src.len());
    code_lines(&src[..cut]).collect::<Vec<_>>().join("\n")
}

#[test]
fn d185_wi1_a_unheld_event_is_emitted_once_byte_identical() {
    let events = routed_events();
    assert!(!events.is_empty(), "non-vacuity: some kind emits");
    for event in events {
        let (sink, recorder) = sink();
        let line = fan_out(&sink, &event);
        assert!(line.is_none(), "no fanout line for {event:?}: {line:?}");
        let sent = recorder.sent_plain();
        assert_eq!(sent.len(), 1, "exactly one emit for {event:?}");
        assert_eq!(
            serde_json::to_string(&sent[0]).expect("json"),
            serde_json::to_string(&event).expect("json"),
            "the emitted payload is the routed one, byte for byte"
        );
        assert!(recorder.sent().is_empty(), "no origin-carrying notice");
    }
}

#[test]
fn d185_wi1_h_refused_emit_is_logged_once_at_error_not_retried() {
    let event = routed_events().remove(0);
    let (sink, recorder) = sink();
    recorder.refuse();
    let line = fan_out(&sink, &event).expect("a failed emit is logged");
    assert_eq!(recorder.sent_plain().len(), 1, "sent once, never retried");
    assert_eq!(line.event, "file.watch.fanout");
    assert_eq!(line.level, LogLevel::Error);
    assert_eq!(line.status, LogStatus::Fail);
    assert_eq!(line.error.as_deref(), Some("notice recorder: emit refused"));
    assert_eq!(
        line.context,
        Some(json!({
            "path": event.path,
            "changeType": event.change_type,
            "timestamp": T,
            "recipients": 1,
            "emitted": 0,
            "failed": 1,
        }))
    );
}

#[test]
fn d185_wi1_k_callback_sink_cannot_reach_the_transition_lock() {
    let (fanout, leaf) = (prod(FANOUT_SRC), prod(LEAF_SRC));
    for (name, src) in [("fanout", &fanout), ("holders_fanout", &leaf)] {
        for banned in ["transitions", "TransitionGuard", "transition("] {
            assert!(!src.contains(banned), "{name} names T (`{banned}`):\n{src}");
        }
    }
    assert!(
        !fanout.contains("Holders") && !fanout.contains("FileWatcher"),
        "the callback's sink holds neither Holders nor FileWatcher:\n{fanout}"
    );
    assert!(fanout.contains("holders: HoldsLeaf"), "{fanout}");
    let leaf_struct = &leaf[leaf.find("pub(crate) struct HoldsLeaf").expect("HoldsLeaf")..];
    let leaf_struct = &leaf_struct[..leaf_struct.find('}').expect("struct closes")];
    assert_eq!(
        leaf_struct.matches(':').count(),
        1,
        "HoldsLeaf has one field, the map: {leaf_struct}"
    );
    assert!(leaf_struct.contains("Arc<Mutex<HoldMap>>"), "{leaf_struct}");

    assert_eq!(leaf.matches("with_map(").count(), 1, "one H step:\n{leaf}");
    let at = leaf.find("with_map(").expect("with_map");
    let arg = &leaf[at..at + leaf[at..].find(");").expect("call closes")];
    for banned in ["canonicalize", "group_key", "fs::", ".lock("] {
        assert!(!arg.contains(banned), "`{banned}` under H: {arg}");
    }
    assert!(
        leaf.find("group_key(raw)").expect("group_key") < at,
        "the group key is computed before H:\n{leaf}"
    );

    let new = &WATCHER_SRC[WATCHER_SRC.find("pub fn new(").expect("new")..];
    let new = &new[..new.find("\n    }").expect("new closes")];
    assert!(
        new.contains("holders.leaf()"),
        "the callback gets the leaf:\n{new}"
    );
    assert!(
        new.contains("Ok(event) => handle_event(&sink,"),
        "the callback emits through the sink:\n{new}"
    );
}
