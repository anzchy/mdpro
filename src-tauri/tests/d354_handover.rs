#![cfg(target_os = "macos")]

use std::fs;
use std::io::{Read, Write};
use std::net::Shutdown;
use std::os::unix::fs::MetadataExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::os::unix::process::ExitStatusExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri_app_lib::services::instance_admission::{admit, Admission, Namespace};

const WAIT: Duration = Duration::from_secs(15);

fn wait_until(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + WAIT;
    while !condition() {
        assert!(Instant::now() < deadline, "handover fixture did not settle");
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
#[ignore = "run only as a subprocess fixture"]
fn d354_handover_child() {
    let id = std::env::var("D354_HANDOVER_CHILD").expect("handover child id");
    let key = std::env::var("D354_HANDOVER_KEY").unwrap();
    let control = PathBuf::from(std::env::var("D354_HANDOVER_DIR").unwrap());
    let owner = match admit(&key, b"/tmp\0\0mdpro\0handover.md") {
        Ok(Admission::Owner(owner)) => owner,
        Ok(Admission::Forwarded) => {
            fs::write(control.join(format!("outcome-{id}")), b"forwarded").unwrap();
            return;
        }
        Ok(Admission::Refused) | Err(_) => {
            fs::write(control.join(format!("outcome-{id}")), b"refused").unwrap();
            return;
        }
    };
    fs::write(control.join(format!("setup-{id}")), b"setup").unwrap();
    fs::write(control.join(format!("outcome-{id}")), b"owner").unwrap();
    owner.listener().set_nonblocking(true).unwrap();
    let mut accepted = 0;
    while !control.join(format!("stop-{id}")).exists() {
        match owner.listener().accept() {
            Ok((mut stream, _)) => {
                let mut bytes = Vec::new();
                stream.read_to_end(&mut bytes).unwrap();
                accepted += 1;
                fs::write(control.join(format!("received-{id}-{accepted}")), bytes).unwrap();
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(5));
            }
            Err(error) => panic!("handover listener failed: {error}"),
        }
    }
    drop(owner);
}

fn spawn_owner(key: &str, control: &Path, id: &str, contention_marker: Option<&Path>) -> Child {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .arg("--ignored")
        .arg("--exact")
        .arg("d354_handover_child")
        .arg("--nocapture")
        .env("D354_HANDOVER_CHILD", id)
        .env("D354_HANDOVER_KEY", key)
        .env("D354_HANDOVER_DIR", control)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(path) = contention_marker {
        command.env("D354_TEST_LOCK_CONTENTION_MARKER", path);
    }
    command.spawn().unwrap()
}

fn assert_child_result(child: &mut Child, expected_signal: Option<i32>) {
    let status = child.wait().unwrap();
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    child
        .stdout
        .take()
        .unwrap()
        .read_to_end(&mut stdout)
        .unwrap();
    child
        .stderr
        .take()
        .unwrap()
        .read_to_end(&mut stderr)
        .unwrap();
    assert!(
        stderr.is_empty(),
        "child stderr: {}",
        String::from_utf8_lossy(&stderr)
    );
    match expected_signal {
        Some(signal) => {
            assert_eq!(status.signal(), Some(signal));
            assert!(!stdout
                .windows(b"test result: ok".len())
                .any(|part| part == b"test result: ok"));
        }
        None => {
            assert!(
                status.success(),
                "child failed: {}",
                String::from_utf8_lossy(&stdout)
            );
            assert!(stdout
                .windows(b"test result: ok".len())
                .any(|part| part == b"test result: ok"));
        }
    }
}

struct Fixture {
    control: PathBuf,
    namespace: Namespace,
    children: Vec<Child>,
}

impl Fixture {
    fn new() -> (String, Self) {
        let key = format!(
            "com.d354.{}",
            &uuid::Uuid::new_v4().simple().to_string()[..12]
        );
        let control =
            std::env::temp_dir().join(format!("d354-handover-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir(&control).unwrap();
        let namespace = Namespace::for_identifier(&key).unwrap();
        (
            key,
            Self {
                control,
                namespace,
                children: Vec::new(),
            },
        )
    }

    fn start(&mut self, key: &str, id: &str) {
        self.children
            .push(spawn_owner(key, &self.control, id, None));
        let outcome = self.control.join(format!("outcome-{id}"));
        wait_until(|| outcome.exists());
        assert_eq!(fs::read(outcome).unwrap(), b"owner", "{id} must own");
        assert!(self.control.join(format!("setup-{id}")).exists());
    }

    fn stop_cleanly(&mut self, id: &str) {
        fs::write(self.control.join(format!("stop-{id}")), b"stop").unwrap();
        let child = self.children.last_mut().unwrap();
        assert_child_result(child, None);
    }

    fn kill(&mut self) {
        let child = self.children.last_mut().unwrap();
        child.kill().unwrap();
        assert_child_result(child, Some(libc::SIGKILL));
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        for child in &mut self.children {
            if matches!(child.try_wait(), Ok(None)) {
                let _ = child.kill();
            }
            let _ = child.wait();
        }
        if fs::read_link(&self.namespace.public_alias).ok().as_deref()
            == Some(self.namespace.socket.as_path())
        {
            let _ = fs::remove_file(&self.namespace.public_alias);
        }
        let _ = fs::remove_file(&self.namespace.socket);
        let _ = fs::remove_file(&self.namespace.lock);
        let _ = fs::remove_dir(&self.namespace.directory);
        let _ = fs::remove_dir(&self.control);
    }
}

fn generation_transition(kill_first: bool) {
    let (key, mut fixture) = Fixture::new();
    fixture.start(&key, "a");
    let lock_path = fixture.namespace.lock.clone();
    let socket_path = fixture.namespace.socket.clone();
    let alias_path = fixture.namespace.public_alias.clone();
    let old_lock = fs::symlink_metadata(&lock_path).unwrap();
    let old_socket = fs::symlink_metadata(&socket_path).unwrap();
    let old_alias = fs::symlink_metadata(&alias_path).unwrap();
    assert_eq!(fs::read_link(&alias_path).unwrap(), socket_path);

    if kill_first {
        fixture.kill();
    } else {
        fixture.stop_cleanly("a");
        assert!(
            fs::symlink_metadata(&socket_path).is_err(),
            "clean Exit must unlink its own private listener before lock release"
        );
    }
    assert_eq!(fs::read_link(&alias_path).unwrap(), socket_path);

    fixture.start(&key, "b");
    let new_lock = fs::symlink_metadata(&lock_path).unwrap();
    let new_socket = fs::symlink_metadata(&socket_path).unwrap();
    let new_alias = fs::symlink_metadata(&alias_path).unwrap();
    assert_eq!(
        (new_lock.dev(), new_lock.ino()),
        (old_lock.dev(), old_lock.ino())
    );
    assert_ne!(
        (new_socket.dev(), new_socket.ino()),
        (old_socket.dev(), old_socket.ino()),
        "successor must bind a new private socket generation"
    );
    assert_eq!(
        (new_alias.dev(), new_alias.ino()),
        (old_alias.dev(), old_alias.ino())
    );
    assert_eq!(fs::read_link(&alias_path).unwrap(), socket_path);

    let mut stream = UnixStream::connect(&alias_path).unwrap();
    stream.write_all(b"/tmp\0\0mdpro\0fresh.md").unwrap();
    stream.shutdown(Shutdown::Write).unwrap();
    let received = fixture.control.join("received-b-1");
    wait_until(|| received.exists());
    assert_eq!(fs::read(received).unwrap(), b"/tmp\0\0mdpro\0fresh.md");
    assert!(!fixture.control.join("received-a-1").exists());
    fixture.stop_cleanly("b");
}

#[test]
fn h1_clean_exit_retains_alias_and_hands_off_stable_lock_to_new_owner() {
    generation_transition(false);
}

#[test]
fn h1_sigkill_retains_alias_and_successor_reclaims_private_socket() {
    generation_transition(true);
}

#[test]
#[ignore = "run only as a subprocess fixture"]
fn d354_retirement_child() {
    let key = std::env::var("D354_RETIRE_KEY").expect("retirement key");
    let control = PathBuf::from(std::env::var("D354_RETIRE_DIR").unwrap());
    let mut owner = match admit(&key, b"").unwrap() {
        Admission::Owner(owner) => owner,
        _ => panic!("retirement fixture must own"),
    };
    fs::write(control.join("setup-a"), b"setup").unwrap();
    fs::write(control.join("outcome-a"), b"owner").unwrap();
    wait_until(|| control.join("retire-a").exists());
    owner.retire().unwrap();
    fs::write(control.join("retired-a"), b"retired").unwrap();
    wait_until(|| control.join("stop-a").exists());
}

#[test]
fn h2_retired_owner_holds_lock_until_exit_before_successor_setup() {
    let (key, mut fixture) = Fixture::new();
    let retiring = Command::new(std::env::current_exe().unwrap())
        .arg("--ignored")
        .arg("--exact")
        .arg("d354_retirement_child")
        .arg("--nocapture")
        .env("D354_RETIRE_KEY", &key)
        .env("D354_RETIRE_DIR", &fixture.control)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    fixture.children.push(retiring);
    wait_until(|| fixture.control.join("outcome-a").exists());
    let first_lock = fs::symlink_metadata(&fixture.namespace.lock).unwrap();
    fs::write(fixture.control.join("retire-a"), b"retire").unwrap();
    wait_until(|| fixture.control.join("retired-a").exists());
    assert!(fs::symlink_metadata(&fixture.namespace.socket).is_err());
    assert_eq!(
        fs::read_link(&fixture.namespace.public_alias).unwrap(),
        fixture.namespace.socket
    );

    let contention_marker = fixture.control.join("lock-contended-b");
    fixture.children.push(spawn_owner(
        &key,
        &fixture.control,
        "b",
        Some(&contention_marker),
    ));
    wait_until(|| contention_marker.exists());
    assert!(!fixture.control.join("setup-b").exists());
    assert!(!fixture.control.join("outcome-b").exists());
    fs::write(fixture.control.join("stop-a"), b"stop").unwrap();
    assert_child_result(&mut fixture.children[0], None);
    wait_until(|| fixture.control.join("outcome-b").exists());
    assert_eq!(
        fs::read(fixture.control.join("outcome-b")).unwrap(),
        b"owner"
    );
    assert!(fixture.control.join("setup-b").exists());
    let second_lock = fs::symlink_metadata(&fixture.namespace.lock).unwrap();
    assert_eq!(
        (first_lock.dev(), first_lock.ino()),
        (second_lock.dev(), second_lock.ino())
    );
    assert!(UnixStream::connect(&fixture.namespace.public_alias).is_ok());
    fixture.stop_cleanly("b");
}

#[test]
fn h2_stale_cleanup_preserves_replacement_socket_generation() {
    let (key, fixture) = Fixture::new();
    let mut former = match admit(&key, b"").unwrap() {
        Admission::Owner(owner) => owner,
        _ => panic!("former generation must own"),
    };
    let socket = &fixture.namespace.socket;
    let alias = &fixture.namespace.public_alias;
    let original = fs::symlink_metadata(socket).unwrap();
    let alias_before = fs::symlink_metadata(alias).unwrap();
    fs::remove_file(socket).unwrap();
    let replacement = UnixListener::bind(socket).unwrap();
    let replacement_before = fs::symlink_metadata(socket).unwrap();
    assert_ne!(
        (original.dev(), original.ino()),
        (replacement_before.dev(), replacement_before.ino())
    );

    assert!(
        former.retire().is_err(),
        "stale generation must not retire replacement"
    );
    drop(former);
    let replacement_after = fs::symlink_metadata(socket).unwrap();
    assert_eq!(
        (replacement_before.dev(), replacement_before.ino()),
        (replacement_after.dev(), replacement_after.ino())
    );
    let alias_after = fs::symlink_metadata(alias).unwrap();
    assert_eq!(
        (alias_before.dev(), alias_before.ino()),
        (alias_after.dev(), alias_after.ino())
    );

    let frame = b"/tmp\0\0mdpro\0replacement.md";
    let mut sender = UnixStream::connect(alias).unwrap();
    sender.write_all(frame).unwrap();
    sender.shutdown(Shutdown::Write).unwrap();
    let (mut received, _) = replacement.accept().unwrap();
    let mut bytes = Vec::new();
    received.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, frame);
}
