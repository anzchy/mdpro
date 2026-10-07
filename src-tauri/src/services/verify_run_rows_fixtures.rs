//! Test-only single-defect rows for the verify-run guard (ADR-0047 WI-002 /
//! WI-4, matrix WI4-T02..T14). Each row takes a fresh `Run::valid()`, injects
//! exactly one defect, and names the result it must produce (`None` = `Ok`).
//! The per-case tests run their own set; WI4-T15 runs the union.
#![allow(dead_code)]
use super::verify_run_fixtures::{
    canonical_tmp, chmod, set_var, snapshot, unset_var, Run, CF_HOME, HOME, NONCE, RUN,
};
use super::{check, GuardError, PathVar, Var};
use std::fs;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::symlink;
use std::path::PathBuf;

type Apply = Box<dyn Fn(&Run) -> (PathBuf, u32)>;

pub(super) struct Row {
    pub(super) name: String,
    pub(super) apply: Apply,
    pub(super) expect: Option<GuardError>,
}

fn row(name: impl Into<String>, expect: Option<GuardError>, apply: Apply) -> Row {
    Row {
        name: name.into(),
        apply,
        expect,
    }
}

/// Run every row on a fresh fixture; each must give exactly its result and
/// leave the tree unchanged (`check` writes nothing).
pub(super) fn assert_rows(rows: &[Row]) {
    assert!(!rows.is_empty(), "no rows");
    for r in rows {
        let fx = Run::valid();
        let (parent, uid) = (r.apply)(&fx);
        let before = fx.snapshot();
        let got = check(&parent, uid);
        assert_eq!(
            got.as_ref().err(),
            r.expect.as_ref(),
            "row {}: {got:?}",
            r.name
        );
        assert_eq!(
            snapshot(&fx.root),
            before,
            "row {} wrote to the tree",
            r.name
        );
    }
}

const PRESENCE: [(&str, Var); 4] = [
    (RUN, Var::Run),
    (NONCE, Var::Nonce),
    (HOME, Var::Home),
    (CF_HOME, Var::CfHome),
];
const PATHS: [(&str, PathVar); 3] = [
    (RUN, PathVar::Run),
    (HOME, PathVar::Home),
    (CF_HOME, PathVar::CfHome),
];

pub(super) fn rows_t02() -> Vec<Row> {
    let mut rows = Vec::new();
    for (name, var) in PRESENCE {
        rows.push(row(
            format!("T02 {name} unset"),
            Some(GuardError::VarUnset(var)),
            Box::new(move |fx| {
                unset_var(name);
                fx.args()
            }),
        ));
        rows.push(row(
            format!("T02 {name} empty"),
            Some(GuardError::VarEmpty(var)),
            Box::new(move |fx| {
                set_var(name, "");
                fx.args()
            }),
        ));
    }
    rows
}

pub(super) fn rows_t03() -> Vec<Row> {
    PRESENCE
        .iter()
        .map(|&(name, var)| {
            row(
                format!("T03 {name} not UTF-8"),
                Some(GuardError::VarNotUtf8(var)),
                Box::new(move |fx| {
                    set_var(name, std::ffi::OsStr::from_bytes(b"/x\xff"));
                    fx.args()
                }),
            )
        })
        .collect()
}

pub(super) fn rows_t04() -> Vec<Row> {
    let mut rows = Vec::new();
    let tmp_is_canonical = canonical_tmp() == std::env::temp_dir();
    for (name, pv) in PATHS {
        let e = Some(GuardError::NotCanonical(pv));
        rows.push(row(
            format!("T04(a) {name} relative"),
            e.clone(),
            Box::new(move |fx| {
                set_var(name, "runs/r-x");
                fx.args()
            }),
        ));
        rows.push(row(
            format!("T04(b) {name} symlink"),
            e.clone(),
            Box::new(move |fx| {
                let link = fx.root.join("link");
                symlink(&fx.run, &link).expect("symlink");
                set_var(name, &link);
                fx.args()
            }),
        ));
        rows.push(row(
            format!("T04(c) {name} dot-dot"),
            e.clone(),
            Box::new(move |fx| {
                let leaf = fx.run.file_name().expect("run name");
                set_var(name, fx.run.join("..").join(leaf));
                fx.args()
            }),
        ));
        if tmp_is_canonical {
            println!("SKIPPED: T04(d) {name}: temp_dir() is already canonical");
            continue;
        }
        rows.push(row(
            format!("T04(d) {name} temp_dir() spelling"),
            e,
            Box::new(move |fx| {
                let rel = fx.run.strip_prefix(canonical_tmp()).expect("under tmp");
                set_var(name, std::env::temp_dir().join(rel));
                fx.args()
            }),
        ));
    }
    rows
}

pub(super) fn rows_t05() -> Vec<Row> {
    vec![
        row(
            "T05 run missing",
            Some(GuardError::PathMissing(PathVar::Run)),
            Box::new(|fx| {
                set_var(RUN, fx.parent.join("absent"));
                fx.args()
            }),
        ),
        row(
            "T05 CF missing",
            Some(GuardError::PathMissing(PathVar::CfHome)),
            Box::new(|fx| {
                set_var(CF_HOME, fx.run.join("absent"));
                fx.args()
            }),
        ),
    ]
}

pub(super) fn rows_t06() -> Vec<Row> {
    vec![row(
        "T06 run dir is a file",
        Some(GuardError::RunDirNotDir),
        Box::new(|fx| {
            let file = fx.parent.join("r-file");
            fs::write(&file, b"x").expect("write r-file");
            chmod(&file, 0o600);
            fx.point_paths_at(&file);
            fx.args()
        }),
    )]
}

/// Where a T07 run dir goes, relative to the fixture.
type At = fn(&Run) -> PathBuf;

pub(super) fn rows_t07() -> Vec<Row> {
    let rel: [(&str, At); 4] = [
        ("(a) parent itself", |fx| fx.parent.clone()),
        ("(b) grandchild", |fx| fx.parent.join("a").join("r")),
        ("(c) outside", |fx| fx.root.join("elsewhere").join("r")),
        ("(d) sibling prefix", |fx| fx.root.join("runs2").join("r")),
    ];
    rel.into_iter()
        .map(|(label, at)| {
            row(
                format!("T07{label}"),
                Some(GuardError::RunDirNotChildOfParent),
                Box::new(move |fx| {
                    let dir = fx.mkdir(&at(fx));
                    fx.point_paths_at(&dir);
                    fx.args()
                }),
            )
        })
        .collect()
}

pub(super) fn rows_t08() -> Vec<Row> {
    vec![row(
        "T08 parent unresolvable",
        Some(GuardError::ParentUnresolvable),
        Box::new(|fx| (fx.root.join("no-such"), fx.uid)),
    )]
}

/// Named run-dir mode rows for T15 (T09 itself is exhaustive).
pub(super) fn rows_t09_named() -> Vec<Row> {
    [0o755u32, 0o500]
        .into_iter()
        .map(|m| {
            row(
                format!("T09 run mode {m:o}"),
                Some(GuardError::RunDirMode),
                Box::new(move |fx| {
                    chmod(&fx.run, m);
                    fx.args()
                }),
            )
        })
        .collect()
}

pub(super) fn rows_t10() -> Vec<Row> {
    vec![row(
        "T10 owner uid + 1",
        Some(GuardError::RunDirNotOwner),
        Box::new(|fx| (fx.parent.clone(), fx.uid.wrapping_add(1))),
    )]
}

/// The five named parent-mode rows of T11.
pub(super) const PARENT_NAMED: [u32; 5] = [0o755, 0o750, 0o711, 0o500, 0o300];

pub(super) fn rows_t11_named() -> Vec<Row> {
    PARENT_NAMED
        .into_iter()
        .map(|m| {
            row(
                format!("T11 parent mode {m:o}"),
                Some(GuardError::ParentMode),
                Box::new(move |fx| {
                    chmod(&fx.parent, m);
                    fx.args()
                }),
            )
        })
        .collect()
}
