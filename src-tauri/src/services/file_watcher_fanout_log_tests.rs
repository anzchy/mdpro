//! D185-WI-2: the `file.watch.fanout` line. Logged only when the fan-out
//! added a spelling or an emit failed; its context carries `recipients` (a
//! count) and `failed_spellings` (every spelling whose emit failed, `[]`
//! when none). A refused emit is tried once and never retried. Mounted from
//! file_watcher_fanout_tests.rs, whose fixtures it shares.
use super::super::super::kinds_fixture::T;
use super::super::super::save_notice::{NoticeSink, SaveNotice};
use super::super::super::{FileChangedEvent, FileWatcher};
use super::super::fan_out;
use super::{acquire, s, sink_over, sorted, spellings, W1, W2};
use crate::commands::file_save_fixture::Dir;
use crate::models::log_entry::{LogEntryPayload, LogLevel, LogStatus};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// A sink that records every plain emit and refuses the one at `refuse`.
struct RefuseAt {
    refuse: String,
    plain: Mutex<Vec<FileChangedEvent>>,
}

impl RefuseAt {
    fn new(refuse: &str) -> Arc<Self> {
        Arc::new(Self {
            refuse: refuse.to_string(),
            plain: Mutex::default(),
        })
    }

    fn sent(&self) -> Vec<String> {
        let plain = self.plain.lock().unwrap_or_else(|e| e.into_inner());
        sorted(plain.iter().map(|e| e.path.clone()).collect())
    }
}

impl NoticeSink for RefuseAt {
    fn emit_notice(&self, _: &SaveNotice) -> Result<(), String> {
        Err("RefuseAt: the watcher never sends an origin".to_string())
    }

    fn emit_plain(&self, event: &FileChangedEvent) -> Result<(), String> {
        self.plain
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(event.clone());
        if event.path == self.refuse {
            Err(format!("RefuseAt: refused {}", event.path))
        } else {
            Ok(())
        }
    }
}

fn modified_at(p: &Path) -> FileChangedEvent {
    FileChangedEvent {
        path: s(p),
        change_type: "modified".to_string(),
        new_path: None,
        timestamp: T,
    }
}

fn ctx(line: &LogEntryPayload) -> &Value {
    line.context
        .as_ref()
        .expect("the fanout line has a context")
}

#[test]
fn d185_wi2_h_fanout_line_counts_recipients_and_names_failed_spellings() {
    let d = Dir::new("d185_wi2_h");
    let f = spellings(&d);
    let (fw, _notices) = FileWatcher::for_tests_noticed();
    acquire(&fw, W1, &f.canonical);
    acquire(&fw, W2, &f.alias);
    let event = modified_at(&f.canonical);

    let ok = RefuseAt::new("nothing");
    let line = fan_out(&sink_over(&fw, Arc::clone(&ok) as _), &event);
    assert!(line.is_some(), "an added spelling is logged: {line:?}");
    let line = line.expect("checked above");
    assert_eq!(line.event, "file.watch.fanout");
    assert_eq!(
        (line.level, line.status),
        (LogLevel::Info, LogStatus::Success)
    );
    assert_eq!(ctx(&line)["recipients"], 2);
    assert_eq!(ctx(&line)["failed_spellings"], json!([]));

    let refusing = RefuseAt::new(&s(&f.alias));
    let line = fan_out(&sink_over(&fw, Arc::clone(&refusing) as _), &event);
    assert_eq!(
        refusing.sent(),
        sorted(vec![s(&f.canonical), s(&f.alias)]),
        "every recipient is tried once, the refused one included"
    );
    assert!(line.is_some(), "a failed emit is logged: {line:?}");
    let line = line.expect("checked above");
    assert_eq!(
        (line.level, line.status),
        (LogLevel::Error, LogStatus::Fail)
    );
    assert_eq!(ctx(&line)["recipients"], 2);
    assert_eq!(ctx(&line)["failed_spellings"], json!([s(&f.alias)]));
}

/// Guard: only the event path is a recipient (it is the one held string),
/// every emit succeeds: no fanout line.
#[test]
fn d185_wi2_h2_no_fanout_line_when_only_the_event_path_is_a_recipient() {
    let d = Dir::new("d185_wi2_h2");
    let f = spellings(&d);
    let (fw, _notices) = FileWatcher::for_tests_noticed();
    acquire(&fw, W1, &f.canonical);
    acquire(&fw, W2, &f.canonical);

    let sink = RefuseAt::new("nothing");
    let line = fan_out(
        &sink_over(&fw, Arc::clone(&sink) as _),
        &modified_at(&f.canonical),
    );
    assert!(line.is_none(), "nothing added, nothing failed: {line:?}");
    assert_eq!(sink.sent(), vec![s(&f.canonical)]);
}

#[test]
fn d185_wi2_h3_refused_event_path_is_named_in_failed_spellings() {
    let d = Dir::new("d185_wi2_h3");
    let f = spellings(&d);
    let (fw, _notices) = FileWatcher::for_tests_noticed();

    let sink = RefuseAt::new(&s(&f.canonical));
    let line = fan_out(
        &sink_over(&fw, Arc::clone(&sink) as _),
        &modified_at(&f.canonical),
    );
    assert!(line.is_some(), "a failed emit is logged: {line:?}");
    let line = line.expect("checked above");
    assert_eq!(ctx(&line)["recipients"], 1);
    assert_eq!(ctx(&line)["failed_spellings"], json!([s(&f.canonical)]));
}
