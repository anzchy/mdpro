//! Bounded copy of the macOS single-instance plugin's EOF-framed wire.

use std::io::{self, Read};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::{Duration, Instant};

pub const MAX_FRAME_BYTES: usize = 64 * 1024;
pub const READ_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ForwardRequest {
    pub cwd: String,
    pub argv: Vec<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WireError {
    EmptyArgv,
    InvalidDelimiter,
    InvalidUtf8,
    Oversize,
    Io,
}

pub fn encode(request: &ForwardRequest) -> Result<Vec<u8>, WireError> {
    if request.argv.is_empty() || request.argv[0].is_empty() {
        return Err(WireError::EmptyArgv);
    }
    if request.cwd.contains('\0') || request.argv.iter().any(|arg| arg.contains('\0')) {
        return Err(WireError::InvalidDelimiter);
    }
    let mut bytes = Vec::new();
    bytes.extend_from_slice(request.cwd.as_bytes());
    bytes.extend_from_slice(b"\0\0");
    bytes.extend_from_slice(request.argv.join("\0").as_bytes());
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(WireError::Oversize);
    }
    Ok(bytes)
}

pub fn encode_with_cwd(cwd: &Path, argv: Vec<String>) -> Result<Vec<u8>, WireError> {
    let cwd = cwd.to_str().ok_or(WireError::InvalidUtf8)?;
    encode(&ForwardRequest {
        cwd: cwd.to_owned(),
        argv,
    })
}

pub fn decode(bytes: &[u8]) -> Result<ForwardRequest, WireError> {
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(WireError::Oversize);
    }
    let wire = std::str::from_utf8(bytes).map_err(|_| WireError::InvalidUtf8)?;
    let (cwd, args) = wire.split_once("\0\0").ok_or(WireError::InvalidDelimiter)?;
    if cwd.contains('\0') || args.is_empty() {
        return Err(WireError::InvalidDelimiter);
    }
    let argv: Vec<String> = args.split('\0').map(str::to_owned).collect();
    if argv[0].is_empty() {
        return Err(WireError::EmptyArgv);
    }
    Ok(ForwardRequest {
        cwd: cwd.to_owned(),
        argv,
    })
}

pub fn read_request(stream: &mut UnixStream) -> Result<ForwardRequest, WireError> {
    read_frame(stream, |stream, remaining| {
        stream.set_read_timeout(Some(remaining))
    })
}

/// Reads one EOF-framed request with a single deadline; the timeout setter keeps each read bounded.
pub fn read_frame<R, F>(reader: &mut R, mut set_timeout: F) -> Result<ForwardRequest, WireError>
where
    R: Read,
    F: FnMut(&mut R, Duration) -> io::Result<()>,
{
    let deadline = Instant::now() + READ_TIMEOUT;
    let mut bytes = Vec::new();
    let mut block = [0u8; 4096];
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(WireError::Io);
        }
        set_timeout(reader, remaining).map_err(|_| WireError::Io)?;
        match reader.read(&mut block) {
            Ok(0) => return decode(&bytes),
            Ok(count) => {
                if bytes.len() + count > MAX_FRAME_BYTES {
                    return Err(WireError::Oversize);
                }
                bytes.extend_from_slice(&block[..count]);
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(WireError::Io),
        }
    }
}
