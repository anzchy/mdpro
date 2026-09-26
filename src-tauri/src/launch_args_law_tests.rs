//! Law tests for `launch_args::filter_launch_args` (D33, l1-l7): exhaustive
//! enumeration over fixed grids, no proptest dependency.

use super::test_fixtures::{abs, bases, cleanup, pool, rel_from_cwd, sequences, standard_dir};
use super::{filter_launch_args, DropCounts, DropReason};

/// Field-wise sum, written out by name so it never goes through `total()`.
fn add(a: &DropCounts, b: &DropCounts) -> DropCounts {
    DropCounts {
        flag: a.flag + b.flag,
        relative_without_cwd: a.relative_without_cwd + b.relative_without_cwd,
        unresolved: a.unresolved + b.unresolved,
        not_regular_file: a.not_regular_file + b.not_regular_file,
        not_markdown: a.not_markdown + b.not_markdown,
        non_utf8: a.non_utf8 + b.non_utf8,
    }
}

fn field_sum(c: &DropCounts) -> usize {
    c.flag
        + c.relative_without_cwd
        + c.unresolved
        + c.not_regular_file
        + c.not_markdown
        + c.non_utf8
}

/// Exhaustive, no `_` arm: a new variant fails compilation here.
fn field(r: DropReason, c: &DropCounts) -> usize {
    match r {
        DropReason::Flag => c.flag,
        DropReason::RelativeWithoutCwd => c.relative_without_cwd,
        DropReason::Unresolved => c.unresolved,
        DropReason::NotRegularFile => c.not_regular_file,
        DropReason::NotMarkdown => c.not_markdown,
        DropReason::NonUtf8 => c.non_utf8,
    }
}

fn field_mut(r: DropReason, c: &mut DropCounts) -> &mut usize {
    match r {
        DropReason::Flag => &mut c.flag,
        DropReason::RelativeWithoutCwd => &mut c.relative_without_cwd,
        DropReason::Unresolved => &mut c.unresolved,
        DropReason::NotRegularFile => &mut c.not_regular_file,
        DropReason::NotMarkdown => &mut c.not_markdown,
        DropReason::NonUtf8 => &mut c.non_utf8,
    }
}

#[test]
fn l1_conservation_and_partition_over_grid() {
    let dir = standard_dir("l1");
    let seqs = sequences(&pool(&dir), 3);
    assert_eq!(seqs.len(), 585, "grid size");
    for base in bases(&dir) {
        for args in &seqs {
            let result = filter_launch_args(args.clone(), base.as_deref());
            let total = result.dropped.total();
            let ctx = format!("args {args:?} base {base:?}");
            assert_eq!(result.paths.len() + total, args.len(), "{ctx}");
            assert_eq!(total, field_sum(&result.dropped), "{ctx}");
        }
    }
    cleanup(&dir);
}

#[test]
fn l2_per_argument_homomorphism_over_grid() {
    let dir = standard_dir("l2");
    let seqs = sequences(&pool(&dir), 3);
    for base in bases(&dir) {
        let b = base.as_deref();
        for args in &seqs {
            let whole = filter_launch_args(args.clone(), b);
            let mut paths = Vec::new();
            let mut dropped = DropCounts::default();
            for arg in args {
                let single = filter_launch_args(vec![arg.clone()], b);
                paths.extend(single.paths);
                dropped = add(&dropped, &single.dropped);
            }
            let ctx = format!("args {args:?} base {base:?}");
            assert_eq!(whole.paths, paths, "{ctx}");
            assert_eq!(whole.dropped, dropped, "{ctx}");
        }
    }
    cleanup(&dir);
}

#[test]
fn l3_absolute_arguments_are_base_independent() {
    let dir = standard_dir("l3");
    let other = standard_dir("l3_other");
    let mut args = vec![
        abs(&dir, "notes.md"),
        "/nonexistent/g.md".to_string(),
        abs(&dir, "dir.md"),
        abs(&dir, "data.txt"),
        abs(&dir, "sub/../notes.md"),
        abs(&dir, "-dash.md"),
    ];
    if cfg!(unix) {
        args.push(abs(&dir, "link.md"));
    }
    let mut all_bases = bases(&dir);
    all_bases.push(Some(other.clone()));
    for arg in &args {
        let reference = filter_launch_args(vec![arg.clone()], None);
        assert_eq!(
            reference.paths.len() + reference.dropped.total(),
            1,
            "arg {arg}"
        );
        for base in &all_bases {
            let result = filter_launch_args(vec![arg.clone()], base.as_deref());
            assert_eq!(result, reference, "arg {arg} base {base:?}");
        }
    }
    cleanup(&dir);
    cleanup(&other);
}

#[test]
fn l4_relative_under_absolute_base_equals_joined_absolute() {
    let dir = standard_dir("l4");
    let mut rels = vec![
        "notes.md",
        "./notes.md",
        "sub/../notes.md",
        "ghost.md",
        "dir.md",
        "data.txt",
        "plain_dir",
    ];
    if cfg!(unix) {
        rels.extend(["link.md", "dangling.md"]);
    }
    for r in rels {
        let joined = abs(&dir, r);
        let relative = filter_launch_args(vec![r.to_string()], Some(&dir));
        let absolute = filter_launch_args(vec![joined.clone()], None);
        assert_eq!(
            relative.paths.len() + relative.dropped.total(),
            1,
            "arg {r}"
        );
        assert_eq!(relative, absolute, "arg {r} vs {joined}");
    }
    cleanup(&dir);
}

#[test]
fn l5_legacy_wrapper_equals_filter_with_no_base() {
    let dir = standard_dir("l5");
    let mut items = pool(&dir);
    items.push(rel_from_cwd(&dir.join("notes.md")));
    if cfg!(unix) {
        items.push(abs(&dir, "link.md"));
    }
    let mut saw_accepted = false;
    for args in sequences(&items, 3) {
        let legacy = crate::launch::filter_launch_paths(args.clone());
        let filtered = filter_launch_args(args.clone(), None);
        saw_accepted |= !legacy.is_empty();
        assert_eq!(legacy, filtered.paths, "args {args:?}");
    }
    assert!(saw_accepted, "grid must exercise accepted paths");
    cleanup(&dir);
}

#[test]
fn l7_drop_reason_all_is_a_closed_set() {
    let all = DropReason::ALL;
    assert_eq!(all.len(), 6);
    for (i, a) in all.iter().enumerate() {
        for b in &all[i + 1..] {
            assert_ne!(a, b, "ALL must be pairwise distinct");
        }
    }
    for r in all {
        let mut c = DropCounts::default();
        *field_mut(r, &mut c) = 1;
        assert_eq!(field(r, &c), 1, "{r:?}");
        assert_eq!(c.total(), 1, "only {r:?} set");
    }
    let mut weighted = DropCounts::default();
    for (i, r) in all.into_iter().enumerate() {
        *field_mut(r, &mut weighted) = 1 << i;
    }
    assert_eq!(weighted.total(), 63);
}

#[test]
fn l8_filter_is_idempotent_across_bases_over_grid() {
    let dir = standard_dir("l8");
    let seqs = sequences(&pool(&dir), 3);
    let grid = bases(&dir);
    for base in &grid {
        for args in &seqs {
            let first = filter_launch_args(args.clone(), base.as_deref());
            for again in &grid {
                let second = filter_launch_args(first.paths.clone(), again.as_deref());
                let ctx = format!("args {args:?} base {base:?} then {again:?}");
                assert_eq!(second.paths, first.paths, "{ctx}");
                assert_eq!(second.dropped, DropCounts::default(), "{ctx}");
            }
        }
    }
    cleanup(&dir);
}

/// l8 over a pool whose accepted inputs are *not* already canonical: a
/// cwd-relative path (accepted only under `None`), a `..` path, and a
/// symlink. Accepted output must be a canonical absolute path, so it is a
/// fixed point of `canonicalize` and re-filters identically under any base.
#[test]
fn l9_idempotence_holds_for_non_canonical_accepted_inputs() {
    let dir = standard_dir("l9");
    let mut items = pool(&dir);
    items.push(rel_from_cwd(&dir.join("notes.md")));
    items.push(abs(&dir, "sub/../notes.md"));
    if cfg!(unix) {
        items.push(abs(&dir, "link.md"));
    }
    let grid = bases(&dir);
    let mut saw_non_canonical_input = false;
    for base in &grid {
        for args in sequences(&items, 2) {
            let first = filter_launch_args(args.clone(), base.as_deref());
            let ctx = format!("args {args:?} base {base:?}");
            for p in &first.paths {
                let fixed = std::path::Path::new(p).canonicalize().expect("accepted");
                assert_eq!(fixed.to_str(), Some(p.as_str()), "{ctx}");
                saw_non_canonical_input |= !args.contains(p);
            }
            for again in &grid {
                let second = filter_launch_args(first.paths.clone(), again.as_deref());
                assert_eq!(second.paths, first.paths, "{ctx} then {again:?}");
                assert_eq!(second.dropped, DropCounts::default(), "{ctx}");
            }
        }
    }
    assert!(
        saw_non_canonical_input,
        "grid must accept non-canonical input"
    );
    cleanup(&dir);
}
