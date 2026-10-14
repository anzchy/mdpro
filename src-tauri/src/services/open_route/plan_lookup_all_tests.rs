//! Tests for `open_route::lookup_all` (D29 WI-3; D29-R3). The first two were
//! moved unchanged from `plan_tests.rs`. The populated-store test pins that
//! `lookup_all` really consults the store: with an empty store a hard-coded
//! miss would pass the pass-through test.
use super::{lookup_all, lookup_in_shared, RouteLookup, RouteTarget};
use crate::models::mcp::WindowState;
use crate::models::DocumentState;
use crate::services::shadow_store::create_shadow_store;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

type Lookups = Vec<(String, Result<RouteLookup, String>)>;

#[test]
fn lookup_all_without_store_is_err_per_path_in_order() {
    let paths = vec!["/in/p1".to_string(), "/in/p2".to_string()];
    let got = lookup_all(None, &paths, &HashSet::new());
    let got_paths: Vec<&str> = got.iter().map(|(p, _)| p.as_str()).collect();
    assert_eq!(got_paths, vec!["/in/p1", "/in/p2"]);
    assert!(got.iter().all(|(_, r)| r.is_err()), "{:?}", got);
}

#[test]
fn lookup_all_with_store_passes_each_path_through_lookup_in_shared() {
    let store = create_shadow_store();
    let live: HashSet<String> = ["main".to_string()].into_iter().collect();
    let paths = vec![
        "/in/p1".to_string(),
        "/in/p1".to_string(),
        "/in/p2".to_string(),
    ];
    let expected: Lookups = paths
        .iter()
        .map(|p| (p.clone(), lookup_in_shared(&store, p, &live)))
        .collect();
    assert_eq!(lookup_all(Some(&store), &paths, &live), expected);
}

/// A unique temp dir with two real files; removed (this directory only) on drop.
struct TempFiles {
    dir: PathBuf,
}

impl TempFiles {
    fn new(names: &[&str]) -> Self {
        let dir = std::env::temp_dir().join(format!("mdpro-lookup-all-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create temp dir");
        for name in names {
            fs::write(dir.join(name), *name).expect("write temp file");
        }
        TempFiles { dir }
    }

    fn path(&self, name: &str) -> String {
        self.dir.join(name).to_string_lossy().into_owned()
    }
}

impl Drop for TempFiles {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn lookup_all_with_populated_store_hits_the_stored_document_and_misses_others() {
    let files = TempFiles::new(&["held.md", "other.md"]);
    let held = files.path("held.md");
    let other = files.path("other.md");
    let store = create_shadow_store();
    store.lock().unwrap().windows.insert(
        "main".to_string(),
        WindowState {
            label: "main".to_string(),
            active_document_id: Some("doc-held".to_string()),
            documents: vec![DocumentState {
                id: "doc-held".to_string(),
                title: "held.md".to_string(),
                path: Some(held.clone()),
                content: String::new(),
                cursor: 0,
                is_dirty: false,
                is_active: true,
                over_limit: false,
            }],
            last_focused_at: 1,
            routable: true,
        },
    );
    let live: HashSet<String> = ["main".to_string()].into_iter().collect();
    let paths = vec![held.clone(), other.clone()];

    let got = lookup_all(Some(&store), &paths, &live);

    let expected: Lookups = vec![
        (
            held.clone(),
            Ok(RouteLookup {
                target: Some(RouteTarget {
                    window_label: "main".to_string(),
                    document_id: "doc-held".to_string(),
                    path: held.clone(),
                }),
                match_count: 1,
            }),
        ),
        (
            other.clone(),
            Ok(RouteLookup {
                target: None,
                match_count: 0,
            }),
        ),
    ];
    assert_eq!(got, expected);
}
