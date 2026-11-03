//! Private listener with a bounded pre-routing queue.

use super::codec::{read_request, ForwardRequest};
use std::collections::VecDeque;
use std::io::{self, Write};
use std::os::unix::net::UnixListener;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

pub const MAX_PENDING: usize = 64;
type Route = Arc<dyn Fn(ForwardRequest) + Send + Sync + 'static>;

#[derive(Default)]
struct State {
    pending: VecDeque<ForwardRequest>,
    route: Option<Route>,
    draining: bool,
    retiring: bool,
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
        {
            let mut state = self.state.lock().unwrap();
            if state.retiring || state.pending.len() >= MAX_PENDING {
                return false;
            }
            state.pending.push_back(request);
        }
        self.drain();
        true
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
                    state.pending.clear();
                    state.draining = false;
                    return;
                }
                match state.pending.pop_front() {
                    Some(request) => Some((state.route.as_ref().unwrap().clone(), request)),
                    None => {
                        state.draining = false;
                        None
                    }
                }
            };
            match next {
                Some((route, request)) => route(request),
                None => return,
            }
        }
    }

    pub fn retire(&self) {
        let mut state = self.state.lock().unwrap();
        state.retiring = true;
        state.pending.clear();
        state.route = None;
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
