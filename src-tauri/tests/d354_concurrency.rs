#![cfg(target_os = "macos")]

use std::fs;
use std::sync::{mpsc, Arc, Barrier, Mutex};
use std::thread;
use std::time::{Duration, Instant};
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
    let (result_tx, result_rx) = mpsc::channel();
    let threads: Vec<_> = (0..n)
        .map(|id| {
            let key = key.clone();
            let barrier = barrier.clone();
            let result_tx = result_tx.clone();
            thread::spawn(move || {
                let request = ForwardRequest {
                    cwd: "/tmp/工作".to_string(),
                    argv: vec!["mdpro".to_string(), format!("文 件-{id}.md")],
                };
                let frame = encode(&request).unwrap();
                barrier.wait();
                result_tx.send((request, admit(&key, &frame))).unwrap();
            })
        })
        .collect();
    drop(result_tx);
    barrier.wait();
    let mut results = Vec::with_capacity(n);
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let pending = handle.pending_count();
        assert!(pending <= MAX_PENDING);
        if pending == MAX_PENDING && results.len() == 8 {
            break;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(!remaining.is_zero(), "queue did not fill before publish");
        if let Ok(result) = result_rx.recv_timeout(remaining.min(Duration::from_millis(10))) {
            assert!(matches!(result.1, Ok(Admission::Refused)));
            results.push(result);
            assert!(results.len() <= 8, "more than eight pre-publish results");
        }
    }
    assert_eq!(handle.pending_count(), MAX_PENDING);
    assert_eq!(results.len(), 8);
    let routed = Arc::new(Mutex::new(Vec::new()));
    let journal = routed.clone();
    handle.publish(Arc::new(move |request| {
        journal.lock().unwrap().push(request)
    }));
    while results.len() < n {
        results.push(result_rx.recv_timeout(Duration::from_secs(5)).unwrap());
    }
    for thread in threads {
        thread.join().unwrap();
    }
    let accepted: Vec<_> = results
        .iter()
        .filter_map(|(request, outcome)| {
            matches!(outcome, Ok(Admission::Forwarded)).then_some(request.clone())
        })
        .collect();
    assert_eq!(accepted.len(), MAX_PENDING);
    assert_eq!(results.len() - accepted.len(), 8);
    assert_eq!(handle.pending_count(), 0);
    let actual = routed.lock().unwrap();
    assert_eq!(actual.len(), MAX_PENDING);
    for request in &accepted {
        assert_eq!(actual.iter().filter(|value| *value == request).count(), 1);
    }
    for (request, outcome) in &results {
        if matches!(outcome, Ok(Admission::Refused)) {
            assert!(!actual.contains(request), "refused request was routed");
        }
    }
    drop(actual);
    server.retire();
    drop(owner);
    let _ = fs::remove_file(&namespace.socket);
    let _ = fs::remove_file(&namespace.public_alias);
    let _ = fs::remove_file(&namespace.lock);
    let _ = fs::remove_dir(&namespace.directory);
}
