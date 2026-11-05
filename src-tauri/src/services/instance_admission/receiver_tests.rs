use super::*;
use std::io::Read;
use std::os::unix::net::UnixStream;
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn handle() -> ForwardingHandle {
    ForwardingHandle {
        state: Arc::new(Mutex::new(State::default())),
    }
}

fn request() -> ForwardRequest {
    ForwardRequest {
        cwd: "/tmp".to_string(),
        argv: vec!["mdpro".to_string(), "file.md".to_string()],
    }
}

fn reply_pair() -> (UnixStream, UnixStream) {
    let (owner, contender) = UnixStream::pair().unwrap();
    contender
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    (owner, contender)
}

fn read_reply(contender: &mut UnixStream) -> Option<u8> {
    let mut byte = [0];
    match contender.read(&mut byte).unwrap() {
        0 => None,
        1 => Some(byte[0]),
        count => panic!("unexpected ACK length: {count}"),
    }
}

#[test]
fn acked_request_is_not_dropped_by_retirement_during_drain() {
    let handle = handle();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release_rx = Arc::new(Mutex::new(release_rx));
    let (routed_tx, routed_rx) = mpsc::channel();
    handle.publish(Arc::new(move |request| {
        routed_tx.send(request).unwrap();
        entered_tx.send(()).unwrap();
        release_rx.lock().unwrap().recv().unwrap();
    }));
    let (a_owner, mut a_contender) = reply_pair();
    let receiving = {
        let handle = handle.clone();
        thread::spawn(move || handle.receive_with_stream(request(), a_owner))
    };
    entered_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    a_contender
        .set_read_timeout(Some(Duration::from_millis(100)))
        .unwrap();
    let mut byte = [0];
    assert!(
        a_contender.read(&mut byte).is_err(),
        "ACK preceded route return"
    );
    a_contender
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();

    let (b_owner, mut b_contender) = reply_pair();
    handle.receive_with_stream(request(), b_owner);
    assert_eq!(handle.pending_count(), 1);
    let retiring = handle.clone();
    let retirement = thread::spawn(move || retiring.retire());
    let deadline = Instant::now() + Duration::from_secs(3);
    while !handle.state.lock().unwrap().retiring {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(1));
    }
    release_tx.send(()).unwrap();
    retirement.join().unwrap();
    receiving.join().unwrap();
    assert_eq!(read_reply(&mut a_contender), Some(1));
    assert_ne!(read_reply(&mut b_contender), Some(1));
    assert!(routed_rx.try_recv().is_ok());
    assert!(routed_rx.try_recv().is_err(), "B reached the route");
}

#[test]
fn request_queued_before_publish_is_refused_visibly_on_retirement() {
    let handle = handle();
    let (owner, mut contender) = reply_pair();
    handle.receive_with_stream(request(), owner);
    assert_eq!(handle.pending_count(), 1);
    handle.retire();
    assert_ne!(read_reply(&mut contender), Some(1));
}

#[test]
fn queued_request_is_refused_after_route_panic() {
    let handle = handle();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release_rx = Arc::new(Mutex::new(release_rx));
    let (routed_tx, routed_rx) = mpsc::channel();
    handle.publish(Arc::new(move |request| {
        routed_tx.send(request).unwrap();
        entered_tx.send(()).unwrap();
        release_rx.lock().unwrap().recv().unwrap();
        panic!("route failed");
    }));
    let (a_owner, mut a_contender) = reply_pair();
    let receiving = {
        let handle = handle.clone();
        thread::spawn(move || handle.receive_with_stream(request(), a_owner))
    };
    entered_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    let (b_owner, mut b_contender) = reply_pair();
    handle.receive_with_stream(request(), b_owner);
    assert_eq!(handle.pending_count(), 1);
    release_tx.send(()).unwrap();
    receiving.join().unwrap();
    assert_ne!(read_reply(&mut a_contender), Some(1));
    assert_ne!(read_reply(&mut b_contender), Some(1));
    assert!(routed_rx.try_recv().is_ok());
    assert!(routed_rx.try_recv().is_err(), "B reached the failed route");
}

#[test]
fn popped_request_is_refused_if_retirement_wins_before_route() {
    let handle = handle();
    let (popped_tx, popped_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release_rx = Arc::new(Mutex::new(release_rx));
    handle.state.lock().unwrap().before_route = Some(Arc::new(move || {
        popped_tx.send(()).unwrap();
        release_rx.lock().unwrap().recv().unwrap();
    }));
    let (routed_tx, routed_rx) = mpsc::channel();
    handle.publish(Arc::new(move |request| routed_tx.send(request).unwrap()));
    let sender = handle.clone();
    let receiving = thread::spawn(move || sender.receive(request()));
    popped_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    handle.retire();
    release_tx.send(()).unwrap();
    assert!(
        !receiving.join().unwrap(),
        "retired request must be refused"
    );
    assert!(
        routed_rx.try_recv().is_err(),
        "retired owner received a request"
    );
}

#[test]
fn retirement_waits_for_an_active_route_callback() {
    let handle = handle();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release_rx = Arc::new(Mutex::new(release_rx));
    handle.publish(Arc::new(move |_| {
        entered_tx.send(()).unwrap();
        release_rx.lock().unwrap().recv().unwrap();
    }));
    let sender = handle.clone();
    let receiving = thread::spawn(move || sender.receive(request()));
    entered_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    let retiring = handle.clone();
    let (done_tx, done_rx) = mpsc::channel();
    let retirement = thread::spawn(move || {
        retiring.retire();
        done_tx.send(()).unwrap();
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    while !handle.state.lock().unwrap().retiring {
        assert!(Instant::now() < deadline, "retirement did not start");
        thread::sleep(Duration::from_millis(1));
    }
    assert!(
        done_rx.recv_timeout(Duration::from_millis(150)).is_err(),
        "retire returned while a route callback was still running"
    );
    release_tx.send(()).unwrap();
    retirement.join().unwrap();
    receiving.join().unwrap();
    assert!(done_rx.try_recv().is_ok());
}
