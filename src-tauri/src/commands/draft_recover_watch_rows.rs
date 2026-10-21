//! Test-only row builders shared by the D59 WI-2 law files: the D59-5
//! refusal rows and the D59-L1 draft shapes, named as in the matrix. Mounted
//! as a child of each test file, next to `draft_fixture`, `draft_test_home`
//! and `fx`.
use super::draft_fixture::{doc, store_of, win};
use super::draft_test_home::{ago, bundle_json, ctx, ctx_unavailable, TempHome};
use super::fx::{empty_ctx, s, seed, S};
use crate::models::ShadowStore;
use crate::services::draft::{DraftError, LiveContext};
use std::fs;
use std::path::Path;

/// D59-5 / D59-L2 refusal rows, named as in the matrix.
pub(super) const REFUSALS: [&str; 9] = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"];

/// Write refusal row `row` as draft `id` for path `p`; return its context,
/// whether the gate is closed, and the expected `kind()`.
pub(super) fn refusal(
    home: &TempHome,
    row: &str,
    id: &str,
    p: &str,
) -> (LiveContext, bool, &'static str) {
    let open_by = |doc_id: &str, path: Option<&str>| {
        ctx(
            S,
            &["A"],
            &store_of(vec![win("A", vec![doc(doc_id, path, true)], true, 1)]),
        )
    };
    match row {
        "r1" => {
            home.write_raw(
                id,
                &bundle_json("body", Some(p), &ago(1), false, Some((S, "LIVE"))),
            );
            (
                ctx(S, &["LIVE"], &ShadowStore::default()),
                false,
                "OwnedByLiveWindow",
            )
        }
        "r2" | "r3" | "r5" | "r6" => {
            seed(home, id, Some(p));
            match row {
                "r2" => (open_by(id, None), false, "OpenInWindow"),
                "r3" => (open_by("other", Some(p)), false, "OpenInWindow"),
                "r5" => (ctx_unavailable(S, &[]), false, "ShadowStoreUnavailable"),
                _ => (empty_ctx(), true, "IoError"),
            }
        }
        "r4" => (empty_ctx(), false, "NotFound"),
        "r7" => {
            home.write_raw(id, "{not json");
            (empty_ctx(), false, "ParseError")
        }
        "r8" => {
            home.write_legacy(id, "x", Some(p), &ago(1), false);
            fs::write(home.legacy_meta(id), "{not json").unwrap();
            (empty_ctx(), false, "ParseError")
        }
        "r9" => {
            home.write_legacy(id, "x", Some(p), &ago(1), false);
            (open_by("other", Some(p)), false, "OpenInWindow")
        }
        other => panic!("unknown row {other}"),
    }
}

/// The row-specific message check on top of `kind()`.
pub(super) fn message_ok(row: &str, err: &DraftError) -> bool {
    match row {
        "r5" => {
            matches!(err, DraftError::ShadowStoreUnavailable)
        }
        "r6" => {
            matches!(err, DraftError::IoError { .. })
                && err.to_string().to_lowercase().contains("quit")
        }
        _ => true,
    }
}

/// D59-L1 / D59-L2 draft shapes, named as in the matrix.
pub(super) const SHAPES: [char; 8] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/// Write a draft of `shape` as `id`, with `file` as its path where the shape
/// has a valid one. Returns the stored `originalPath`.
pub(super) fn write_shape(home: &TempHome, shape: char, id: &str, file: &Path) -> Option<String> {
    let f = s(file);
    match shape {
        'A' => {
            fs::write(file, "a").unwrap();
            seed(home, id, Some(&f));
        }
        'B' => seed(home, id, Some(&f)),
        'C' => seed(home, id, None),
        'D' => {
            home.write_legacy(id, "legacy", None, &ago(1), false);
            fs::remove_file(home.legacy_meta(id)).unwrap();
        }
        'E' => {
            fs::write(file, "e").unwrap();
            home.write_legacy(id, "legacy", Some(&f), &ago(1), false);
        }
        'F' => seed(home, id, Some("/tmp/../etc/x.md")),
        'G' => seed(home, id, Some("rel/a.md")),
        'H' => seed(home, id, Some("/tmp/a.png")),
        other => panic!("unknown shape {other}"),
    }
    match shape {
        'A' | 'B' | 'E' => Some(f),
        'C' | 'D' => None,
        'F' => Some("/tmp/../etc/x.md".to_string()),
        'G' => Some("rel/a.md".to_string()),
        _ => Some("/tmp/a.png".to_string()),
    }
}
