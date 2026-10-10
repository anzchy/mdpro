// D32 WI-3: `baseline_key` and `snapshot` (matrix B1–B3, B6–B9).
use super::fixture::{set_mtime, shift_mtime, varied, TempDir};
use super::{baseline_key, snapshot, Entry, HASH_CAP_BYTES};
use std::fs;
use std::time::{Duration, SystemTime};

/// B1: two paths through a symlinked directory share one key, the canonical one.
#[cfg(unix)]
#[test]
fn b1_baseline_key_symlinked_directory_aliases_share_one_key() {
    let (_d, real, alias) = super::fixture::alias_pair("b1");
    fs::write(real.join("x.md"), "a").unwrap();
    let canonical = fs::canonicalize(real.join("x.md")).unwrap();
    assert_eq!(baseline_key(&alias.join("x.md")), canonical);
    assert_eq!(baseline_key(&real.join("x.md")), canonical);
}

/// B2: the key is idempotent over existing, aliased and missing paths, and a
/// path that cannot be canonicalised keys as itself, byte-equal.
#[cfg(unix)]
#[test]
fn b2_baseline_key_is_idempotent_and_falls_back_to_raw() {
    let (d, real, alias) = super::fixture::alias_pair("b2");
    fs::write(real.join("x.md"), "a").unwrap();
    let missing = real.join("missing.md");
    let missing_dir = d.path().join("nodir").join("missing.md");
    for p in [
        real.join("x.md"),
        alias.join("x.md"),
        missing.clone(),
        missing_dir.clone(),
    ] {
        let k = baseline_key(&p);
        assert_eq!(baseline_key(&k), k, "key(key(p)) == key(p) for {p:?}");
    }
    assert_eq!(baseline_key(&missing), missing);
    assert_eq!(baseline_key(&missing_dir), missing_dir);
    assert_eq!(
        baseline_key(&missing).as_os_str().as_encoded_bytes(),
        missing.as_os_str().as_encoded_bytes()
    );
}

/// B3: the hash cap is the open cap, 10 MiB.
#[test]
fn b3_hash_cap_equals_max_file_size() {
    assert_eq!(HASH_CAP_BYTES, crate::commands::file::MAX_FILE_SIZE);
    assert_eq!(HASH_CAP_BYTES, 10 * 1024 * 1024);
}

/// B6: equal bytes hash equal across a different path and a different mtime.
#[test]
fn b6_snapshot_hash_is_a_function_of_bytes_alone() {
    let dp = TempDir::new("b6p");
    let dq = TempDir::new("b6q");
    let big = varied(70 * 1024);
    let inputs: [&[u8]; 4] = [b"", b"x", b"line\r\n", &big];
    for (i, bytes) in inputs.iter().enumerate() {
        let p = dp.file(&format!("p{i}.md"), bytes);
        let q = dq.file(&format!("other_{i}.markdown"), bytes);
        set_mtime(&q, fs::metadata(&p).unwrap().modified().unwrap());
        shift_mtime(&q, -3600);
        let (sp, sq) = (snapshot(&p), snapshot(&q));
        assert_ne!(sp.stat, sq.stat, "precondition: mtimes differ (row {i})");
        assert!(sp.hash.is_some(), "row {i}: hash present");
        assert_eq!(sp.hash, sq.hash, "row {i}: same bytes, same hash");
    }
}

/// B7: a read error leaves the stat and drops the hash.
#[cfg(unix)]
#[test]
fn b7_snapshot_of_unreadable_file_has_stat_but_no_hash() {
    let d = TempDir::new("b7");
    let dir = d.path().join("dir.md");
    fs::create_dir(&dir).unwrap();
    assert!(fs::read(&dir).is_err(), "precondition: reading a dir errs");
    let a = snapshot(&dir);
    assert!(a.stat.is_some(), "(a) stat present");
    assert_eq!(a.hash, None, "(a) no hash");

    let f = d.file("locked.md", b"abc");
    super::fixture::chmod_000_unreadable(&f);
    let b = snapshot(&f);
    super::fixture::chmod(&f, 0o644);
    assert_eq!(b.stat.map(|(_, size)| size), Some(3), "(b) stat present");
    assert_eq!(b.hash, None, "(b) no hash");
}

/// B8: a missing file has neither stat nor hash, and nothing panics.
#[test]
fn b8_snapshot_of_missing_file_has_no_stat_and_no_hash() {
    let d = TempDir::new("b8");
    assert_eq!(
        snapshot(&d.path().join("never.md")),
        Entry {
            stat: None,
            hash: None
        }
    );
}

/// B9: two mtimes in the same millisecond give different stats (the
/// baseline is not `mtime_ms`). Also pins the stat as `(mtime, size)`.
#[test]
fn b9_snapshot_mtime_is_full_precision_not_milliseconds() {
    let d = TempDir::new("b9");
    let p = d.file("ns.md", b"hello");
    let t1 = SystemTime::UNIX_EPOCH + Duration::new(1_700_000_000, 123_456_789);
    let t2 = SystemTime::UNIX_EPOCH + Duration::new(1_700_000_000, 123_000_001);
    set_mtime(&p, t1);
    let s1 = snapshot(&p);
    set_mtime(&p, t2);
    let s2 = snapshot(&p);
    assert_eq!(s1.stat, Some((t1, 5)));
    assert_eq!(s2.stat, Some((t2, 5)));
    assert_ne!(s1.stat, s2.stat);
}
