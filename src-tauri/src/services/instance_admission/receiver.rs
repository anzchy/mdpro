//! Private listener with a bounded queue and coordinated retirement.

use super::codec::{read_request, ForwardRequest};
use std::collections::VecDeque;
use std::io::{self, Write};
use std::os::unix::net::UnixListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

pub const MAX_PENDING: usize = 64;
type Route = Arc<dyn Fn(ForwardRequest) + Send + Sync + 'static>;

struct PendingRequest {
    request: ForwardRequest,
    accepted: Arc<AtomicBool>,
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
        for queued in self.pending.drain(..) {
            queued.accepted.store(false, Ordering::Release);
        }
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

    fn receive(&self, request: ForwardRequest) -> bool {
        let accepted = Arc::new(AtomicBool::new(true));
        {
            let mut state = self.state.lock().unwrap();
            if state.retiring || state.pending.len() >= MAX_PENDING {
                return false;
            }
            state.pending.push_back(PendingRequest {
                request,
                accepted: accepted.clone(),
            });
        }
        self.drain();
        accepted.load(Ordering::Acquire)
    }

    fn drain(&self) {
        {
            let mut state = self.state.lock().unwrap();
            if state.draining || state.route.is_none() || state.retiring {
                return;
            }
            state.draining = true;
        }
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
                            queued.accepted.store(false, Ordering::Release);
                            state.draining = false;
                            return;
                        }
                        state.active_routes += 1;
                    }
                    let active = ActiveRoute(self.state.clone());
                    let PendingRequest { request, .. } = queued;
                    route(request);
                    drop(active);
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
                            let accepted = worker.receive(request);
                            let _ = stream.write_all(&[u8::from(accepted)]);
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
