//! ADR-0047 WI-002 / WI-4: the agreed parent dir (matrix WI4-T17..T19).
//! `runs_parent_in` has a shape law over any absolute home (T17);
//! `runs_parent(uid)` comes from passwd and is invariant under `$HOME` (T18).
//! Nothing under the real passwd home is read, and its path is not printed.
//! Feature-on only.
use super::verify_run_fixtures::{canonical_tmp, lock_env, passwd_dir, set_var, HOME};
use super::{runs_parent, runs_parent_in, GuardError};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use std::ffi::OsStr;
use std::fs;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

const TAIL: &str = "Library/Application Support/mdpro-verify/runs";

fn assert_shape(home: &Path) {
    let p = runs_parent_in(home);
    assert!(p.starts_with(home), "{home:?} -> {p:?}");
    assert_eq!(
        p.strip_prefix(home).ok(),
        Some(Path::new(TAIL)),
        "{home:?} -> {p:?}"
    );
}

#[test]
fn wi4_t17_runs_parent_in_shape_over_generated_homes() {
    const SEED: u64 = 20261005;
    const ALPHABET: &[char] = &[
        'a', 'k', 'z', '0', '9', ' ', '_', '.', '-', 'ü', 'm', 'q', '3', 'b',
    ];
    let mut rng = StdRng::seed_from_u64(SEED);
    assert_shape(Path::new("/h/u"));
    assert_shape(Path::new("/h/u/"));
    for trial in 0..200 {
        let depth = rng.gen_range(1..=4);
        let mut home = String::new();
        for _ in 0..depth {
            let len = rng.gen_range(1..=8);
            home.push('/');
            home.extend((0..len).map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())]));
        }
        if rng.gen_bool(0.3) {
            home.push('/');
        }
        println!("T17 seed {SEED} trial {trial}: {home:?}");
        assert_shape(Path::new(&home));
    }
}

#[test]
fn wi4_t18_runs_parent_comes_from_passwd_not_home() {
    let _env = lock_env();
    let probe_root = canonical_tmp().join(format!("mdpro-vr-t18-{}", uuid::Uuid::new_v4()));
    let (a, b) = (probe_root.join("A"), probe_root.join("B"));
    fs::create_dir_all(&a).expect("create A");
    fs::create_dir_all(&b).expect("create B");
    let uid = fs::metadata(&a).expect("A metadata").uid();
    let pw_dir = PathBuf::from(OsStr::from_bytes(&passwd_dir(uid).expect("passwd entry")));

    set_var(HOME, &a);
    let under_a = runs_parent(uid);
    set_var(HOME, &b);
    let under_b = runs_parent(uid);
    let _ = fs::remove_dir_all(&probe_root);

    let (pa, pb) = match (under_a, under_b) {
        (Ok(pa), Ok(pb)) => (pa, pb),
        other => panic!("runs_parent failed: {other:?}"),
    };
    assert!(pa.is_absolute(), "not absolute");
    assert_eq!(pa, pb, "runs_parent varies with $HOME");
    assert!(pa.starts_with(&pw_dir), "not under the passwd home");
    assert!(!pa.starts_with(&a) && !pa.starts_with(&b), "follows $HOME");
}

#[test]
fn wi4_t19_runs_parent_without_a_passwd_entry() {
    let uid = (3_000_000_000u32..4_000_000_000)
        .find(|u| passwd_dir(*u).is_none())
        .expect("a uid with no passwd entry");
    assert!(uid < 4_294_967_294, "avoid nobody / -1");

    assert_eq!(runs_parent(uid), Err(GuardError::PasswdEntryMissing));
}
