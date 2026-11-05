//! Private listener with a bounded queue, decision-time ACKs, coordinated retirement, and panic isolation.

use super::codec::{read_request, ForwardRequest};
use std::collections::VecDeque;
#[cfg(test)]
use std::io::Read;
use std::io::{self, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

pub const MAX_PENDING: usize = 64;
type Route = Arc<dyn Fn(ForwardRequest) + Send + Sync + 'static>;

struct PendingRequest {
    request: ForwardRequest,
    responder: Responder,
}

struct Responder(UnixStream);

impl Responder {
    fn new(stream: UnixStream) -> io::Result<Self> {
        stream.set_write_timeout(Some(Duration::from_secs(2)))?;
        Ok(Self(stream))
    }

    fn taken(mut self) {
        // Every 1 the contender reads corresponds to a completed route call.
        let _ = self.0.write_all(&[1]);
    }
}

#[derive(Default)]
struct State {
    pending: VecDeque<PendingRequest>,
    route: Option<Route>,
    draining: bool,
    retiring: bool,
    active_routes: usize,
    idle: Arc<Condvar>,
    #[cfg(test)]
    before_route: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl State {
    fn refuse_pending(&mut self) {
        self.pending.clear();
    }
}

struct ActiveRoute(Arc<Mutex<State>>);

impl Drop for ActiveRoute {
    fn drop(&mut self) {
        let mut state = self.0.lock().unwrap();
        state.active_routes -= 1;
        state.idle.notify_all();
    }
}

#[derive(Clone)]
pub struct ForwardingHandle {
    state: Arc<Mutex<State>>,
}

impl ForwardingHandle {
    /// Publish only after AppHandle, LaunchState, and the file route exist.
    pub fn publish(&self, route: Route) {
        {
            let mut state = self.state.lock().unwrap();
            if state.retiring {
                return;
            }
            state.route = Some(route);
        }
        self.drain();
    }

    pub fn pending_count(&self) -> usize {
        self.state.lock().unwrap().pending.len()
    }

    #[cfg(test)]
    fn receive(&self, request: ForwardRequest) -> bool {
        let (owner, mut contender) = UnixStream::pair().unwrap();
        contender
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        self.receive_with_stream(request, owner);
        let mut byte = [0];
        matches!(contender.read(&mut byte), Ok(1) if byte[0] == 1)
    }

    fn receive_with_stream(&self, request: ForwardRequest, stream: UnixStream) {
        let Ok(responder) = Responder::new(stream) else {
            return;
        };
        let should_spawn = {
            let mut state = self.state.lock().unwrap();
            if state.retiring || state.pending.len() >= MAX_PENDING {
                drop(responder);
                return;
            }
            state
                .pending
                .push_back(PendingRequest { request, responder });
            if state.route.is_some() && !state.draining {
                state.draining = true;
                true
            } else {
                false
            }
        };
        if should_spawn {
            let worker = self.clone();
            if thread::Builder::new()
                .name("mdpro-forward-drain".into())
                .spawn(move || worker.drain_loop())
                .is_err()
            {
                let mut state = self.state.lock().unwrap();
                state.refuse_pending();
                state.draining = false;
            }
        }
    }

    fn drain(&self) {
        {
            let mut state = self.state.lock().unwrap();
            if state.draining || state.route.is_none() || state.retiring {
                return;
            }
            state.draining = true;
        }
        self.drain_loop();
    }

    fn drain_loop(&self) {
        loop {
            let next = {
                let mut state = self.state.lock().unwrap();
                if state.retiring {
                    state.refuse_pending();
                    state.draining = false;
                    return;
                }
                match state.pending.pop_front() {
                    Some(queued) => Some((state.route.as_ref().unwrap().clone(), queued)),
                    None => {
                        state.draining = false;
                        None
                    }
                }
            };
            match next {
                Some((route, queued)) => {
                    #[cfg(test)]
                    let hook = { self.state.lock().unwrap().before_route.clone() };
                    #[cfg(test)]
                    if let Some(hook) = hook {
                        hook();
                    }
                    {
                        let mut state = self.state.lock().unwrap();
                        if state.retiring {
                            state.draining = false;
                            return;
                        }
                        state.active_routes += 1;
                    }
                    let active = ActiveRoute(self.state.clone());
                    let PendingRequest { request, responder } = queued;
                    let result = catch_unwind(AssertUnwindSafe(|| route(request)));
                    drop(active);
                    if result.is_err() {
                        drop(responder);
                        let mut state = self.state.lock().unwrap();
                        if state
                            .route
                            .as_ref()
                            .is_some_and(|current| Arc::ptr_eq(current, &route))
                        {
                            state.route = None;
                            state.refuse_pending();
                        }
                        let resume = state.route.is_some() && !state.pending.is_empty();
                        state.draining = false;
                        drop(state);
                        if resume {
                            self.drain();
                        }
                        return;
                    }
                    responder.taken();
                }
                None => return,
            }
        }
    }

    pub fn retire(&self) {
        let mut state = self.state.lock().unwrap();
        state.retiring = true;
        state.refuse_pending();
        state.route = None;
        let idle = state.idle.clone();
        while state.active_routes != 0 {
            state = idle.wait(state).unwrap();
        }
    }
}

pub struct ForwardingServer {
    handle: ForwardingHandle,
    thread: Option<JoinHandle<()>>,
}

impl ForwardingServer {
    pub fn start(listener: &UnixListener) -> io::Result<Self> {
        let listener = listener.try_clone()?;
        listener.set_nonblocking(true)?;
        let handle = ForwardingHandle {
            state: Arc::new(Mutex::new(State::default())),
        };
        let worker = handle.clone();
        let thread = thread::spawn(move || loop {
            if worker.state.lock().unwrap().retiring {
                break;
            }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    if stream.set_nonblocking(false).is_ok() {
                        if let Ok(request) = read_request(&mut stream) {
                            worker.receive_with_stream(request, stream);
                        }
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5));
                }
                Err(_) => break,
            }
        });
        Ok(Self {
            handle,
            thread: Some(thread),
        })
    }

    pub fn handle(&self) -> ForwardingHandle {
        self.handle.clone()
    }

    pub fn retire(&mut self) {
        self.handle.retire();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for ForwardingServer {
    fn drop(&mut self) {
        self.retire();
    }
}

#[cfg(test)]
#[path = "receiver_tests.rs"]
mod tests;
