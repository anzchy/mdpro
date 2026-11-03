//! Bounded Unix-domain connection and deadline helpers for macOS admission.

use std::io;
use std::os::fd::{FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::{Duration, Instant};

pub(super) const SOCKET_PATH_BYTES: usize = 104;

fn connect_timeout() -> io::Error {
    io::Error::new(io::ErrorKind::TimedOut, "socket connect deadline")
}

pub(super) fn io_timeout(deadline: Instant) -> Option<Duration> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    (!remaining.is_zero()).then_some(remaining.min(Duration::from_secs(2)))
}

pub(super) fn connect_until(path: &Path, deadline: Instant) -> io::Result<UnixStream> {
    if Instant::now() >= deadline {
        return Err(connect_timeout());
    }
    let raw = unsafe { libc::socket(libc::AF_UNIX, libc::SOCK_STREAM, 0) };
    if raw < 0 {
        return Err(io::Error::last_os_error());
    }
    let fd = unsafe { OwnedFd::from_raw_fd(raw) };
    let flags = unsafe { libc::fcntl(raw, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(raw, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(io::Error::last_os_error());
    }
    if unsafe { libc::fcntl(raw, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
        return Err(io::Error::last_os_error());
    }
    let bytes = path.as_os_str().as_bytes();
    if bytes.len() + 1 > SOCKET_PATH_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "socket path too long",
        ));
    }
    let mut address: libc::sockaddr_un = unsafe { std::mem::zeroed() };
    address.sun_family = libc::AF_UNIX as u8;
    address.sun_len = std::mem::size_of::<libc::sockaddr_un>() as u8;
    for (slot, byte) in address.sun_path.iter_mut().zip(bytes) {
        *slot = *byte as i8;
    }
    let connected = unsafe {
        libc::connect(
            raw,
            (&address as *const libc::sockaddr_un).cast(),
            std::mem::size_of::<libc::sockaddr_un>() as libc::socklen_t,
        )
    };
    if connected < 0 {
        let error = io::Error::last_os_error();
        if !matches!(
            error.raw_os_error(),
            Some(libc::EINPROGRESS) | Some(libc::EAGAIN)
        ) {
            return Err(error);
        }
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(connect_timeout());
            }
            let mut pollfd = libc::pollfd {
                fd: raw,
                events: libc::POLLOUT,
                revents: 0,
            };
            let wait_ms = remaining.as_millis().clamp(1, i32::MAX as u128) as i32;
            let result = unsafe { libc::poll(&mut pollfd, 1, wait_ms) };
            if result == 0 {
                return Err(connect_timeout());
            }
            if result < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(error);
            }
            let mut socket_error: libc::c_int = 0;
            let mut length = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
            if unsafe {
                libc::getsockopt(
                    raw,
                    libc::SOL_SOCKET,
                    libc::SO_ERROR,
                    (&mut socket_error as *mut libc::c_int).cast(),
                    &mut length,
                )
            } < 0
            {
                return Err(io::Error::last_os_error());
            }
            if socket_error == 0 {
                break;
            }
            if socket_error != libc::EINPROGRESS && socket_error != libc::EAGAIN {
                return Err(io::Error::from_raw_os_error(socket_error));
            }
        }
    }
    let stream = UnixStream::from(fd);
    stream.set_nonblocking(false)?;
    Ok(stream)
}
