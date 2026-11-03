#![cfg(target_os = "macos")]

use std::fs;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tauri_app_lib::services::instance_admission::{admit, Admission, Namespace};

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
