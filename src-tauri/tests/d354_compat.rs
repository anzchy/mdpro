#![cfg(target_os = "macos")]

use std::fs;
use std::io;
use std::os::unix::fs::MetadataExt;
use std::os::unix::net::UnixListener;
use std::sync::Mutex;
use tauri_app_lib::services::instance_admission::{admit, Admission, Namespace};

const UNQUALIFIED_PEER_DEADLINE: std::time::Duration = std::time::Duration::from_secs(3);
// Test subprocess signing and scheduling can outlast 3 seconds under shared-machine load.
// This is a fixture liveness bound; admission keeps its own 10-second deadline.
const SIGNED_LISTENER_STARTUP_DEADLINE: std::time::Duration = std::time::Duration::from_secs(30);
// Serialize child spawns and listener creation within this test binary.
static COMPAT_TEST_LOCK: Mutex<()> = Mutex::new(());

fn assert_zero_request_bytes_then_closed(listener: &UnixListener, until: std::time::Instant) {
    use std::io::Read;
    use std::time::Duration;

    listener.set_nonblocking(true).unwrap();
    let (mut connected, _) = loop {
        match listener.accept() {
            Ok(connection) => break connection,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                assert!(
                    std::time::Instant::now() < until,
                    "qualification never connected"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(error) => panic!("legacy listener accept failed: {error}"),
        }
    };
    match connected.set_read_timeout(Some(Duration::from_millis(100))) {
        Ok(()) => (),
        Err(error) if error.raw_os_error() == Some(libc::EINVAL) => (),
        Err(error) => panic!("accepted socket timeout failed: {error}"),
    }
    connected.set_nonblocking(true).unwrap();
    let mut byte = [0u8; 1];
    loop {
        match connected.read(&mut byte) {
            Ok(0) => break,
            Ok(_) => panic!("unqualified peer saw request bytes"),
            Err(error) if error.raw_os_error() == Some(libc::ECONNRESET) => break,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                assert!(
                    std::time::Instant::now() < until,
                    "unqualified peer stayed open"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(error) => panic!("unqualified peer read failed: {error}"),
        }
    }
}

fn unique_namespace() -> (String, Namespace) {
    let key = format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let namespace = Namespace::for_identifier(&key).unwrap();
    (key, namespace)
}

fn cleanup(namespace: &Namespace) {
    let _ = fs::remove_file(&namespace.socket);
    let _ = fs::remove_file(&namespace.public_alias);
    let _ = fs::remove_file(&namespace.lock);
    let _ = fs::remove_dir(&namespace.directory);
}

#[test]
fn unrelated_public_file_remains_intact_and_prevents_private_owner_setup() {
    let _guard = COMPAT_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (key, namespace) = unique_namespace();
    let marker = b"not a socket";
    fs::write(&namespace.public_alias, marker).unwrap();
    let inode = fs::symlink_metadata(&namespace.public_alias).unwrap().ino();

    let outcome = admit(&key, b"/tmp\0\0mdpro\0file.md");
    assert!(matches!(outcome, Ok(Admission::Refused)));
    assert_eq!(
        fs::symlink_metadata(&namespace.public_alias).unwrap().ino(),
        inode
    );
    assert_eq!(fs::read(&namespace.public_alias).unwrap(), marker);
    assert!(
        !namespace.socket.exists(),
        "unknown public entry must prevent setup"
    );
    cleanup(&namespace);
}

#[test]
fn same_uid_stale_public_socket_is_preserved_and_refused() {
    let _guard = COMPAT_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (key, namespace) = unique_namespace();
    let listener = UnixListener::bind(&namespace.public_alias).unwrap();
    let inode = fs::symlink_metadata(&namespace.public_alias).unwrap().ino();
    drop(listener);

    let outcome = admit(&key, b"/tmp\0\0mdpro\0file.md");
    assert!(matches!(outcome, Ok(Admission::Refused)));
    assert_eq!(
        fs::symlink_metadata(&namespace.public_alias).unwrap().ino(),
        inode
    );
    assert!(!namespace.socket.exists());
    cleanup(&namespace);
}

#[test]
fn late_stale_legacy_socket_retries_until_deadline_without_replacement() {
    let _guard = COMPAT_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use std::time::{Duration, Instant};
    use tauri_app_lib::services::instance_admission::{
        admit_with_alias_creation_hook_for_test, LEGACY_COMPATIBLE_IMAGES,
    };

    let (key, namespace) = unique_namespace();
    let mut created = (0, 0);
    let started = Instant::now();
    let outcome = admit_with_alias_creation_hook_for_test(
        &key,
        b"/tmp\0\0mdpro\0late.md",
        LEGACY_COMPATIBLE_IMAGES,
        |at| {
            let listener = UnixListener::bind(&at.public_alias).unwrap();
            let metadata = fs::symlink_metadata(&at.public_alias).unwrap();
            created = (metadata.dev(), metadata.ino());
            drop(listener);
        },
    );
    let elapsed = started.elapsed();
    let after = fs::symlink_metadata(&namespace.public_alias).unwrap();
    let preserved = (after.dev(), after.ino()) == created;
    let no_private_socket = !namespace.socket.exists();
    cleanup(&namespace);
    assert!(matches!(outcome, Ok(Admission::Refused)));
    assert!(
        elapsed >= Duration::from_secs(9),
        "stale entrant skipped the retry window: {elapsed:?}"
    );
    assert!(
        elapsed < Duration::from_secs(15),
        "stale entrant exceeded the deadline: {elapsed:?}"
    );
    assert!(preserved, "stale public socket was replaced");
    assert!(no_private_socket);
}

#[test]
fn public_alias_bound_after_classification_wins_exclusive_creation() {
    let _guard = COMPAT_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use std::os::unix::fs::symlink;
    use std::os::unix::net::UnixStream;
    use tauri_app_lib::services::instance_admission::{
        admit_with_alias_creation_hook_for_test, LEGACY_COMPATIBLE_IMAGES,
    };

    #[derive(Clone, Copy)]
    enum Occupant {
        Socket,
        File,
        OtherSymlink,
    }
    for occupant in [Occupant::Socket, Occupant::File, Occupant::OtherSymlink] {
        let (key, namespace) = unique_namespace();
        let mut listener = None;
        let mut created = (0, 0);
        let other_target = namespace.directory.join("unrelated-target");
        let outcome = admit_with_alias_creation_hook_for_test(
            &key,
            b"/tmp\0\0mdpro\0secret.md",
            LEGACY_COMPATIBLE_IMAGES,
            |at| {
                assert!(!at.public_alias.exists());
                match occupant {
                    Occupant::Socket => {
                        listener = Some(UnixListener::bind(&at.public_alias).unwrap());
                    }
                    Occupant::File => {
                        fs::write(&at.public_alias, b"unrelated bytes").unwrap();
                    }
                    Occupant::OtherSymlink => {
                        symlink(&other_target, &at.public_alias).unwrap();
                    }
                }
                let metadata = fs::symlink_metadata(&at.public_alias).unwrap();
                created = (metadata.dev(), metadata.ino());
            },
        );
        assert!(matches!(outcome, Ok(Admission::Refused)));
        let after = fs::symlink_metadata(&namespace.public_alias).unwrap();
        assert_eq!((after.dev(), after.ino()), created);
        assert!(!namespace.socket.exists());
        match occupant {
            Occupant::Socket => {
                let listener = listener.unwrap();
                assert_zero_request_bytes_then_closed(
                    &listener,
                    std::time::Instant::now() + UNQUALIFIED_PEER_DEADLINE,
                );
                assert!(UnixStream::connect(&namespace.public_alias).is_ok());
            }
            Occupant::File => {
                assert_eq!(
                    fs::read(&namespace.public_alias).unwrap(),
                    b"unrelated bytes"
                );
            }
            Occupant::OtherSymlink => {
                assert_eq!(
                    fs::read_link(&namespace.public_alias).unwrap(),
                    other_target
                );
            }
        }
        cleanup(&namespace);
    }
}

#[test]
fn unqualified_same_uid_listener_receives_no_request_bytes() {
    let _guard = COMPAT_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use std::time::Instant;

    let (key, namespace) = unique_namespace();
    let listener = UnixListener::bind(&namespace.public_alias).unwrap();
    let outcome = admit(&key, b"/tmp\0\0mdpro\0secret.md");
    assert!(matches!(outcome, Ok(Admission::Refused)));
    assert_zero_request_bytes_then_closed(&listener, Instant::now() + UNQUALIFIED_PEER_DEADLINE);
    assert!(!namespace.socket.exists());
    drop(listener);
    cleanup(&namespace);
}

const WRONG_034_CD_HASH: &str = "4eb98a54b23fe73ad056db421cb68b1d962ec5ea";

fn nc_cd_hash() -> &'static str {
    static HASH: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    HASH.get_or_init(|| {
        let inspected = std::process::Command::new("/usr/bin/codesign")
            .arg("-dvvv")
            .arg("/usr/bin/nc")
            .output()
            .unwrap();
        assert!(inspected.status.success(), "nc signature inspection failed");
        String::from_utf8(inspected.stderr)
            .unwrap()
            .lines()
            .find_map(|line| line.strip_prefix("CDHash="))
            .expect("signed nc has a CDHash")
            .to_string()
    })
    .as_str()
}

fn spawn_nc(executable: &std::path::Path, socket: &std::path::Path) -> std::process::Child {
    use std::process::{Command, Stdio};

    Command::new(executable)
        .arg("-lU")
        .arg(socket)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap()
}

fn connect_to_nc(
    executable: &std::path::Path,
    socket: &std::path::Path,
) -> (std::process::Child, std::os::unix::net::UnixStream) {
    connect_to_child(spawn_nc(executable, socket), socket)
}

fn connect_to_child(
    mut child: std::process::Child,
    socket: &std::path::Path,
) -> (std::process::Child, std::os::unix::net::UnixStream) {
    use std::time::{Duration, Instant};

    let deadline = Instant::now() + SIGNED_LISTENER_STARTUP_DEADLINE;
    let stream = loop {
        match std::os::unix::net::UnixStream::connect(socket) {
            Ok(stream) => break stream,
            Err(error) => {
                assert!(
                    child.try_wait().unwrap().is_none(),
                    "signed listener exited: {error}"
                );
                assert!(
                    Instant::now() < deadline,
                    "signed listener did not bind: {error}"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    };
    (child, stream)
}

fn finish_nc(mut child: std::process::Child) -> Vec<u8> {
    use std::time::{Duration, Instant};

    let deadline = Instant::now() + Duration::from_secs(3);
    while child.try_wait().unwrap().is_none() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    if child.try_wait().unwrap().is_none() {
        child.kill().unwrap();
    }
    child.wait_with_output().unwrap().stdout
}

#[test]
#[ignore = "run only as an ad hoc signed subprocess fixture"]
fn signed_listener_fixture() {
    let _guard = COMPAT_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use std::io::{Read, Write};

    let socket = std::env::var_os("D354_SIGNED_LISTENER_SOCKET").expect("fixture socket path");
    if std::env::var_os("D354_SIGNED_LISTENER_WAIT_FOR_BIND").is_some() {
        std::io::stdout().write_all(b"READY\n").unwrap();
        std::io::stdout().flush().unwrap();
        std::io::stdin().read_exact(&mut [0u8; 1]).unwrap();
    }
    let listener = UnixListener::bind(socket).unwrap();
    if std::env::var_os("D354_SIGNED_LISTENER_READY").is_some() {
        std::io::stdout().write_all(b"BOUND\n").unwrap();
        std::io::stdout().flush().unwrap();
    }
    let (mut stream, _) = listener.accept().unwrap();
    let mut received = Vec::new();
    stream.read_to_end(&mut received).unwrap();
    if let Some(path) = std::env::var_os("D354_SIGNED_LISTENER_OUTPUT") {
        fs::write(path, received).unwrap();
    } else {
        assert!(
            received.is_empty(),
            "signature fixture received request bytes"
        );
    }
}

#[test]
fn late_compatible_legacy_socket_forwards_one_bounded_frame() {
    let _guard = COMPAT_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use std::io::{Read, Write};
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::PermissionsExt;
    use std::process::{Command, Stdio};
    use tauri_app_lib::services::instance_admission::{
        admit_with_alias_creation_hook_for_test, running_image_allowed, CompatibleImage,
    };

    fn await_banner(child: &mut std::process::Child, expected: &[u8]) {
        let stdout = child.stdout.as_mut().unwrap();
        let ready_by = std::time::Instant::now() + SIGNED_LISTENER_STARTUP_DEADLINE;
        let mut banner = Vec::new();
        loop {
            let remaining = ready_by.saturating_duration_since(std::time::Instant::now());
            assert!(!remaining.is_zero(), "signed listener did not become ready");
            let mut pollfd = libc::pollfd {
                fd: stdout.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            assert_eq!(
                unsafe { libc::poll(&mut pollfd, 1, remaining.as_millis().max(1) as i32) },
                1,
                "signed listener readiness timed out"
            );
            let mut byte = [0u8; 1];
            stdout.read_exact(&mut byte).unwrap();
            banner.push(byte[0]);
            assert!(banner.len() < 1024, "unexpected signed listener output");
            if banner.ends_with(expected) {
                break;
            }
        }
    }

    let (key, namespace) = unique_namespace();
    let executable = std::env::temp_dir().join(format!(
        "d354-late-signed-listener-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let received_path = executable.with_extension("received");
    fs::copy(std::env::current_exe().unwrap(), &executable).unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
    let signed = Command::new("/usr/bin/codesign")
        .args(["--force", "--sign", "-"])
        .arg(&executable)
        .output()
        .unwrap();
    assert!(signed.status.success(), "ad hoc sign failed: {signed:?}");
    let inspected = Command::new("/usr/bin/codesign")
        .arg("-dvvv")
        .arg(&executable)
        .output()
        .unwrap();
    assert!(inspected.status.success());
    let details = String::from_utf8(inspected.stderr).unwrap();
    let cdhash = details
        .lines()
        .find_map(|line| line.strip_prefix("CDHash="))
        .unwrap()
        .to_string();
    let allowed_hash: &'static str = Box::leak(cdhash.into_boxed_str());
    let allowed = [CompatibleImage {
        cdhash: allowed_hash,
    }];
    let frame = b"/tmp/working dir\0\0mdpro\0late file.md";
    let mut child = Command::new(&executable)
        .args([
            "--ignored",
            "--exact",
            "signed_listener_fixture",
            "--nocapture",
        ])
        .env("D354_SIGNED_LISTENER_SOCKET", &namespace.public_alias)
        .env("D354_SIGNED_LISTENER_READY", "1")
        .env("D354_SIGNED_LISTENER_WAIT_FOR_BIND", "1")
        .env("D354_SIGNED_LISTENER_OUTPUT", &received_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    await_banner(&mut child, b"READY\n");
    assert!(running_image_allowed(child.id() as i32, &allowed));
    let mut created = (0, 0);
    let admission_started = std::time::Instant::now();
    let mut fixture_ready_at = admission_started;
    let outcome = admit_with_alias_creation_hook_for_test(&key, frame, &allowed, |at| {
        child.stdin.as_mut().unwrap().write_all(b"B").unwrap();
        await_banner(&mut child, b"BOUND\n");
        let metadata = fs::symlink_metadata(&at.public_alias).unwrap();
        created = (metadata.dev(), metadata.ino());
        fixture_ready_at = std::time::Instant::now();
    });
    let admission_finished = std::time::Instant::now();
    let output = finish_nc(child);
    let alias = fs::symlink_metadata(&namespace.public_alias).unwrap();
    let still_created = (alias.dev(), alias.ino()) == created;
    let received = fs::read(&received_path).ok();
    let _ = fs::remove_file(&received_path);
    let _ = fs::remove_file(&executable);
    cleanup(&namespace);
    assert!(
        matches!(outcome, Ok(Admission::Forwarded)),
        "late compatible peer was not forwarded: {outcome:?}; ready={:?} admission={:?} received={received:?}",
        fixture_ready_at.duration_since(admission_started),
        admission_finished.duration_since(admission_started),
    );
    assert!(still_created, "late public entry was replaced");
    assert_eq!(received.as_deref(), Some(frame.as_slice()));
    assert!(String::from_utf8_lossy(&output).contains("test result: ok"));
}

#[test]
fn signed_connected_peer_requires_exact_running_cdhash_before_receiving_bytes() {
    let _guard = COMPAT_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use std::io::Write;
    use std::net::Shutdown;
    use tauri_app_lib::services::instance_admission::{qualify_connected_peer, CompatibleImage};

    let (_, namespace) = unique_namespace();
    let (child, mut stream) =
        connect_to_nc(std::path::Path::new("/usr/bin/nc"), &namespace.public_alias);
    assert!(qualify_connected_peer(
        &stream,
        &[CompatibleImage {
            cdhash: WRONG_034_CD_HASH
        }]
    )
    .is_none());
    let nc_hash = nc_cd_hash();
    let peer = qualify_connected_peer(&stream, &[CompatibleImage { cdhash: nc_hash }]).unwrap();
    assert_eq!(peer.pid, child.id());
    assert_eq!(peer.uid, unsafe { libc::geteuid() });
    let frame = "/tmp/工作 目录\0\0mdpro\0文 件.md".as_bytes();
    stream.write_all(frame).unwrap();
    stream.shutdown(Shutdown::Write).unwrap();
    drop(stream);
    assert_eq!(finish_nc(child), frame);
    cleanup(&namespace);
}

#[test]
fn qualified_forwarder_sends_one_frame_and_wrong_hash_sends_no_bytes() {
    let _guard = COMPAT_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use std::time::{Duration, Instant};
    use tauri_app_lib::services::instance_admission::{forward_if_qualified, CompatibleImage};

    let frame = b"/tmp\0\0mdpro\0file.md";
    let nc_hash = nc_cd_hash();
    for (cdhash, expected_success) in [(nc_hash, true), (WRONG_034_CD_HASH, false)] {
        let (_, namespace) = unique_namespace();
        let mut child = spawn_nc(std::path::Path::new("/usr/bin/nc"), &namespace.public_alias);
        let ready_by = Instant::now() + Duration::from_secs(3);
        while !namespace.public_alias.exists() {
            assert!(
                child.try_wait().unwrap().is_none(),
                "signed listener exited before bind"
            );
            assert!(Instant::now() < ready_by, "signed listener did not bind");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            forward_if_qualified(
                &namespace.public_alias,
                frame,
                Instant::now() + Duration::from_secs(3),
                &[CompatibleImage { cdhash }],
            ),
            expected_success,
            "forwarder result for cdhash {cdhash}"
        );
        let received = finish_nc(child);
        assert_eq!(
            received,
            if expected_success {
                &frame[..]
            } else {
                &[][..]
            }
        );
        cleanup(&namespace);
    }
}

#[test]
fn legacy_public_listener_without_ack_forwards_one_frame() {
    let _guard = COMPAT_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use std::time::{Duration, Instant};
    use tauri_app_lib::services::instance_admission::{
        admit_with_alias_creation_hook_for_test, Admission, CompatibleImage,
    };

    let (key, namespace) = unique_namespace();
    let nc_hash = nc_cd_hash();
    let mut child = spawn_nc(std::path::Path::new("/usr/bin/nc"), &namespace.public_alias);
    let ready_by = Instant::now() + Duration::from_secs(3);
    while !namespace.public_alias.exists() {
        assert!(child.try_wait().unwrap().is_none(), "nc exited before bind");
        assert!(Instant::now() < ready_by, "nc did not bind");
        std::thread::sleep(Duration::from_millis(10));
    }

    let frame = b"/tmp\0\0mdpro\0legacy-no-ack.md";
    let outcome = admit_with_alias_creation_hook_for_test(
        &key,
        frame,
        &[CompatibleImage { cdhash: nc_hash }],
        |_| panic!("existing legacy alias should bypass private bind"),
    );
    let received = finish_nc(child);
    cleanup(&namespace);
    // The private no-ack case is pinned by d354_forwarding::private_owner_eof_without_ack_refuses_after_full_frame.
    assert!(matches!(outcome, Ok(Admission::Forwarded)), "{outcome:?}");
    assert_eq!(received, frame);
}

#[test]
fn running_signature_survives_replacement_of_the_connected_peer_path() {
    let _guard = COMPAT_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use std::os::unix::fs::PermissionsExt;
    use std::process::Command;
    use tauri_app_lib::services::instance_admission::{qualify_connected_peer, CompatibleImage};

    let (_, namespace) = unique_namespace();
    let executable = std::env::temp_dir().join(format!(
        "d354-signed-test-listener-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let old_path = executable.with_extension("old");
    fs::copy(std::env::current_exe().unwrap(), &executable).unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
    let signed = Command::new("/usr/bin/codesign")
        .args(["--force", "--sign", "-"])
        .arg(&executable)
        .output()
        .unwrap();
    assert!(signed.status.success(), "ad hoc sign failed: {signed:?}");
    let inspected = Command::new("/usr/bin/codesign")
        .arg("-dvvv")
        .arg(&executable)
        .output()
        .unwrap();
    assert!(inspected.status.success());
    let details = String::from_utf8(inspected.stderr).unwrap();
    let cdhash = details
        .lines()
        .find_map(|line| line.strip_prefix("CDHash="))
        .unwrap()
        .to_string();
    let allowed_hash: &'static str = Box::leak(cdhash.into_boxed_str());
    let child = Command::new(&executable)
        .args([
            "--ignored",
            "--exact",
            "signed_listener_fixture",
            "--nocapture",
        ])
        .env("D354_SIGNED_LISTENER_SOCKET", &namespace.public_alias)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let (child, stream) = connect_to_child(child, &namespace.public_alias);
    fs::rename(&executable, &old_path).unwrap();
    fs::write(&executable, b"replacement bytes are not the running image").unwrap();
    let peer = qualify_connected_peer(
        &stream,
        &[CompatibleImage {
            cdhash: allowed_hash,
        }],
    )
    .unwrap();
    assert_eq!(peer.pid, child.id());
    drop(stream);
    let output = finish_nc(child);
    assert!(
        String::from_utf8_lossy(&output).contains("test result: ok"),
        "signed listener fixture failed: {}",
        String::from_utf8_lossy(&output)
    );
    let _ = fs::remove_file(&executable);
    let _ = fs::remove_file(&old_path);
    cleanup(&namespace);
}

struct SuspendedLegacy(libc::pid_t);

impl Drop for SuspendedLegacy {
    fn drop(&mut self) {
        unsafe {
            libc::kill(self.0, libc::SIGKILL);
            libc::waitpid(self.0, std::ptr::null_mut(), 0);
        }
    }
}

#[test]
fn installed_035_running_image_matches_only_its_approved_hash() {
    if std::env::var("MDPRO_D354_INSTALLED_035").as_deref() != Ok("1") {
        eprintln!("skipped: set MDPRO_D354_INSTALLED_035=1 for the installed 0.3.5 proof");
        return;
    }
    let _guard = COMPAT_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use std::ffi::CString;
    use tauri_app_lib::services::instance_admission::{
        running_image_allowed, CompatibleImage, LEGACY_COMPATIBLE_IMAGES,
    };

    let executable = CString::new("/Applications/mdpro.app/Contents/MacOS/tauri-app").unwrap();
    assert!(std::path::Path::new(executable.as_c_str().to_str().unwrap()).exists());
    let mut attributes: libc::posix_spawnattr_t = unsafe { std::mem::zeroed() };
    assert_eq!(unsafe { libc::posix_spawnattr_init(&mut attributes) }, 0);
    assert_eq!(
        unsafe {
            libc::posix_spawnattr_setflags(
                &mut attributes,
                libc::POSIX_SPAWN_START_SUSPENDED as i16,
            )
        },
        0
    );
    let mut pid: libc::pid_t = 0;
    let argv = [
        executable.as_ptr() as *mut libc::c_char,
        std::ptr::null_mut(),
    ];
    let status = unsafe {
        libc::posix_spawn(
            &mut pid,
            executable.as_ptr(),
            std::ptr::null(),
            &attributes,
            argv.as_ptr(),
            std::ptr::null(),
        )
    };
    assert_eq!(unsafe { libc::posix_spawnattr_destroy(&mut attributes) }, 0);
    assert_eq!(status, 0, "installed 0.3.5 fixture did not spawn suspended");
    let _guard = SuspendedLegacy(pid);
    assert!(running_image_allowed(pid, LEGACY_COMPATIBLE_IMAGES));
    assert!(!running_image_allowed(
        pid,
        &[CompatibleImage {
            cdhash: WRONG_034_CD_HASH
        }]
    ));
}

#[test]
fn foreign_uid_public_entry_does_not_block_private_owner_or_change_foreign_inode() {
    let _guard = COMPAT_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use std::os::unix::net::UnixStream;
    use std::path::Path;
    use tauri_app_lib::services::instance_admission::admit_with_public_alias_for_test;

    let (key, namespace) = unique_namespace();
    let foreign = Path::new("/tmp");
    let before = fs::symlink_metadata(foreign).unwrap();
    assert_ne!(
        before.uid(),
        unsafe { libc::geteuid() },
        "fixture must be foreign-owned"
    );
    let outcome = admit_with_public_alias_for_test(&key, foreign, b"").unwrap();
    let owner = match outcome {
        Admission::Owner(owner) => owner,
        _ => panic!("foreign entry must not block private admission"),
    };
    assert!(UnixStream::connect(&namespace.socket).is_ok());
    let after = fs::symlink_metadata(foreign).unwrap();
    assert_eq!((before.dev(), before.ino()), (after.dev(), after.ino()));
    drop(owner);
    cleanup(&namespace);
}
