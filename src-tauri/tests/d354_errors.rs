#![cfg(target_os = "macos")]

use std::fs;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tauri_app_lib::models::{LogEntryPayload, LogLevel, LogStatus, UserPreferences};
use tauri_app_lib::services::instance_admission::{
    admit, settle_admission, Admission, EntryDecision, Namespace, RefusalEffects,
};
use tauri_app_lib::services::logger;

#[derive(Default)]
struct ObservedRefusal {
    persisted: bool,
    log_attempts: Vec<String>,
    stderr: Vec<String>,
    alerts: Vec<String>,
}

impl RefusalEffects for ObservedRefusal {
    fn persist_failure(&mut self, message: &str) -> bool {
        self.log_attempts.push(message.to_owned());
        self.persisted
    }

    fn write_stderr(&mut self, message: &str) {
        self.stderr.push(message.to_owned());
    }

    fn show_native_alert(&mut self, message: &str) -> bool {
        self.alerts.push(message.to_owned());
        true
    }
}

struct PersistedRefusal;

impl RefusalEffects for PersistedRefusal {
    fn persist_failure(&mut self, message: &str) -> bool {
        logger::log_event(LogEntryPayload {
            level: LogLevel::Error,
            event: "app.instance.admission".to_owned(),
            status: LogStatus::Fail,
            action_id: None,
            context: None,
            duration_ms: None,
            error: Some(message.to_owned()),
        });
        let log = std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .unwrap()
            .join(".mdpro/mdpro.log");
        fs::read_to_string(log)
            .map(|content| content.contains("\"event\":\"app.instance.admission\""))
            .unwrap_or(false)
    }

    fn write_stderr(&mut self, message: &str) {
        eprintln!("{message}");
    }

    fn show_native_alert(&mut self, _message: &str) -> bool {
        true
    }
}

fn pending_client(path: &Path) -> Result<OwnedFd, std::io::Error> {
    let fd = unsafe { libc::socket(libc::AF_UNIX, libc::SOCK_STREAM, 0) };
    assert!(fd >= 0);
    let owned = unsafe { OwnedFd::from_raw_fd(fd) };
    assert_eq!(
        unsafe { libc::fcntl(fd, libc::F_SETFL, libc::O_NONBLOCK) },
        0
    );
    let mut address: libc::sockaddr_un = unsafe { std::mem::zeroed() };
    address.sun_family = libc::AF_UNIX as u8;
    address.sun_len = std::mem::size_of::<libc::sockaddr_un>() as u8;
    let bytes = path.as_os_str().as_bytes();
    assert!(bytes.len() < address.sun_path.len());
    for (slot, byte) in address.sun_path.iter_mut().zip(bytes) {
        *slot = *byte as i8;
    }
    let result = unsafe {
        libc::connect(
            fd,
            (&address as *const libc::sockaddr_un).cast(),
            std::mem::size_of::<libc::sockaddr_un>() as u32,
        )
    };
    let error = std::io::Error::last_os_error();
    if result == 0
        || matches!(
            error.raw_os_error(),
            Some(libc::EINPROGRESS) | Some(libc::EAGAIN)
        )
    {
        Ok(owned)
    } else {
        Err(error)
    }
}

#[test]
fn free_lock_and_saturated_legacy_public_listener_refuse_without_replacing_it() {
    let key = format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let namespace = Namespace::for_identifier(&key).unwrap();
    let legacy = UnixListener::bind(&namespace.public_alias).unwrap();
    let inode = fs::symlink_metadata(&namespace.public_alias).unwrap().ino();
    assert_eq!(unsafe { libc::listen(legacy.as_raw_fd(), 1) }, 0);
    let mut clients = Vec::new();
    let mut saturated = false;
    for _ in 0..64 {
        match pending_client(&namespace.public_alias) {
            Ok(client) => clients.push(client),
            Err(error) if error.raw_os_error() == Some(libc::ECONNREFUSED) => {
                saturated = true;
                break;
            }
            Err(error) => panic!("legacy backlog fixture failed: {error}"),
        }
    }
    assert!(saturated, "legacy public backlog was not saturated");

    let started = Instant::now();
    let outcome = admit(&key, b"/tmp\0\0mdpro\0legacy.md");
    assert!(matches!(outcome, Ok(Admission::Refused)));
    assert!(started.elapsed() < Duration::from_secs(11));
    assert_eq!(
        fs::symlink_metadata(&namespace.public_alias).unwrap().ino(),
        inode
    );
    assert!(
        !namespace.socket.exists(),
        "refusal must not set up a private owner"
    );

    drop(clients);
    legacy.set_nonblocking(true).unwrap();
    while legacy.accept().is_ok() {}
    assert!(UnixStream::connect(&namespace.public_alias).is_ok());
    drop(legacy);
    let _ = fs::remove_file(&namespace.public_alias);
    let _ = fs::remove_file(&namespace.lock);
    let _ = fs::remove_dir(&namespace.directory);
}

#[test]
fn saturated_private_backlog_refuses_within_the_admission_deadline() {
    let key = format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let namespace = Namespace::for_identifier(&key).unwrap();
    let owner = match admit(&key, b"").unwrap() {
        Admission::Owner(owner) => owner,
        _ => panic!("first process must own the endpoint"),
    };
    assert_eq!(unsafe { libc::listen(owner.listener().as_raw_fd(), 1) }, 0);
    let mut clients = Vec::new();
    let mut saturated = false;
    for _ in 0..16 {
        match pending_client(&namespace.socket) {
            Ok(client) => clients.push(client),
            Err(error) if error.raw_os_error() == Some(libc::ECONNREFUSED) => {
                saturated = true;
                break;
            }
            Err(error) => panic!("backlog fixture failed: {error}"),
        }
    }
    assert!(saturated, "fixture did not saturate the accept backlog");
    let frame = b"/tmp\0\0mdpro\0file.md".to_vec();
    let (sender, result) = mpsc::channel();
    let started = Instant::now();
    let contender = thread::spawn(move || {
        let outcome = admit(&key, &frame);
        let _ = sender.send(outcome);
    });
    let outcome = result.recv_timeout(Duration::from_secs(11));
    assert!(
        outcome.is_ok(),
        "blocked connect exceeded admission deadline"
    );
    assert!(matches!(outcome.unwrap(), Ok(Admission::Refused)));
    assert!(started.elapsed() < Duration::from_secs(11));
    drop(clients);
    drop(owner);
    contender.join().unwrap();
    let _ = std::fs::remove_file(&namespace.socket);
    let _ = std::fs::remove_file(&namespace.public_alias);
    let _ = std::fs::remove_file(&namespace.lock);
    let _ = std::fs::remove_dir(&namespace.directory);
}

#[test]
fn peer_close_after_partial_read_never_replays_the_request() {
    use std::io::Read;
    use tauri_app_lib::services::instance_admission::{encode, ForwardRequest};

    let key = format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let namespace = Namespace::for_identifier(&key).unwrap();
    let owner = match admit(&key, b"").unwrap() {
        Admission::Owner(owner) => owner,
        _ => panic!("first process must own the endpoint"),
    };
    let listener = owner.listener().try_clone().unwrap();
    let peer = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut one = [0u8; 1];
        assert_eq!(stream.read(&mut one).unwrap(), 1);
    });
    let frame = encode(&ForwardRequest {
        cwd: "/tmp".to_string(),
        argv: vec!["mdpro".to_string(), "file.md".to_string()],
    })
    .unwrap();
    let outcome = admit(&key, &frame);
    assert!(!matches!(outcome, Ok(Admission::Owner(_))));
    peer.join().unwrap();
    owner.listener().set_nonblocking(true).unwrap();
    assert!(matches!(
        owner.listener().accept(),
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock
    ));
    drop(owner);
    let _ = std::fs::remove_file(&namespace.socket);
    let _ = std::fs::remove_file(&namespace.public_alias);
    let _ = std::fs::remove_file(&namespace.lock);
    let _ = std::fs::remove_dir(&namespace.directory);
}

#[test]
fn late_listener_does_not_extend_the_ten_second_admission_deadline() {
    use std::os::unix::net::UnixListener;

    let key = format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let namespace = Namespace::for_identifier(&key).unwrap();
    let owner = match admit(&key, b"").unwrap() {
        Admission::Owner(owner) => owner,
        _ => panic!("first process must own the endpoint"),
    };
    fs::remove_file(&namespace.socket).unwrap();
    let frame = b"/tmp\0\0mdpro\0file.md".to_vec();
    let (sender, result) = mpsc::channel();
    let started = Instant::now();
    let contender = thread::spawn(move || {
        let outcome = admit(&key, &frame);
        let _ = sender.send(outcome);
    });
    thread::sleep(Duration::from_millis(9200));
    let late_listener = UnixListener::bind(&namespace.socket).unwrap();
    let outcome = result.recv_timeout(Duration::from_secs(4)).unwrap();
    let elapsed = started.elapsed();
    assert!(matches!(outcome, Ok(Admission::Refused)));
    drop(late_listener);
    drop(owner);
    contender.join().unwrap();
    let _ = fs::remove_file(&namespace.socket);
    let _ = fs::remove_file(&namespace.public_alias);
    let _ = fs::remove_file(&namespace.lock);
    let _ = fs::remove_dir(&namespace.directory);
    assert!(
        elapsed < Duration::from_millis(10800),
        "late IPC must use the original admission deadline: {elapsed:?}"
    );
}

#[test]
fn occupied_private_bind_path_fails_without_replacing_the_conflict() {
    let key = format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let namespace = Namespace::for_identifier(&key).unwrap();
    fs::create_dir(&namespace.directory).unwrap();
    fs::set_permissions(&namespace.directory, fs::Permissions::from_mode(0o700)).unwrap();
    let witness = b"unrelated private object";
    fs::write(&namespace.socket, witness).unwrap();
    let inode = fs::symlink_metadata(&namespace.socket).unwrap().ino();

    let outcome = admit(&key, b"/tmp\0\0mdpro\0file.md");
    assert!(outcome.is_err(), "an occupied private bind path must fail");
    assert!(
        namespace.socket.exists(),
        "occupied private bind path: the conflicting object was removed"
    );
    assert_eq!(fs::read(&namespace.socket).unwrap(), witness);
    assert_eq!(
        fs::symlink_metadata(&namespace.socket).unwrap().ino(),
        inode
    );
    assert!(!namespace.public_alias.exists());

    fs::remove_file(&namespace.socket).unwrap();
    fs::remove_file(&namespace.lock).unwrap();
    fs::remove_dir(&namespace.directory).unwrap();
}

#[test]
fn owner_lock_is_cloexec_and_released_only_when_the_owner_dies() {
    let key = format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let namespace = Namespace::for_identifier(&key).unwrap();
    let owner = match admit(&key, b"").unwrap() {
        Admission::Owner(owner) => owner,
        _ => panic!("first process must own the endpoint"),
    };
    let lock = fs::OpenOptions::new()
        .read(true)
        .open(&namespace.lock)
        .unwrap();
    assert_eq!(
        unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
        -1
    );
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::EWOULDBLOCK)
    );

    let mut child = std::process::Command::new("/bin/sleep")
        .arg("4")
        .spawn()
        .unwrap();
    drop(owner);
    let started = Instant::now();
    let successor = admit(&key, b"").unwrap();
    assert!(matches!(successor, Admission::Owner(_)));
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "exec child inherited the owner lock"
    );
    let _ = child.kill();
    let _ = child.wait();
    drop(successor);
    let _ = fs::remove_file(&namespace.public_alias);
    let _ = fs::remove_file(&namespace.lock);
    let _ = fs::remove_dir(&namespace.directory);
}

#[test]
fn production_entry_admits_before_launch_migration_and_builder() {
    let mut effects = ObservedRefusal::default();
    let decision = settle_admission(admit("invalid/identifier", b""), false, &mut effects);
    let mut startup_effects = Vec::new();
    match decision {
        EntryDecision::Continue(_) => {
            startup_effects.extend(["migration", "builder", "window", "setup", "mcp"])
        }
        EntryDecision::Exit(code) => assert_ne!(code, 0),
    }
    assert!(
        startup_effects.is_empty(),
        "failed admission entered normal startup"
    );
}

#[test]
fn untrusted_lock_prevents_owner_setup_without_replacing_the_object() {
    let key = format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let namespace = Namespace::for_identifier(&key).unwrap();
    fs::create_dir(&namespace.directory).unwrap();
    fs::set_permissions(&namespace.directory, fs::Permissions::from_mode(0o700)).unwrap();
    let witness = b"not an owner lock";
    fs::write(&namespace.lock, witness).unwrap();
    let inode = fs::symlink_metadata(&namespace.lock).unwrap().ino();

    let outcome = admit(&key, b"/tmp\0\0mdpro\0file.md");
    assert!(outcome.is_err());
    assert_eq!(fs::read(&namespace.lock).unwrap(), witness);
    assert_eq!(fs::symlink_metadata(&namespace.lock).unwrap().ino(), inode);
    assert!(!namespace.socket.exists());
    assert!(!namespace.public_alias.exists());

    fs::remove_file(&namespace.lock).unwrap();
    fs::remove_dir(&namespace.directory).unwrap();
}

#[test]
fn refusal_entry_has_an_explicit_nonzero_exit_for_missing_diagnostics() {
    let mut effects = ObservedRefusal::default();
    let decision = settle_admission(Ok(Admission::Refused), false, &mut effects);
    assert!(matches!(decision, EntryDecision::Exit(code) if code != 0));
    assert!(
        !effects.stderr.is_empty(),
        "CLI refusal must be visible on stderr"
    );
    assert!(effects.alerts.is_empty());
}

#[test]
fn refusal_path_keeps_disabled_and_unwritable_logging_fail_closed() {
    if std::env::var_os("D354_REFUSAL_CHILD").is_some() {
        let mut effects = PersistedRefusal;
        let decision = settle_admission(Ok(Admission::Refused), false, &mut effects);
        match decision {
            EntryDecision::Exit(code) => std::process::exit(code),
            EntryDecision::Continue(_) => panic!("refusal entered startup"),
        }
    }

    for logging_state in ["disabled", "unwritable"] {
        let home = std::env::temp_dir().join(format!("d354-refusal-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&home).unwrap();
        let config_dir = home.join(".mdpro");
        fs::create_dir(&config_dir).unwrap();
        let mut preferences = UserPreferences::default();
        preferences.logging.enabled = logging_state != "disabled";
        let config = config_dir.join("config.json");
        let stored = serde_json::to_vec(&preferences).unwrap();
        fs::write(&config, &stored).unwrap();
        if logging_state == "unwritable" {
            fs::set_permissions(&config_dir, fs::Permissions::from_mode(0o500)).unwrap();
        }

        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("--nocapture")
            .args([
                "--exact",
                "refusal_path_keeps_disabled_and_unwritable_logging_fail_closed",
            ])
            .env("D354_REFUSAL_CHILD", "1")
            .env("HOME", &home)
            .output()
            .unwrap();
        if logging_state == "unwritable" {
            fs::set_permissions(&config_dir, fs::Permissions::from_mode(0o700)).unwrap();
        }
        assert!(
            !output.status.success(),
            "{logging_state} logging returned success"
        );
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("mdpro"),
            "{logging_state} logging hid the CLI refusal"
        );
        assert_eq!(fs::read(&config).unwrap(), stored);
        assert!(!config_dir.join("mdpro.log").exists());
        fs::remove_file(config).unwrap();
        fs::remove_dir(config_dir).unwrap();
        fs::remove_dir(home).unwrap();
    }
}

#[test]
fn gui_refusal_has_targeted_recovery_and_cli_fallback() {
    let mut effects = ObservedRefusal::default();
    let decision = settle_admission(Ok(Admission::Refused), true, &mut effects);
    assert!(matches!(decision, EntryDecision::Exit(code) if code != 0));
    assert_eq!(
        effects.alerts.len(),
        1,
        "GUI boundary did not receive an alert"
    );
    let text = &effects.alerts[0];
    for step in [
        "Activity Monitor",
        "pgrep -fl mdpro",
        "/tmp/com_mdpro_app_si.sock",
        "relaunch",
    ] {
        assert!(text.contains(step), "missing recovery step: {step}");
    }
    assert!(!text.contains("remove owner.sock"));
    assert!(
        !effects.stderr.is_empty(),
        "failed native alert needs CLI fallback text"
    );
}

#[test]
fn failed_gui_alert_keeps_a_nonzero_exit_and_cli_fallback() {
    #[derive(Default)]
    struct FailedAlert {
        stderr: Vec<String>,
        requested: bool,
    }

    impl RefusalEffects for FailedAlert {
        fn persist_failure(&mut self, _message: &str) -> bool {
            false
        }

        fn write_stderr(&mut self, message: &str) {
            self.stderr.push(message.to_owned());
        }

        fn show_native_alert(&mut self, _message: &str) -> bool {
            self.requested = true;
            false
        }
    }

    let mut effects = FailedAlert::default();
    let decision = settle_admission(Ok(Admission::Refused), true, &mut effects);
    assert!(matches!(decision, EntryDecision::Exit(code) if code != 0));
    assert!(effects.requested, "GUI refusal did not request an alert");
    assert_eq!(effects.stderr.len(), 1, "CLI fallback was not emitted");
    assert!(effects.stderr[0].contains("pgrep -fl mdpro"));
}
