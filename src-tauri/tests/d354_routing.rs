#![cfg(target_os = "macos")]

use std::fs;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri_app_lib::launch_args::single_instance_args;
use tauri_app_lib::services::instance_admission::{
    admit, encode_with_cwd, Admission, ForwardingServer, Namespace,
};

#[test]
fn queued_requests_resolve_against_each_senders_cwd_and_open_each_file_once() {
    let key = format!(
        "com.d354.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..12]
    );
    let namespace = Namespace::for_identifier(&key).unwrap();
    let scratch = std::env::temp_dir().join(format!("d354-route-{}", uuid::Uuid::new_v4()));
    let first = scratch.join("first 工作");
    let second = scratch.join("second 工作");
    fs::create_dir_all(&first).unwrap();
    fs::create_dir_all(&second).unwrap();
    let first_file = first.join("文 件.md");
    let second_file = second.join("文 件.md");
    fs::write(&first_file, "first").unwrap();
    fs::write(&second_file, "second").unwrap();
    let owner = match admit(&key, b"").unwrap() {
        Admission::Owner(owner) => owner,
        _ => panic!("first process must own the endpoint"),
    };
    let mut server = ForwardingServer::start(owner.listener()).unwrap();
    let handle = server.handle();
    let mut contenders = Vec::new();
    for (index, cwd) in [&first, &second].into_iter().enumerate() {
        let frame =
            encode_with_cwd(cwd, vec!["mdpro".to_string(), "文 件.md".to_string()]).unwrap();
        let contender_key = key.clone();
        contenders.push(thread::spawn(move || admit(&contender_key, &frame)));
        let until = Instant::now() + Duration::from_secs(5);
        while handle.pending_count() != index + 1 && Instant::now() < until {
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(handle.pending_count(), index + 1);
    }
    let no_file = encode_with_cwd(&second, vec!["mdpro".to_string()]).unwrap();
    let contender_key = key.clone();
    contenders.push(thread::spawn(move || admit(&contender_key, &no_file)));
    let until = Instant::now() + Duration::from_secs(5);
    while handle.pending_count() != 3 && Instant::now() < until {
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(handle.pending_count(), 3);
    let opened = Arc::new(Mutex::new(Vec::new()));
    let journal = opened.clone();
    handle.publish(Arc::new(move |request| {
        let filtered = single_instance_args(request.argv, &request.cwd);
        journal.lock().unwrap().extend(filtered.paths);
    }));
    for contender in contenders {
        assert!(matches!(
            contender.join().unwrap().unwrap(),
            Admission::Forwarded
        ));
    }
    assert_eq!(
        *opened.lock().unwrap(),
        vec![
            first_file
                .canonicalize()
                .unwrap()
                .to_str()
                .unwrap()
                .to_string(),
            second_file
                .canonicalize()
                .unwrap()
                .to_str()
                .unwrap()
                .to_string(),
        ]
    );
    server.retire();
    drop(owner);
    let _ = fs::remove_file(&namespace.socket);
    let _ = fs::remove_file(&namespace.public_alias);
    let _ = fs::remove_file(&namespace.lock);
    let _ = fs::remove_dir(&namespace.directory);
    fs::remove_dir_all(&scratch).unwrap();
}
