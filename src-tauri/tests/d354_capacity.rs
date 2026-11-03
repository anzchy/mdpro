#![cfg(target_os = "macos")]

use std::fs;
use std::io::Write;
use std::net::Shutdown;
use std::os::unix::fs::MetadataExt;
use std::os::unix::net::UnixStream;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri_app_lib::services::instance_admission::{
    admit, encode, Admission, ForwardRequest, ForwardingServer, Namespace, MAX_FRAME_BYTES,
};

#[test]
fn reader_capacity_returns_after_timeout_malformed_and_oversize_frames() {
    let key = format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let namespace = Namespace::for_identifier(&key).unwrap();
    let owner = match admit(&key, b"").unwrap() {
        Admission::Owner(owner) => owner,
        _ => panic!("first process must own the endpoint"),
    };
    let socket_inode = fs::metadata(&namespace.socket).unwrap().ino();
    let owner_pid = std::process::id();
    let mut server = ForwardingServer::start(owner.listener()).unwrap();
    let handle = server.handle();
    let routed = Arc::new(Mutex::new(Vec::new()));
    let journal = routed.clone();
    handle.publish(Arc::new(move |request| {
        journal.lock().unwrap().push(request)
    }));

    let mut stalled = UnixStream::connect(&namespace.socket).unwrap();
    stalled.write_all(b"/tmp/partial").unwrap();
    thread::sleep(Duration::from_millis(2200));
    drop(stalled);

    for cycle in 0..5 {
        let mut malformed = UnixStream::connect(&namespace.socket).unwrap();
        malformed.write_all(b"bad-frame").unwrap();
        malformed.shutdown(Shutdown::Write).unwrap();
        drop(malformed);
        let request = ForwardRequest {
            cwd: "/tmp/工作 目录".to_string(),
            argv: vec!["mdpro".to_string(), format!("文 件-{cycle}.md")],
        };
        let frame = encode(&request).unwrap();
        assert!(matches!(admit(&key, &frame).unwrap(), Admission::Forwarded));
        let until = Instant::now() + Duration::from_secs(3);
        while routed.lock().unwrap().len() != cycle + 1 && Instant::now() < until {
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(routed.lock().unwrap()[cycle], request);
    }

    let mut oversized = UnixStream::connect(&namespace.socket).unwrap();
    let _ = oversized.write_all(&vec![b'x'; MAX_FRAME_BYTES + 1]);
    let _ = oversized.shutdown(Shutdown::Write);
    drop(oversized);
    let fresh = ForwardRequest {
        cwd: "/tmp/工作 目录".to_string(),
        argv: vec!["mdpro".to_string(), "fresh.md".to_string()],
    };
    assert!(matches!(
        admit(&key, &encode(&fresh).unwrap()).unwrap(),
        Admission::Forwarded
    ));
    let until = Instant::now() + Duration::from_secs(3);
    while routed.lock().unwrap().len() != 6 && Instant::now() < until {
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(routed.lock().unwrap().len(), 6);
    assert_eq!(routed.lock().unwrap()[5], fresh);
    assert_eq!(std::process::id(), owner_pid);
    assert_eq!(fs::metadata(&namespace.socket).unwrap().ino(), socket_inode);
    server.retire();
    drop(owner);
    let _ = fs::remove_file(&namespace.socket);
    let _ = fs::remove_file(&namespace.public_alias);
    let _ = fs::remove_file(&namespace.lock);
    let _ = fs::remove_dir(&namespace.directory);
}
