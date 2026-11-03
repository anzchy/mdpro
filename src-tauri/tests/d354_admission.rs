#![cfg(target_os = "macos")]

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri_app_lib::services::instance_admission::{
    admit, validate_root, validate_socket_path, Admission, Namespace,
};

const WAIT: Duration = Duration::from_secs(15);

fn unique_key() -> String {
    format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    )
}

fn scratch() -> PathBuf {
    let path = std::env::temp_dir().join(format!("d354-wi1-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir(&path).unwrap();
    path
}

fn wait_until(mut ready: impl FnMut() -> bool) {
    let until = Instant::now() + WAIT;
    while !ready() {
        assert!(
            Instant::now() < until,
            "fixture did not settle before deadline"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

fn write_new(path: &Path, bytes: &[u8]) {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .unwrap();
    file.write_all(bytes).unwrap();
}

#[test]
fn d354_fixture_child() {
    let Ok(id) = std::env::var("D354_WI1_CHILD") else {
        return;
    };
    let key = std::env::var("D354_WI1_KEY").unwrap();
    let dir = PathBuf::from(std::env::var("D354_WI1_DIR").unwrap());
    wait_until(|| dir.join("go").exists());
    let frame = format!("/tmp/工作 {id}\0\0/bin/mdpro\0文 件-{id}.md");
    let outcome = match admit(&key, frame.as_bytes()) {
        Ok(Admission::Owner(owner)) => {
            write_new(&dir.join(format!("setup-{id}")), b"setup");
            write_new(&dir.join(format!("outcome-{id}")), b"owner");
            let listener = owner.listener();
            listener.set_nonblocking(true).unwrap();
            let mut seen = Vec::new();
            while !dir.join("stop").exists() {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let mut bytes = Vec::new();
                        stream.read_to_end(&mut bytes).unwrap();
                        let line = String::from_utf8(bytes).unwrap();
                        seen.push(line);
                        fs::write(
                            dir.join(format!("received-{}", seen.len())),
                            seen.last().unwrap(),
                        )
                        .unwrap();
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5))
                    }
                    Err(e) => panic!("listener failed: {e}"),
                }
            }
            return;
        }
        Ok(Admission::Forwarded) => "forwarded",
        Ok(Admission::Refused) | Err(_) => "refused",
    };
    write_new(&dir.join(format!("outcome-{id}")), outcome.as_bytes());
}

fn spawn_child(key: &str, dir: &Path, id: usize) -> Child {
    Command::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("d354_fixture_child")
        .arg("--nocapture")
        .env("D354_WI1_CHILD", id.to_string())
        .env("D354_WI1_KEY", key)
        .env("D354_WI1_DIR", dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap()
}

struct RaceFixture {
    dir: PathBuf,
    namespace: Option<Namespace>,
    children: Vec<Child>,
}

impl Drop for RaceFixture {
    fn drop(&mut self) {
        let _ = fs::write(self.dir.join("stop"), b"stop");
        for child in &mut self.children {
            if matches!(child.try_wait(), Ok(None)) {
                let _ = child.kill();
            }
            let _ = child.wait();
        }
        if let Some(ns) = &self.namespace {
            let _ = fs::remove_file(&ns.socket);
            if fs::read_link(&ns.public_alias).ok().as_deref() == Some(ns.socket.as_path()) {
                let _ = fs::remove_file(&ns.public_alias);
            }
            let _ = fs::remove_file(&ns.lock);
            let _ = fs::remove_dir(&ns.directory);
        }
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn run_race(n: usize, stale_socket: bool) {
    let key = unique_key();
    let mut fixture = RaceFixture {
        dir: scratch(),
        namespace: Namespace::for_identifier(&key).ok(),
        children: Vec::new(),
    };
    let dir = fixture.dir.clone();
    if stale_socket {
        let ns = fixture.namespace.as_ref().unwrap();
        fs::create_dir(&ns.directory).unwrap();
        fs::set_permissions(&ns.directory, fs::Permissions::from_mode(0o700)).unwrap();
        let stale = UnixListener::bind(&ns.socket).unwrap();
        drop(stale);
    }
    fixture.children = (0..n).map(|id| spawn_child(&key, &dir, id)).collect();
    write_new(&dir.join("go"), b"go");
    wait_until(|| {
        (0..n).all(|id| dir.join(format!("outcome-{id}")).exists())
            || fs::read_dir(&dir)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().starts_with("setup-"))
                .count()
                > 1
    });
    let setup = fs::read_dir(&dir)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().starts_with("setup-"))
        .count();
    assert_eq!(setup, 1, "only one process may reach normal setup");
    let outcomes: Vec<String> = (0..n)
        .map(|id| fs::read_to_string(dir.join(format!("outcome-{id}"))).unwrap())
        .collect();
    assert_eq!(outcomes.iter().filter(|o| o.as_str() == "owner").count(), 1);
    let forwards = outcomes
        .iter()
        .filter(|o| o.as_str() == "forwarded")
        .count();
    wait_until(|| {
        fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with("received-"))
            .count()
            == forwards
    });
    let received: Vec<String> = (1..=forwards)
        .map(|i| fs::read_to_string(dir.join(format!("received-{i}"))).unwrap())
        .collect();
    for (id, outcome) in outcomes.iter().enumerate() {
        let request = format!("/tmp/工作 {id}\0\0/bin/mdpro\0文 件-{id}.md");
        assert_eq!(
            received.iter().filter(|r| *r == &request).count(),
            usize::from(outcome == "forwarded")
        );
    }
    write_new(&dir.join("stop"), b"stop");
    for child in &mut fixture.children {
        assert!(child.wait().unwrap().success(), "fixture child failed");
    }
}

#[test]
fn c1_all_contenders_before_listener_have_one_owner_and_once_only_receipt() {
    for n in [2, 5] {
        run_race(n, false);
    }
}

#[test]
fn c2_stale_endpoint_before_bind_still_has_one_owner_and_once_only_receipt() {
    for n in [2, 5] {
        run_race(n, true);
    }
}

#[test]
fn c3_namespace_keys_and_path_boundary_are_stable() {
    let release = Namespace::for_identifier("com.mdpro.app").unwrap();
    let verify = Namespace::for_identifier("com.mdpro.app.verify").unwrap();
    assert_ne!(release.lock, verify.lock);
    assert_eq!(release.root, verify.root);
    assert_eq!(
        release.root,
        Namespace::for_identifier("com.mdpro.app").unwrap().root
    );
    let meta = fs::symlink_metadata(&release.root).unwrap();
    assert!(meta.is_dir());
    assert_eq!(meta.uid(), unsafe { libc::geteuid() });
    assert_eq!(meta.mode() & 0o777, 0o700);
    let prefix = "x".repeat(102);
    assert!(validate_socket_path(Path::new(&prefix)).is_ok());
    let at_limit = "x".repeat(103);
    assert!(validate_socket_path(Path::new(&at_limit)).is_ok());
    let over = "x".repeat(104);
    assert!(validate_socket_path(Path::new(&over)).is_err());
    let dir = scratch();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o777)).unwrap();
    assert!(validate_root(&dir).is_err());
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    let link = dir.with_extension("link");
    std::os::unix::fs::symlink(&dir, &link).unwrap();
    assert!(validate_root(&link).is_err());
    fs::remove_file(&link).unwrap();
    fs::remove_dir(&dir).unwrap();
}
