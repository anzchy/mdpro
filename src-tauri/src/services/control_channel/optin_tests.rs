//! ADR-0047 WI-009 WI 3: the opt-in marker (plan WI-009 items 2, 5, 15).
//! Every case that is not a plain 0600 file of this uid holding
//! `{"eval": bool}` keeps the channel closed.
use super::*;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

fn uid() -> u32 {
    // SAFETY: getuid has no preconditions and cannot fail.
    unsafe { libc::getuid() }
}

fn run_dir() -> PathBuf {
    let d = std::env::temp_dir().join(format!("oi-{}", rand::random::<u32>()));
    std::fs::create_dir_all(&d).expect("run dir");
    d
}

fn put(dir: &Path, body: &str, mode: u32) {
    let p = dir.join(OPTIN_FILE);
    std::fs::write(&p, body).expect("marker");
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(mode)).expect("chmod");
}

#[test]
fn the_marker_file_name() {
    assert_eq!(OPTIN_FILE, "control-optin.json");
}

#[test]
fn no_marker_keeps_the_channel_closed() {
    let d = run_dir();
    assert_eq!(read(&d, uid()), OptIn::Absent);
}

#[test]
fn a_0600_marker_of_this_uid_opens_it_with_its_eval() {
    let d = run_dir();
    put(&d, r#"{"eval":false}"#, 0o600);
    assert_eq!(read(&d, uid()), OptIn::Open { eval: false });
    let d = run_dir();
    put(&d, r#"{"eval":true}"#, 0o600);
    assert_eq!(read(&d, uid()), OptIn::Open { eval: true });
}

#[test]
fn a_mode_wider_than_0600_is_refused() {
    for m in [0o640, 0o604, 0o644, 0o700, 0o666] {
        let d = run_dir();
        put(&d, r#"{"eval":false}"#, m);
        assert_eq!(read(&d, uid()), OptIn::Refused("mode"), "mode {m:o}");
    }
}

#[test]
fn a_narrower_mode_still_opens() {
    let d = run_dir();
    put(&d, r#"{"eval":false}"#, 0o400);
    assert_eq!(read(&d, uid()), OptIn::Open { eval: false });
}

#[test]
fn a_marker_of_another_uid_is_refused() {
    let d = run_dir();
    put(&d, r#"{"eval":false}"#, 0o600);
    assert_eq!(read(&d, uid().wrapping_add(1)), OptIn::Refused("owner"));
}

#[test]
fn a_symlink_marker_is_refused_even_to_a_good_file() {
    let d = run_dir();
    let target = d.join("real.json");
    std::fs::write(&target, r#"{"eval":true}"#).expect("target");
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).expect("chmod");
    std::os::unix::fs::symlink(&target, d.join(OPTIN_FILE)).expect("symlink");
    assert_eq!(read(&d, uid()), OptIn::Refused("symlink"));
}

#[test]
fn a_directory_marker_is_refused() {
    let d = run_dir();
    std::fs::create_dir(d.join(OPTIN_FILE)).expect("dir");
    assert_eq!(read(&d, uid()), OptIn::Refused("not_file"));
}

#[test]
fn any_other_body_is_refused() {
    for body in [
        "",
        "on",
        "{}",
        r#"{"eval":"yes"}"#,
        r#"{"eval":1}"#,
        r#"{"eval":false,"x":1}"#,
        "[true]",
    ] {
        let d = run_dir();
        put(&d, body, 0o600);
        assert_eq!(read(&d, uid()), OptIn::Refused("content"), "body {body:?}");
    }
}
