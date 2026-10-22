//! M4-WI-7: redacted v1 build summaries captured at the production logger seam.

use super::*;
use crate::menu_layout::menu_layout;
use crate::models::KeyboardShortcuts;
use crate::services::applied_shortcuts::{resolve_applied, AppliedBinding, AppliedSource};
use std::cell::RefCell;

#[test]
fn m4_wi7_one_build_summary_counts_items_and_never_exposes_chords() {
    let applied = AppliedShortcuts {
        keyboard_shortcuts_version: 1,
        source: AppliedSource::Loaded,
        bindings: resolve_applied(&KeyboardShortcuts::default()),
    };
    let entries = RefCell::new(Vec::new());
    let specs = menu_layout_for_with_logger(
        menu_layout().unwrap(),
        &applied,
        Some(ViewMode::Wysiwyg),
        |entry| entries.borrow_mut().push(entry),
    );
    let entries = entries.into_inner();
    let summaries: Vec<_> = entries
        .iter()
        .filter(|entry| entry.event == "ui.menu.build")
        .collect();
    assert_eq!(summaries.len(), 1);
    let summary = serde_json::to_value(summaries[0]).unwrap();
    assert_eq!(summary["context"]["version"], 1);
    assert_eq!(summary["context"]["itemCount"], specs.len());
    assert_eq!(
        summary["context"]["disabledCount"],
        specs.iter().filter(|s| !s.enabled).count()
    );
    assert!(summary["context"]["droppedAccelerators"].as_u64().is_some());
    let line = serde_json::to_string(summaries[0]).unwrap();
    assert!(!line.contains("Cmd+"));
    assert!(!line.contains("/Users/"));
}

#[test]
fn m4_wi7_conflicting_save_increases_the_dropped_count_by_one() {
    let mut applied = AppliedShortcuts {
        keyboard_shortcuts_version: 1,
        source: AppliedSource::Loaded,
        bindings: resolve_applied(&KeyboardShortcuts::default()),
    };
    let layout = menu_layout().unwrap();
    let entries = RefCell::new(Vec::new());
    let baseline =
        menu_layout_for_with_logger(layout, &applied, Some(ViewMode::Wysiwyg), |entry| {
            entries.borrow_mut().push(entry)
        });
    applied.bindings.insert(
        "fileSave".into(),
        AppliedBinding::Bound {
            chord: "Cmd+Z".into(),
        },
    );
    let conflict =
        menu_layout_for_with_logger(layout, &applied, Some(ViewMode::Wysiwyg), |entry| {
            entries.borrow_mut().push(entry)
        });
    assert_eq!(baseline.len(), conflict.len());
    assert!(baseline
        .iter()
        .find(|item| item.command_id == "file.save")
        .unwrap()
        .accelerator
        .is_some());
    assert_eq!(
        conflict
            .iter()
            .find(|item| item.command_id == "file.save")
            .unwrap()
            .accelerator,
        None
    );
    let counts: Vec<u64> = entries
        .into_inner()
        .into_iter()
        .filter(|entry| entry.event == "ui.menu.build")
        .map(|entry| {
            let context = entry.context.unwrap();
            assert_eq!(context["version"], 1);
            context["droppedAccelerators"].as_u64().unwrap()
        })
        .collect();
    assert_eq!(counts.len(), 2);
    assert_eq!(counts[1], counts[0] + 1);
}
