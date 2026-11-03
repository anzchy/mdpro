#![cfg(target_os = "macos")]

use std::fs;
use std::sync::{Arc, Barrier, Mutex};
use std::thread;
use tauri_app_lib::services::instance_admission::{
    admit, encode, Admission, ForwardRequest, ForwardingServer, Namespace, MAX_PENDING,
};

#[test]
fn concurrent_senders_fill_only_bounded_queue_and_each_forward_once() {
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
    let n = MAX_PENDING + 8;
    let barrier = Arc::new(Barrier::new(n + 1));
    let threads: Vec<_> = (0..n)
        .map(|id| {
            let key = key.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                let request = ForwardRequest {
                    cwd: "/tmp/工作".to_string(),
                    argv: vec!["mdpro".to_string(), format!("文 件-{id}.md")],
                };
                let frame = encode(&request).unwrap();
                barrier.wait();
                (request, admit(&key, &frame))
            })
        })
        .collect();
    barrier.wait();
    let results: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    let accepted: Vec<_> = results
        .iter()
        .filter_map(|(request, outcome)| {
            matches!(outcome, Ok(Admission::Forwarded)).then_some(request.clone())
        })
        .collect();
    assert!(accepted.len() <= MAX_PENDING);
    assert!(results.len() - accepted.len() >= 8);
    assert_eq!(handle.pending_count(), accepted.len());
    let routed = Arc::new(Mutex::new(Vec::new()));
    let journal = routed.clone();
    handle.publish(Arc::new(move |request| {
        journal.lock().unwrap().push(request)
    }));
    let actual = routed.lock().unwrap();
    assert_eq!(actual.len(), accepted.len());
    for request in accepted {
        assert_eq!(actual.iter().filter(|value| **value == request).count(), 1);
    }
    drop(actual);
    server.retire();
    drop(owner);
    let _ = fs::remove_file(&namespace.socket);
    let _ = fs::remove_file(&namespace.public_alias);
    let _ = fs::remove_file(&namespace.lock);
    let _ = fs::remove_dir(&namespace.directory);
}
