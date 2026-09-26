//! Tests for the count-only `file.open.args_filtered` log payload
//! (D33 WI-2: p1-p4).

use super::test_fixtures::{cleanup, count_grid, pool, sequences, slot, standard_dir};
use super::{
    args_filtered_log_entry, args_filtered_log_level, filter_launch_args, DropCounts, DropReason,
    LaunchFilter, LaunchSource,
};
use crate::models::log_entry::LogLevel;
use serde_json::{json, Value};

fn sv(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// Context key for each reason; exhaustive, no `_` arm.
fn key(r: DropReason) -> &'static str {
    match r {
        DropReason::Flag => "flag",
        DropReason::RelativeWithoutCwd => "relative_without_cwd",
        DropReason::Unresolved => "unresolved",
        DropReason::NotRegularFile => "not_regular_file",
        DropReason::NotMarkdown => "not_markdown",
        DropReason::NonUtf8 => "non_utf8",
    }
}

#[test]
fn p1_exact_payload_for_both_sources() {
    let filter = LaunchFilter {
        paths: sv(&["/a.md", "/b.md", "/c.md"]),
        dropped: DropCounts {
            flag: 1,
            relative_without_cwd: 2,
            unresolved: 4,
            not_regular_file: 5,
            not_markdown: 6,
            non_utf8: 7,
        },
    };
    for (source, label) in [
        (LaunchSource::Cli, "cli"),
        (LaunchSource::SingleInstance, "single_instance"),
    ] {
        let got = serde_json::to_value(args_filtered_log_entry(source, &filter)).unwrap();
        let want = json!({
            "level": "warn",
            "event": "file.open.args_filtered",
            "status": "success",
            "actionId": null,
            "context": {
                "source": label,
                "accepted": 3,
                "dropped": {
                    "flag": 1, "relative_without_cwd": 2, "unresolved": 4,
                    "not_regular_file": 5, "not_markdown": 6, "non_utf8": 7
                }
            },
            "durationMs": null,
            "error": null
        });
        assert_eq!(got, want, "source {label}");
    }
}

#[test]
fn p2_info_entry_with_zero_counts_keeps_every_key() {
    let entry = args_filtered_log_entry(LaunchSource::Cli, &LaunchFilter::default());
    assert_eq!(entry.level, LogLevel::Info);
    let want = json!({
        "source": "cli",
        "accepted": 0,
        "dropped": {
            "flag": 0, "relative_without_cwd": 0, "unresolved": 0,
            "not_regular_file": 0, "not_markdown": 0, "non_utf8": 0
        }
    });
    assert_eq!(entry.context, Some(want));
}

#[test]
fn p3_round_trip_and_level_consistency() {
    for c in count_grid() {
        for accepted in [0usize, 1, 3] {
            let paths = (0..accepted).map(|i| format!("/p{i}.md")).collect();
            let filter = LaunchFilter {
                paths,
                dropped: c.clone(),
            };
            for source in [LaunchSource::Cli, LaunchSource::SingleInstance] {
                let entry = args_filtered_log_entry(source, &filter);
                assert_eq!(entry.level, args_filtered_log_level(&c), "{c:?}");
                let ctx: Value = entry.context.expect("context present");
                assert_eq!(ctx["accepted"], json!(accepted));
                assert_eq!(ctx["source"], json!(source.as_str()));
                let dropped = ctx["dropped"].as_object().expect("dropped object");
                assert_eq!(dropped.len(), 6, "{dropped:?}");
                let mut back = DropCounts::default();
                for r in DropReason::ALL {
                    let n = dropped[key(r)].as_u64().expect("count") as usize;
                    *slot(r, &mut back) = n;
                }
                assert_eq!(back, c);
            }
        }
    }
}

fn assert_redacted(filter: &LaunchFilter, forbidden: &[&str]) {
    for source in [LaunchSource::Cli, LaunchSource::SingleInstance] {
        let s = serde_json::to_string(&args_filtered_log_entry(source, filter)).unwrap();
        assert!(
            s.contains("file.open.args_filtered"),
            "entry not built: {s}"
        );
        for bad in forbidden.iter().copied().chain([".md\""]) {
            assert!(!s.contains(bad), "payload leaks {bad:?}: {s}");
        }
    }
}

#[test]
fn p4_serialized_payload_contains_no_path() {
    let dir = standard_dir("p4");
    let dir_str = dir.to_str().unwrap().to_string();
    for args in sequences(&pool(&dir), 3) {
        let filter = filter_launch_args(args, Some(&dir));
        assert_redacted(&filter, &[&dir_str]);
    }
    let synthetic = LaunchFilter {
        paths: sv(&["/Users/SECRET_d33/notes.md", "/tmp/ZZ_ARG_MARKER/x.md"]),
        dropped: DropCounts {
            unresolved: 1,
            ..Default::default()
        },
    };
    assert_redacted(&synthetic, &["SECRET_d33", "ZZ_ARG_MARKER", &dir_str]);
    cleanup(&dir);
}
