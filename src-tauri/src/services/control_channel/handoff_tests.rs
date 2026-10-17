//! ADR-0047 WI-009 WI 2: the per-launch credential, `control.json` and the
//! socket (plan WI-009 items 3, 4, 14).
use super::*;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

/// A fresh private directory under the temp dir; short, so a socket fits.
fn scratch(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("cc-{tag}-{}", rand::random::<u32>()));
    std::fs::create_dir_all(&d).expect("scratch dir");
    d
}

fn mode(p: &Path) -> u32 {
    std::fs::metadata(p).expect("metadata").permissions().mode() & 0o777
}

#[test]
fn each_token_is_64_hex_chars_and_new_per_call() {
    let (a, b) = (new_token(), new_token());
    assert_eq!(a.len(), 64);
    assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
    assert_ne!(a, b);
}

#[test]
fn the_handoff_file_is_0600_and_names_socket_token_and_eval() {
    let d = scratch("ho");
    let (file, sock) = (d.join(HANDOFF_FILE), d.join(SOCKET_FILE));
    write_handoff(&file, &sock, "tok", true).expect("written");
    assert_eq!(mode(&file), 0o600);
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&file).expect("read")).expect("json");
    assert_eq!(v["token"], "tok");
    assert_eq!(v["eval"], true);
    assert_eq!(v["socket"], sock.to_str().expect("utf-8"));
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn an_existing_handoff_file_is_never_replaced() {
    let d = scratch("hx");
    let file = d.join(HANDOFF_FILE);
    std::fs::write(&file, "planted").expect("plant");
    let e = write_handoff(&file, &d.join(SOCKET_FILE), "tok", false).unwrap_err();
    assert_eq!(e.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!(std::fs::read_to_string(&file).expect("read"), "planted");
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn a_socket_path_fits_only_below_sun_path() {
    let at = |n: usize| PathBuf::from(format!("/{}", "s".repeat(n - 1)));
    assert!(socket_fits(&at(SUN_PATH_MAX - 1)));
    assert!(!socket_fits(&at(SUN_PATH_MAX)));
}

#[test]
fn the_socket_is_bound_0600() {
    let d = scratch("sk");
    let sock = d.join(SOCKET_FILE);
    let _listener = bind(&sock).expect("bound");
    assert_eq!(mode(&sock), 0o600);
    std::fs::remove_dir_all(&d).ok();
}
