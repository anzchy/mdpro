#![cfg(target_os = "macos")]

use std::fs;
use tauri_app_lib::services::instance_admission::{admit, Admission, Namespace};

#[test]
fn reset_after_valid_prefix_never_completes_a_frame() {
    use std::io::{self, Read};
    use tauri_app_lib::services::instance_admission::{read_frame, WireError};

    struct ResetAfterPrefix {
        prefix: Option<&'static [u8]>,
    }

    impl Read for ResetAfterPrefix {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if let Some(prefix) = self.prefix.take() {
                buffer[..prefix.len()].copy_from_slice(prefix);
                Ok(prefix.len())
            } else {
                Err(io::Error::from(io::ErrorKind::ConnectionReset))
            }
        }
    }

    let mut reader = ResetAfterPrefix {
        prefix: Some(b"/tmp\0\0mdpro\0valid-prefix.md"),
    };
    assert_eq!(read_frame(&mut reader, |_, _| Ok(())), Err(WireError::Io));
}

#[test]
fn malformed_request_is_refused_before_it_can_reach_the_owner() {
    let key = format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let namespace = Namespace::for_identifier(&key).unwrap();
    let owner = match admit(&key, b"").unwrap() {
        Admission::Owner(owner) => owner,
        _ => panic!("first process must own the endpoint"),
    };
    let outcome = admit(&key, b"no-delimiter").unwrap();
    assert!(matches!(outcome, Admission::Refused));
    drop(owner);
    let _ = fs::remove_file(&namespace.socket);
    let _ = fs::remove_file(&namespace.public_alias);
    let _ = fs::remove_file(&namespace.lock);
    let _ = fs::remove_dir(&namespace.directory);
}

#[test]
fn private_owner_eof_without_ack_refuses_after_full_frame() {
    use std::io::Read;
    use std::thread;

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
    let frame = b"/tmp\0\0mdpro\0file.md";
    let reader = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut received = Vec::new();
        stream.read_to_end(&mut received).unwrap();
        received
    });
    let outcome = admit(&key, frame).unwrap();
    let received = reader.join().unwrap();
    owner.listener().set_nonblocking(true).unwrap();
    let replayed = owner.listener().accept().is_ok();
    drop(owner);
    let _ = fs::remove_file(&namespace.socket);
    let _ = fs::remove_file(&namespace.public_alias);
    let _ = fs::remove_file(&namespace.lock);
    let _ = fs::remove_dir(&namespace.directory);
    assert_eq!(received, frame, "listener received the full request");
    assert!(!replayed, "a possibly delivered frame must not be replayed");
    assert!(matches!(outcome, Admission::Refused), "EOF is not an ack");
}

#[test]
fn old_wire_round_trips_multibyte_paths_and_keeps_argv_zero() {
    use tauri_app_lib::services::instance_admission::{decode, encode, ForwardRequest};
    for cwd in ["/tmp/工作 文 件", "/tmp/one", ""] {
        for argv in [
            vec!["/Applications/mdpro.app".to_string()],
            vec!["mdpro".to_string(), "相 对 路 径.md".to_string()],
        ] {
            let request = ForwardRequest {
                cwd: cwd.to_string(),
                argv,
            };
            assert_eq!(decode(&encode(&request).unwrap()).unwrap(), request);
        }
    }
}

#[test]
fn old_wire_round_trips_varied_bounded_utf8_requests() {
    use tauri_app_lib::services::instance_admission::{
        decode, encode, ForwardRequest, MAX_FRAME_BYTES,
    };

    for cwd in ["", "/tmp/工作 文件", "./relative path"] {
        for optional in ["", "相 对 路 径.md"] {
            let base = ForwardRequest {
                cwd: cwd.to_string(),
                argv: vec![
                    "mdpro".to_string(),
                    String::new(),
                    optional.to_string(),
                    String::new(),
                ],
            };
            let room = MAX_FRAME_BYTES - encode(&base).unwrap().len();
            for length in [0, 1, 17, room / 2, room] {
                let mut request = base.clone();
                request.argv[3] = format!("{}{}", "文".repeat(length / 3), "x".repeat(length % 3));
                let frame = encode(&request).unwrap();
                assert_eq!(frame.len(), MAX_FRAME_BYTES - room + length);
                assert_eq!(decode(&frame).unwrap(), request);
            }
        }
    }
}

#[test]
fn real_socket_queues_before_route_publication_then_drains_once() {
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};
    use tauri_app_lib::services::instance_admission::{encode, ForwardRequest, ForwardingServer};

    let key = format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let namespace = Namespace::for_identifier(&key).unwrap();
    let owner = match admit(&key, b"").unwrap() {
        Admission::Owner(owner) => owner,
        _ => panic!("first process must own the endpoint"),
    };
    let mut server = ForwardingServer::start(owner.listener()).unwrap();
    let handle = server.handle();
    let request = ForwardRequest {
        cwd: "/tmp/工作 文件".to_string(),
        argv: vec!["mdpro".to_string(), "相 对.md".to_string()],
    };
    let frame = encode(&request).unwrap();
    assert!(matches!(admit(&key, &frame).unwrap(), Admission::Forwarded));
    let until = Instant::now() + Duration::from_secs(3);
    while handle.pending_count() != 1 && Instant::now() < until {
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(handle.pending_count(), 1);
    let received = Arc::new(Mutex::new(Vec::new()));
    let journal = received.clone();
    handle.publish(Arc::new(move |value| journal.lock().unwrap().push(value)));
    assert_eq!(*received.lock().unwrap(), vec![request]);
    handle.publish(Arc::new(|_| panic!("already drained request was repeated")));
    server.retire();
    drop(owner);
    let _ = fs::remove_file(&namespace.socket);
    let _ = fs::remove_file(&namespace.public_alias);
    let _ = fs::remove_file(&namespace.lock);
    let _ = fs::remove_dir(&namespace.directory);
}

#[test]
fn fragmented_frame_is_delivered_only_after_eof_and_invalid_frames_do_not_route() {
    use std::io::Write;
    use std::net::Shutdown;
    use std::os::unix::net::UnixStream;
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};
    use tauri_app_lib::services::instance_admission::{ForwardingServer, MAX_FRAME_BYTES};

    let key = format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let namespace = Namespace::for_identifier(&key).unwrap();
    let owner = match admit(&key, b"").unwrap() {
        Admission::Owner(owner) => owner,
        _ => panic!("first process must own the endpoint"),
    };
    let mut server = ForwardingServer::start(owner.listener()).unwrap();
    let handle = server.handle();
    let received = Arc::new(Mutex::new(Vec::new()));
    let journal = received.clone();
    handle.publish(Arc::new(move |value| journal.lock().unwrap().push(value)));
    let mut stream = UnixStream::connect(&namespace.socket).unwrap();
    for part in [
        b"/tmp/".as_slice(),
        "工作".as_bytes(),
        b"\0",
        b"\0mdpro\0",
        "相 对.md".as_bytes(),
    ] {
        stream.write_all(part).unwrap();
    }
    thread::sleep(Duration::from_millis(50));
    assert!(received.lock().unwrap().is_empty());
    stream.shutdown(Shutdown::Write).unwrap();
    let until = Instant::now() + Duration::from_secs(3);
    while received.lock().unwrap().is_empty() && Instant::now() < until {
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(received.lock().unwrap().len(), 1);
    for invalid in [
        b"no delimiter".to_vec(),
        vec![b'x'; MAX_FRAME_BYTES + 1],
        vec![0xff, 0, 0, b'x'],
    ] {
        let mut stream = UnixStream::connect(&namespace.socket).unwrap();
        let _ = stream.write_all(&invalid);
        let _ = stream.shutdown(Shutdown::Write);
    }
    thread::sleep(Duration::from_millis(100));
    assert_eq!(received.lock().unwrap().len(), 1);
    server.retire();
    drop(owner);
    let _ = fs::remove_file(&namespace.socket);
    let _ = fs::remove_file(&namespace.public_alias);
    let _ = fs::remove_file(&namespace.lock);
    let _ = fs::remove_dir(&namespace.directory);
}

#[test]
fn no_file_duplicate_keeps_the_production_launch_filter_empty() {
    use tauri_app_lib::launch_args::single_instance_args;
    assert!(single_instance_args(vec!["mdpro".to_string()], "/tmp")
        .paths
        .is_empty());
    assert!(
        single_instance_args(vec!["mdpro".to_string(), "--flag".to_string()], "/tmp")
            .paths
            .is_empty()
    );
}

#[test]
fn overflow_refuses_and_capacity_returns_after_queue_drain() {
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};
    use tauri_app_lib::services::instance_admission::{
        encode, ForwardRequest, ForwardingServer, MAX_PENDING,
    };

    let key = format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let namespace = Namespace::for_identifier(&key).unwrap();
    let owner = match admit(&key, b"").unwrap() {
        Admission::Owner(owner) => owner,
        _ => panic!("first process must own the endpoint"),
    };
    let mut server = ForwardingServer::start(owner.listener()).unwrap();
    let handle = server.handle();
    for index in 0..MAX_PENDING {
        let frame = encode(&ForwardRequest {
            cwd: "/tmp/工作 目录".to_string(),
            argv: vec!["mdpro".to_string(), format!("文 件-{index}.md")],
        })
        .unwrap();
        assert!(matches!(admit(&key, &frame).unwrap(), Admission::Forwarded));
    }
    let until = Instant::now() + Duration::from_secs(3);
    while handle.pending_count() != MAX_PENDING && Instant::now() < until {
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(handle.pending_count(), MAX_PENDING);
    let extra = encode(&ForwardRequest {
        cwd: "/tmp/工作 目录".to_string(),
        argv: vec!["mdpro".to_string(), "overflow.md".to_string()],
    })
    .unwrap();
    assert!(matches!(admit(&key, &extra).unwrap(), Admission::Refused));
    let routed = Arc::new(Mutex::new(Vec::new()));
    let journal = routed.clone();
    handle.publish(Arc::new(move |request| {
        journal.lock().unwrap().push(request)
    }));
    assert_eq!(routed.lock().unwrap().len(), MAX_PENDING);
    assert_eq!(handle.pending_count(), 0);
    let fresh = encode(&ForwardRequest {
        cwd: "/tmp/工作 目录".to_string(),
        argv: vec!["mdpro".to_string(), "fresh.md".to_string()],
    })
    .unwrap();
    assert!(matches!(admit(&key, &fresh).unwrap(), Admission::Forwarded));
    let until = Instant::now() + Duration::from_secs(3);
    while routed.lock().unwrap().len() != MAX_PENDING + 1 && Instant::now() < until {
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(routed.lock().unwrap().len(), MAX_PENDING + 1);
    server.retire();
    drop(owner);
    let _ = fs::remove_file(&namespace.socket);
    let _ = fs::remove_file(&namespace.public_alias);
    let _ = fs::remove_file(&namespace.lock);
    let _ = fs::remove_dir(&namespace.directory);
}

#[test]
fn dribbling_sender_cannot_extend_one_frame_deadline() {
    use std::io::Write;
    use std::os::unix::net::UnixStream;
    use std::thread;
    use std::time::{Duration, Instant};
    use tauri_app_lib::services::instance_admission::read_request;

    let (mut reader, mut writer) = UnixStream::pair().unwrap();
    let sender = thread::spawn(move || {
        for _ in 0..8 {
            if writer.write_all(b"x").is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(500));
        }
    });
    let started = Instant::now();
    assert!(read_request(&mut reader).is_err());
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "one frame must have a total deadline"
    );
    drop(reader);
    sender.join().unwrap();
}

#[test]
fn non_utf8_legacy_cwd_is_refused_without_lossy_forwarding() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;
    use tauri_app_lib::services::instance_admission::{encode_with_cwd, WireError};

    let cwd = Path::new(OsStr::from_bytes(b"/tmp/invalid-\xff"));
    assert_eq!(
        encode_with_cwd(cwd, vec!["mdpro".to_string()]),
        Err(WireError::InvalidUtf8)
    );
}

#[test]
fn wire_limit_is_measured_in_bytes_and_rejects_one_byte_over() {
    use tauri_app_lib::services::instance_admission::{
        decode, encode, ForwardRequest, WireError, MAX_FRAME_BYTES,
    };

    let mut request = ForwardRequest {
        cwd: "工作".to_string(),
        argv: vec!["mdpro".to_string(), String::new()],
    };
    let overhead = encode(&request).unwrap().len();
    request.argv[1] = "x".repeat(MAX_FRAME_BYTES - overhead);
    let frame = encode(&request).unwrap();
    assert_eq!(frame.len(), MAX_FRAME_BYTES);
    assert_eq!(decode(&frame).unwrap(), request);
    request.argv[1].push('x');
    assert_eq!(encode(&request), Err(WireError::Oversize));
}
