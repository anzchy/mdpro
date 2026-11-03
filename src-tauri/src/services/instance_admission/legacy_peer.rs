//! Kernel peer credentials and dynamic code-signature checks for legacy public forwarding.

use security_framework::os::macos::code_signing::{
    Flags, GuestAttributes, SecCode, SecRequirement,
};
use std::io::{self, Write};
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::str::FromStr;
use std::thread;
use std::time::{Duration, Instant};

use super::codec::decode;
use super::connector::{connect_until, io_timeout};

/// One reviewed legacy build, identified by its exact CodeDirectory hash.
#[derive(Clone, Copy, Debug)]
pub struct CompatibleImage {
    pub cdhash: &'static str,
}

/// Explicitly compatible 0.3.5 release and 0.3.5 canary images.
pub const LEGACY_COMPATIBLE_IMAGES: &[CompatibleImage] = &[
    CompatibleImage {
        cdhash: "e920fa6d9fdd816750301333e60cd26c981ced46",
    },
    CompatibleImage {
        cdhash: "29b4d6da691a1cc270bef922049132da844e02e7",
    },
];

/// Credentials obtained from the connected Unix socket, not a pathname.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PeerIdentity {
    pub pid: u32,
    pub uid: u32,
}

/// Checks the running guest against exact allowlisted CDHashes. Unknown guests fail closed.
pub fn running_image_allowed(pid: libc::pid_t, allowed: &[CompatibleImage]) -> bool {
    if pid <= 0 || allowed.is_empty() {
        return false;
    }
    let mut attributes = GuestAttributes::new();
    attributes.set_pid(pid);
    let Ok(code) = SecCode::copy_guest_with_attribues(None, &attributes, Flags::NONE) else {
        return false;
    };
    allowed.iter().any(|image| {
        if image.cdhash.len() != 40 || !image.cdhash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return false;
        }
        let expression = format!("cdhash H\"{}\"", image.cdhash);
        let Ok(requirement) = SecRequirement::from_str(&expression) else {
            return false;
        };
        code.check_validity(Flags::NO_NETWORK_ACCESS, &requirement)
            .is_ok()
    })
}

/// Qualifies the connected peer before any request bytes are sent.
pub fn qualify_connected_peer(
    stream: &UnixStream,
    allowed: &[CompatibleImage],
) -> Option<PeerIdentity> {
    let mut pid: libc::pid_t = 0;
    let mut length = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_LOCAL,
            libc::LOCAL_PEERPID,
            (&mut pid as *mut libc::pid_t).cast(),
            &mut length,
        )
    };
    if result != 0 || length as usize != std::mem::size_of::<libc::pid_t>() || pid <= 0 {
        return None;
    }
    let mut uid: libc::uid_t = 0;
    let mut gid: libc::gid_t = 0;
    if unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) } != 0
        || uid != unsafe { libc::geteuid() }
        || !running_image_allowed(pid, allowed)
    {
        return None;
    }
    Some(PeerIdentity {
        pid: pid as u32,
        uid: uid as u32,
    })
}

/// Sends at most one request to a proven legacy peer within the admission deadline.
pub fn forward_if_qualified(
    path: &Path,
    payload: &[u8],
    deadline: Instant,
    allowed: &[CompatibleImage],
) -> bool {
    if decode(payload).is_err() {
        return false;
    }
    let mut stream = loop {
        match connect_until(path, deadline) {
            Ok(stream) => break stream,
            Err(error)
                if error.raw_os_error() == Some(libc::ECONNREFUSED)
                    && Instant::now() < deadline =>
            {
                thread::sleep(Duration::from_millis(10));
            }
            Err(_) => return false,
        }
    };
    if qualify_connected_peer(&stream, allowed).is_none() || Instant::now() >= deadline {
        return false;
    }
    let mut sent = 0;
    while sent < payload.len() {
        let Some(timeout) = io_timeout(deadline) else {
            return false;
        };
        if stream.set_write_timeout(Some(timeout)).is_err() {
            return false;
        }
        match stream.write(&payload[sent..]) {
            Ok(0) => return false,
            Ok(count) => sent += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return false,
        }
    }
    stream.shutdown(std::net::Shutdown::Write).is_ok() && Instant::now() <= deadline
}
