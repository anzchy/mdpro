//! Tests for the single-instance helper and the args-filtered log level
//! (D33 WI-2: s1-s5, g0-g2). Payload tests live in
//! `launch_args_log_payload_tests.rs`.

use super::test_fixtures::{
    abs, canon, cleanup, count_grid, lf, pool, rel_from_cwd, sequences, slot, standard_dir,
};
use super::{
    args_filtered_log_level, filter_launch_args, single_instance_args, DropCounts, DropReason,
    LaunchFilter, LaunchSource,
};
use crate::models::log_entry::LogLevel;
use std::path::Path;

fn nonflag_sum(c: &DropCounts) -> usize {
    c.relative_without_cwd + c.unresolved + c.not_regular_file + c.not_markdown + c.non_utf8
}

fn le(a: &DropCounts, b: &DropCounts) -> bool {
    DropReason::ALL
        .iter()
        .all(|&r| *slot(r, &mut a.clone()) <= *slot(r, &mut b.clone()))
}

#[test]
fn s1_relative_arg_resolves_against_forwarded_cwd_and_exe_is_not_counted() {
    let dir = standard_dir("s1");
    let args = vec![abs(&dir, "data.txt"), "./notes.md".to_string()];
    let got = single_instance_args(args, dir.to_str().unwrap());
    assert_eq!(
        got,
        lf(vec![canon(&dir, "notes.md")], DropCounts::default())
    );
    cleanup(&dir);
}

#[test]
fn s2_args0_that_is_an_md_file_is_never_accepted() {
    let dir = standard_dir("s2");
    let cwd = dir.to_str().unwrap();
    let exe = abs(&dir, "notes.md");
    assert_eq!(
        single_instance_args(vec![exe.clone()], cwd),
        LaunchFilter::default()
    );
    let got = single_instance_args(vec![exe.clone(), exe], cwd);
    assert_eq!(
        got,
        lf(vec![canon(&dir, "notes.md")], DropCounts::default())
    );
    cleanup(&dir);
}

#[test]
fn s3_empty_and_exe_only_args_are_empty() {
    let dir = standard_dir("s3");
    let cwd = dir.to_str().unwrap();
    assert_eq!(single_instance_args(vec![], cwd), LaunchFilter::default());
    assert_eq!(single_instance_args(vec![], ""), LaunchFilter::default());
    let exe = vec![abs(&dir, "data.txt")];
    assert_eq!(single_instance_args(exe, cwd), LaunchFilter::default());
    cleanup(&dir);
}

#[test]
fn s4_empty_cwd_drops_relative_and_keeps_absolute() {
    let dir = standard_dir("s4");
    let args = vec![
        abs(&dir, "data.txt"),
        "notes.md".to_string(),
        rel_from_cwd(&dir.join("notes.md")),
        abs(&dir, "notes.md"),
    ];
    let expected = DropCounts {
        relative_without_cwd: 2,
        ..Default::default()
    };
    assert_eq!(
        single_instance_args(args, ""),
        lf(vec![canon(&dir, "notes.md")], expected)
    );
    cleanup(&dir);
}

#[test]
fn s5_conservation_and_equivalence_over_grid() {
    let dir = standard_dir("s5");
    let heads = vec![
        abs(&dir, "notes.md"),
        abs(&dir, "data.txt"),
        "--flag".to_string(),
    ];
    let mut inputs: Vec<Vec<String>> = vec![Vec::new()];
    for head in &heads {
        for tail in sequences(&pool(&dir), 3) {
            let mut v = vec![head.clone()];
            v.extend(tail);
            inputs.push(v);
        }
    }
    for cwd in [dir.to_str().unwrap(), "", "rel/dir"] {
        for v in &inputs {
            let got = single_instance_args(v.clone(), cwd);
            let len = v.len().saturating_sub(1);
            assert_eq!(
                got.paths.len() + got.dropped.total(),
                len,
                "{v:?} cwd={cwd:?}"
            );
            let rest = v.get(1..).unwrap_or_default().to_vec();
            let want = filter_launch_args(rest, Some(Path::new(cwd)));
            assert_eq!(got, want, "{v:?} cwd={cwd:?}");
        }
    }
    cleanup(&dir);
}

#[test]
fn g0_launch_source_labels_are_exact() {
    assert_eq!(LaunchSource::Cli.as_str(), "cli");
    assert_eq!(LaunchSource::SingleInstance.as_str(), "single_instance");
}

#[test]
fn g1_level_examples_over_the_closed_reason_set() {
    assert_eq!(
        args_filtered_log_level(&DropCounts::default()),
        LogLevel::Info
    );
    let flags = DropCounts {
        flag: 5,
        ..Default::default()
    };
    assert_eq!(args_filtered_log_level(&flags), LogLevel::Info);
    for r in DropReason::ALL {
        let mut c = DropCounts::default();
        *slot(r, &mut c) = 1;
        let want = match r {
            DropReason::Flag => LogLevel::Info,
            DropReason::RelativeWithoutCwd
            | DropReason::Unresolved
            | DropReason::NotRegularFile
            | DropReason::NotMarkdown
            | DropReason::NonUtf8 => LogLevel::Warn,
        };
        assert_eq!(args_filtered_log_level(&c), want, "reason {r:?}");
    }
}

#[test]
fn g2_level_characteristic_monotonic_and_flag_invariant() {
    let grid = count_grid();
    assert_eq!(grid.len(), 729);
    for c in &grid {
        let want = if nonflag_sum(c) > 0 {
            LogLevel::Warn
        } else {
            LogLevel::Info
        };
        assert_eq!(args_filtered_log_level(c), want, "{c:?}");
        let no_flag = DropCounts {
            flag: 0,
            ..c.clone()
        };
        assert_eq!(
            args_filtered_log_level(c),
            args_filtered_log_level(&no_flag),
            "{c:?}"
        );
    }
    for c1 in &grid {
        for c2 in grid.iter().filter(|c2| le(c1, c2)) {
            let (r1, r2) = (
                args_filtered_log_level(c1).rank(),
                args_filtered_log_level(c2).rank(),
            );
            assert!(r1 <= r2, "{c1:?} <= {c2:?} but rank {r1} > {r2}");
        }
    }
}
