//! Test-only fixture for the draft tests: a temp `$HOME` held under
//! `crate::HOME_LOCK`, raw bundle and legacy-pair I/O, raw bundle JSON
//! builders, and `LiveContext` builders. Not every test file uses every
//! helper, so each `#[path]` mount outside `draft/` carries its own
//! `#[allow(dead_code)]` (D157: an inner allow here duplicated those).
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::MutexGuard;

use super::{DraftOwner, LiveContext, OpenSet, ShadowUnavailable};
use crate::models::{DraftMetadata, ShadowStore};
use crate::HOME_LOCK;

struct HomeRestorer(Option<String>);
impl Drop for HomeRestorer {
    fn drop(&mut self) {
        match &self.0 {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
    }
}

/// A fresh `temp_dir()/mdpro_test/<label>` set as `$HOME` for its lifetime.
/// Field order matters: `$HOME` is restored before the lock is released.
pub(super) struct TempHome {
    home: PathBuf,
    _restore: HomeRestorer,
    _lock: MutexGuard<'static, ()>,
}

impl TempHome {
    pub(super) fn new(label: &str) -> Self {
        let lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = std::env::temp_dir().join("mdpro_test").join(label);
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).expect("create temp home");
        let prev = std::env::var("HOME").ok();
        // SAFETY: HOME_LOCK is held for the lifetime of this value.
        unsafe { std::env::set_var("HOME", home.to_str().expect("temp home is UTF-8")) };
        TempHome {
            home,
            _restore: HomeRestorer(prev),
            _lock: lock,
        }
    }

    pub(super) fn path(&self) -> &Path {
        &self.home
    }

    /// The drafts directory, proven to be inside the temp home first.
    pub(super) fn drafts_dir(&self) -> PathBuf {
        let data = dirs::data_dir().expect("data dir");
        assert!(
            data.starts_with(&self.home),
            "data_dir() {data:?} escaped temp HOME {:?}",
            self.home
        );
        data.join("mdpro").join("drafts")
    }

    pub(super) fn bundle(&self, id: &str) -> PathBuf {
        self.drafts_dir().join(format!("{id}.draft.json"))
    }

    pub(super) fn write_raw(&self, id: &str, json: &str) {
        fs::create_dir_all(self.drafts_dir()).expect("create drafts dir");
        fs::write(self.bundle(id), json).expect("write raw bundle");
    }

    pub(super) fn read_raw(&self, id: &str) -> Vec<u8> {
        fs::read(self.bundle(id)).expect("read raw bundle")
    }

    /// The bundle parsed as JSON.
    pub(super) fn value(&self, id: &str) -> serde_json::Value {
        serde_json::from_slice(&self.read_raw(id)).expect("bundle parses")
    }

    pub(super) fn exists(&self, id: &str) -> bool {
        self.bundle(id).exists()
    }

    pub(super) fn legacy_md(&self, id: &str) -> PathBuf {
        self.drafts_dir().join(format!("{id}.draft.md"))
    }

    pub(super) fn legacy_meta(&self, id: &str) -> PathBuf {
        self.drafts_dir().join(format!("{id}.meta.json"))
    }

    /// A pre-bundle two-file draft.
    pub(super) fn write_legacy(
        &self,
        id: &str,
        content: &str,
        path: Option<&str>,
        last_modified: &str,
        recovered: bool,
    ) {
        fs::create_dir_all(self.drafts_dir()).expect("create drafts dir");
        fs::write(self.legacy_md(id), content).expect("write legacy md");
        let meta = serde_json::to_string_pretty(&DraftMetadata {
            original_path: path.map(str::to_string),
            last_modified: last_modified.to_string(),
            recovered,
            title: format!("legacy {id}"),
        })
        .expect("serialize legacy meta");
        fs::write(self.legacy_meta(id), meta).expect("write legacy meta");
    }

    /// Every file in the drafts dir, by name, with its bytes.
    pub(super) fn snapshot(&self) -> BTreeMap<String, Vec<u8>> {
        let mut out = BTreeMap::new();
        let Ok(items) = fs::read_dir(self.drafts_dir()) else {
            return out;
        };
        for item in items {
            let path = item.expect("dir entry").path();
            let name = path
                .file_name()
                .expect("file name")
                .to_string_lossy()
                .into_owned();
            out.insert(name, fs::read(&path).expect("read draft file"));
        }
        out
    }
}

/// An RFC 3339 timestamp `days` days ago.
pub(super) fn ago(days: i64) -> String {
    (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339()
}

/// Raw bundle JSON; `owner` is `(session, label)`, and `None` omits the key.
pub(super) fn bundle_json(
    content: &str,
    path: Option<&str>,
    last_modified: &str,
    recovered: bool,
    owner: Option<(&str, &str)>,
) -> String {
    let mut v = serde_json::json!({
        "content": content,
        "originalPath": path,
        "lastModified": last_modified,
        "recovered": recovered,
        "title": "t",
    });
    if let Some((s, l)) = owner {
        v["owner"] = serde_json::json!({"sessionId": s, "windowLabel": l});
    }
    v.to_string()
}

/// A `DraftOwner` from `(session, label)`.
pub(super) fn who(session: &str, label: &str) -> DraftOwner {
    DraftOwner {
        session_id: session.to_string(),
        window_label: label.to_string(),
    }
}

impl Drop for TempHome {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.home);
    }
}

fn labels(live: &[&str]) -> std::collections::HashSet<String> {
    live.iter().map(|l| l.to_string()).collect()
}

/// A context whose open set is a snapshot of `store`.
pub(super) fn ctx(session: &str, live: &[&str], store: &ShadowStore) -> LiveContext {
    LiveContext {
        session_id: session.to_string(),
        live_labels: labels(live),
        open: Ok(OpenSet::from_store(store)),
    }
}

/// A context whose shadow store could not be read.
pub(super) fn ctx_unavailable(session: &str, live: &[&str]) -> LiveContext {
    LiveContext {
        session_id: session.to_string(),
        live_labels: labels(live),
        open: Err(ShadowUnavailable),
    }
}
