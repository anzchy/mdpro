//! Example and boundary tests for `launch_args::filter_launch_args` (D33, f1-f17).

use super::test_fixtures::{
    abs, bases, canon, cleanup, fixture_dir, lf, rel_from_cwd, run, standard_dir,
};
use super::{DropCounts, LaunchFilter};
use std::path::{Path, PathBuf};

fn none() -> DropCounts {
    DropCounts::default()
}

#[test]
fn f1_bare_relative_name_resolves_against_explicit_base() {
    let dir = standard_dir("f1");
    let result = run(&["notes.md"], Some(&dir));
    assert_eq!(result, lf(vec![canon(&dir, "notes.md")], none()));
    cleanup(&dir);
}

#[test]
fn f2_relative_spellings_resolve_to_same_canonical_file() {
    let dir = standard_dir("f2");
    let c = canon(&dir, "notes.md");
    let result = run(
        &["./notes.md", "sub/../notes.md", "./sub/../notes.md"],
        Some(&dir),
    );
    assert_eq!(result.paths, vec![c.clone(), c.clone(), c]);
    assert_eq!(result.dropped, none());
    cleanup(&dir);
}

#[cfg(unix)]
#[test]
fn f3_relative_symlink_resolves_and_canonical_extension_decides() {
    let dir = standard_dir("f3");
    let result = run(&["link.md", "link_to_txt.md", "link.txt"], Some(&dir));
    let c = canon(&dir, "notes.md");
    assert_eq!(result.paths, vec![c.clone(), c]);
    let expected = DropCounts {
        not_markdown: 1,
        ..Default::default()
    };
    assert_eq!(result.dropped, expected);
    cleanup(&dir);
}

#[test]
fn f4_no_process_cwd_fallback_for_empty_or_relative_base() {
    let dir = standard_dir("f4");
    let r = rel_from_cwd(&dir.join("notes.md"));
    // Precondition: the relative spelling genuinely resolves from the cwd.
    assert_eq!(
        Path::new(&r).canonicalize().ok(),
        dir.join("notes.md").canonicalize().ok()
    );
    let rwc = DropCounts {
        relative_without_cwd: 1,
        ..Default::default()
    };
    assert_eq!(run(&[&r], None), lf(vec![canon(&dir, "notes.md")], none()));
    assert_eq!(run(&[&r], Some(Path::new(""))), lf(vec![], rwc.clone()));
    assert_eq!(run(&[&r], Some(Path::new("rel/dir"))), lf(vec![], rwc));
    cleanup(&dir);
}

#[test]
fn f5_relative_base_that_exists_from_cwd_is_not_joined() {
    let dir = standard_dir("f5");
    let base = rel_from_cwd(&dir);
    assert!(
        Path::new(&base).is_dir(),
        "precondition: base resolves from cwd"
    );
    let rwc = DropCounts {
        relative_without_cwd: 1,
        ..Default::default()
    };
    assert_eq!(run(&["notes.md"], Some(Path::new(&base))), lf(vec![], rwc));
    cleanup(&dir);
}

#[test]
fn f6_unusable_absolute_base_drops_as_unresolved() {
    let dir = standard_dir("f6");
    let unresolved = DropCounts {
        unresolved: 1,
        ..Default::default()
    };
    let missing = Path::new("/nonexistent/mdpro_d33/x");
    assert_eq!(
        run(&["notes.md"], Some(missing)),
        lf(vec![], unresolved.clone())
    );
    let file_base = dir.join("notes.md");
    assert_eq!(run(&["notes.md"], Some(&file_base)), lf(vec![], unresolved));
    cleanup(&dir);
}

#[test]
fn f7_absolute_base_with_dotdot_or_trailing_slash_resolves() {
    let dir = standard_dir("f7");
    let expected = lf(vec![canon(&dir, "notes.md")], none());
    let dotdot = dir.join("sub").join("..");
    assert_eq!(run(&["notes.md"], Some(&dotdot)), expected);
    let slash = PathBuf::from(format!("{}/", dir.to_str().expect("utf-8")));
    assert_eq!(run(&["notes.md"], Some(&slash)), expected);
    cleanup(&dir);
}

#[test]
fn f8_flags_across_three_bases() {
    let dir = standard_dir("f8");
    let flags = DropCounts {
        flag: 3,
        ..Default::default()
    };
    for base in [None, Some(dir.as_path()), Some(Path::new(""))] {
        let result = run(&["--devtools", "-v", "-"], base);
        assert_eq!(result, lf(vec![], flags.clone()), "base {base:?}");
    }
    cleanup(&dir);
}

#[test]
fn f9_leading_dash_file_is_resolved_through_the_base() {
    let dir_a = standard_dir("f9a");
    let dir_b = fixture_dir("f9b");
    let flag = DropCounts {
        flag: 1,
        ..Default::default()
    };
    let accepted = lf(vec![canon(&dir_a, "-dash.md")], none());
    assert_eq!(run(&["-dash.md"], Some(&dir_a)), accepted);
    assert_eq!(run(&["-dash.md"], Some(&dir_b)), lf(vec![], flag.clone()));
    assert_eq!(run(&["-dash.md"], Some(Path::new(""))), lf(vec![], flag));
    cleanup(&dir_a);
    cleanup(&dir_b);
}

#[test]
fn f10_leading_dash_directory_is_still_a_flag() {
    let dir = fixture_dir("f10");
    std::fs::create_dir_all(dir.join("--devtools")).expect("create dir");
    let flag = DropCounts {
        flag: 1,
        ..Default::default()
    };
    assert_eq!(run(&["--devtools"], Some(&dir)), lf(vec![], flag));
    cleanup(&dir);
}

#[test]
fn f10b_leading_dash_regular_file_falls_through_to_later_checks() {
    let dir = standard_dir("f10b");
    let not_md = DropCounts {
        not_markdown: 1,
        ..Default::default()
    };
    assert_eq!(run(&["-data.txt"], Some(&dir)), lf(vec![], not_md.clone()));
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("data.txt", dir.join("-link.md")).expect("symlink");
        assert_eq!(run(&["-link.md"], Some(&dir)), lf(vec![], not_md));
    }
    cleanup(&dir);
}

#[test]
fn f11_each_drop_reason_maps_to_exactly_one_counter() {
    let dir = standard_dir("f11");
    let d = Some(dir.as_path());
    let unresolved = DropCounts {
        unresolved: 1,
        ..Default::default()
    };
    assert_eq!(run(&["ghost.md"], d), lf(vec![], unresolved.clone()));
    let missing = "/nonexistent/mdpro/ghost.md";
    assert_eq!(run(&[missing], d), lf(vec![], unresolved.clone()));
    #[cfg(unix)]
    assert_eq!(run(&["dangling.md"], d), lf(vec![], unresolved));
    let not_reg = DropCounts {
        not_regular_file: 1,
        ..Default::default()
    };
    assert_eq!(run(&["dir.md"], d), lf(vec![], not_reg));
    let not_md = DropCounts {
        not_markdown: 1,
        ..Default::default()
    };
    assert_eq!(run(&["data.txt"], d), lf(vec![], not_md));
    let flag = DropCounts {
        flag: 1,
        ..Default::default()
    };
    assert_eq!(run(&["--x"], d), lf(vec![], flag));
    let rwc = DropCounts {
        relative_without_cwd: 1,
        ..Default::default()
    };
    assert_eq!(run(&["notes.md"], Some(Path::new(""))), lf(vec![], rwc));
    cleanup(&dir);
}

#[test]
fn f12_plain_directory_is_not_regular_file_before_not_markdown() {
    let dir = standard_dir("f12");
    let not_reg = DropCounts {
        not_regular_file: 1,
        ..Default::default()
    };
    assert_eq!(run(&["plain_dir"], Some(&dir)), lf(vec![], not_reg));
    cleanup(&dir);
}

#[test]
fn f13_extension_matching_boundary_set() {
    let dir = fixture_dir("f13");
    let names = ["README.MARKDOWN", "a.Md", "b.mdx", "c.md.bak", ".md", "md"];
    for name in names {
        std::fs::write(dir.join(name), b"x").expect("write");
    }
    let result = run(&names, Some(&dir));
    let accepted = vec![canon(&dir, "README.MARKDOWN"), canon(&dir, "a.Md")];
    assert_eq!(result.paths, accepted);
    let not_md = DropCounts {
        not_markdown: 4,
        ..Default::default()
    };
    assert_eq!(result.dropped, not_md);
    cleanup(&dir);
}

#[test]
fn f14_empty_string_argument_pinned_per_base_class() {
    let dir = standard_dir("f14");
    let unresolved = DropCounts {
        unresolved: 1,
        ..Default::default()
    };
    assert_eq!(run(&[""], None), lf(vec![], unresolved));
    let not_reg = DropCounts {
        not_regular_file: 1,
        ..Default::default()
    };
    assert_eq!(run(&[""], Some(&dir)), lf(vec![], not_reg));
    let rwc = DropCounts {
        relative_without_cwd: 1,
        ..Default::default()
    };
    assert_eq!(run(&[""], Some(Path::new(""))), lf(vec![], rwc));
    cleanup(&dir);
}

#[test]
fn f15_empty_args_give_default_for_every_base() {
    let dir = standard_dir("f15");
    for base in bases(&dir) {
        let result = run(&[], base.as_deref());
        assert_eq!(result, LaunchFilter::default(), "base {base:?}");
    }
    cleanup(&dir);
}

#[test]
fn f16_order_preserved_and_duplicates_kept() {
    let dir = fixture_dir("f16");
    std::fs::write(dir.join("a.md"), b"x").expect("write");
    std::fs::write(dir.join("b.md"), b"x").expect("write");
    let a = abs(&dir, "a.md");
    let result = run(&["b.md", &a, "./b.md"], Some(&dir));
    let (ca, cb) = (canon(&dir, "a.md"), canon(&dir, "b.md"));
    assert_eq!(result.paths, vec![cb.clone(), ca, cb]);
    cleanup(&dir);
}

#[cfg(target_os = "linux")]
#[test]
fn f17_non_utf8_canonical_target_is_dropped() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    let dir = fixture_dir("f17");
    let raw = dir.join(OsStr::from_bytes(b"\xff.md"));
    std::fs::write(&raw, b"x").expect("write non-utf8 file");
    std::os::unix::fs::symlink(&raw, dir.join("nu.md")).expect("symlink");
    let non_utf8 = DropCounts {
        non_utf8: 1,
        ..Default::default()
    };
    assert_eq!(run(&["nu.md"], Some(&dir)), lf(vec![], non_utf8));
    cleanup(&dir);
}
