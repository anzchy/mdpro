use std::ffi::CStr;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, PermissionsExt};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use super::codec::decode;
use super::connector::{connect_until, io_timeout, SOCKET_PATH_BYTES};
use super::legacy_peer::{CompatibleImage, LEGACY_COMPATIBLE_IMAGES};
use super::legacy_route::{forward_legacy, resolve_after_alias_creation};
use super::lock::{open_lock, try_lock};
use super::public_alias::{
    classify as classify_public_alias, ensure as ensure_public_alias, PublicEntry,
};

const STARTUP_DEADLINE: Duration = Duration::from_secs(10);
const RETRY_DELAY: Duration = Duration::from_millis(10);

#[derive(Debug)]
pub enum AdmissionError {
    Invalid(&'static str),
    Io(io::Error),
}

impl From<io::Error> for AdmissionError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

pub struct Namespace {
    pub root: PathBuf,
    pub directory: PathBuf,
    pub lock: PathBuf,
    pub socket: PathBuf,
    pub public_alias: PathBuf,
}

impl Namespace {
    pub fn for_identifier(identifier: &str) -> Result<Self, AdmissionError> {
        if identifier.is_empty()
            || !identifier
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
        {
            return Err(AdmissionError::Invalid("invalid application identifier"));
        }
        let root = darwin_user_temp_dir()?;
        validate_root(&root)?;
        let directory = root.join(identifier);
        let socket = directory.join("owner.sock");
        validate_socket_path(&socket)?;
        let alias_name = identifier.replace('.', "_");
        let public_alias = PathBuf::from(format!("/tmp/{alias_name}_si.sock"));
        validate_socket_path(&public_alias)?;
        Ok(Self {
            root,
            lock: directory.join("owner.lock"),
            socket,
            directory,
            public_alias,
        })
    }
}

fn darwin_user_temp_dir() -> Result<PathBuf, AdmissionError> {
    let length = unsafe { libc::confstr(libc::_CS_DARWIN_USER_TEMP_DIR, std::ptr::null_mut(), 0) };
    if length == 0 {
        return Err(AdmissionError::Invalid(
            "Darwin user temp directory unavailable",
        ));
    }
    let mut bytes = vec![0u8; length];
    let written = unsafe {
        libc::confstr(
            libc::_CS_DARWIN_USER_TEMP_DIR,
            bytes.as_mut_ptr().cast(),
            bytes.len(),
        )
    };
    if written != length {
        return Err(AdmissionError::Invalid(
            "Darwin user temp directory changed",
        ));
    }
    let value = CStr::from_bytes_with_nul(&bytes)
        .map_err(|_| AdmissionError::Invalid("invalid Darwin user temp directory"))?;
    let path = Path::new(std::ffi::OsStr::from_bytes(value.to_bytes()));
    Ok(PathBuf::from(path.to_string_lossy().trim_end_matches('/')))
}

pub fn validate_root(root: &Path) -> Result<(), AdmissionError> {
    let metadata = fs::symlink_metadata(root)?;
    if !metadata.file_type().is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o7777 != 0o700
    {
        return Err(AdmissionError::Invalid("untrusted private directory"));
    }
    Ok(())
}

pub fn validate_socket_path(path: &Path) -> Result<(), AdmissionError> {
    if path.as_os_str().as_bytes().len() + 1 > SOCKET_PATH_BYTES {
        return Err(AdmissionError::Invalid("socket pathname exceeds sun_path"));
    }
    Ok(())
}

fn ensure_private_socket_absent(path: &Path, deadline: Instant) -> Result<(), AdmissionError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if !metadata.file_type().is_socket() || metadata.uid() != unsafe { libc::geteuid() } {
                return Err(AdmissionError::Invalid("untrusted private socket"));
            }
            match connect_until(path, deadline) {
                Ok(_) => Err(AdmissionError::Invalid("private socket already live")),
                Err(error) if error.raw_os_error() == Some(libc::ECONNREFUSED) => {
                    fs::remove_file(path)?;
                    Ok(())
                }
                Err(error) => Err(error.into()),
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[derive(Debug)]
pub struct Owner {
    listener: Option<UnixListener>,
    _lock: File,
    socket: PathBuf,
    generation: (u64, u64),
}

impl Owner {
    pub fn listener(&self) -> &UnixListener {
        self.listener
            .as_ref()
            .expect("owner listener already retired")
    }

    pub fn retire(&mut self) -> Result<(), AdmissionError> {
        self.listener.take();
        match fs::symlink_metadata(&self.socket) {
            Ok(metadata) if (metadata.dev(), metadata.ino()) == self.generation => {
                fs::remove_file(&self.socket)?;
                Ok(())
            }
            Ok(_) => Err(AdmissionError::Invalid("private socket generation changed")),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

impl Drop for Owner {
    fn drop(&mut self) {
        let _ = self.retire();
    }
}

#[derive(Debug)]
pub enum Admission {
    Owner(Owner),
    Forwarded,
    Refused,
}

pub fn admit(identifier: &str, payload: &[u8]) -> Result<Admission, AdmissionError> {
    let namespace = Namespace::for_identifier(identifier)?;
    admit_in_namespace(namespace, payload, LEGACY_COMPATIBLE_IMAGES, |_| {})
}

/// Exercises foreign public entries without requiring privilege to create one at a generated path.
#[cfg(debug_assertions)]
pub fn admit_with_public_alias_for_test(
    identifier: &str,
    public_alias: &Path,
    payload: &[u8],
) -> Result<Admission, AdmissionError> {
    let mut namespace = Namespace::for_identifier(identifier)?;
    validate_socket_path(public_alias)?;
    namespace.public_alias = public_alias.to_owned();
    admit_in_namespace(namespace, payload, LEGACY_COMPATIBLE_IMAGES, |_| {})
}

/// Runs a deterministic test action after the first public classification and before exclusive alias creation.
#[cfg(debug_assertions)]
pub fn admit_with_alias_creation_hook_for_test(
    identifier: &str,
    payload: &[u8],
    allowed: &[CompatibleImage],
    hook: impl FnOnce(&Namespace),
) -> Result<Admission, AdmissionError> {
    let namespace = Namespace::for_identifier(identifier)?;
    admit_in_namespace(namespace, payload, allowed, hook)
}

fn admit_in_namespace(
    namespace: Namespace,
    payload: &[u8],
    allowed: &[CompatibleImage],
    before_alias_creation: impl FnOnce(&Namespace),
) -> Result<Admission, AdmissionError> {
    let deadline = Instant::now() + STARTUP_DEADLINE;
    let public_entry = classify_public_alias(&namespace)?;
    if public_entry == PublicEntry::UnknownSameUid {
        return Ok(Admission::Refused);
    }
    if public_entry == PublicEntry::LegacySocket {
        return Ok(forward_legacy(&namespace, payload, deadline, allowed));
    }
    match fs::DirBuilder::new()
        .mode(0o700)
        .create(&namespace.directory)
    {
        Ok(()) => (),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
        Err(error) => return Err(error.into()),
    }
    validate_root(&namespace.directory)?;
    let lock = open_lock(&namespace.lock)?;
    loop {
        if try_lock(&lock)? {
            ensure_private_socket_absent(&namespace.socket, deadline)?;
            let listener = UnixListener::bind(&namespace.socket)?;
            fs::set_permissions(&namespace.socket, fs::Permissions::from_mode(0o600))?;
            let metadata = fs::symlink_metadata(&namespace.socket)?;
            let owner = Owner {
                listener: Some(listener),
                _lock: lock,
                socket: namespace.socket.clone(),
                generation: (metadata.dev(), metadata.ino()),
            };
            let entry = if public_entry == PublicEntry::ForeignUid {
                PublicEntry::ForeignUid
            } else {
                before_alias_creation(&namespace);
                ensure_public_alias(&namespace)?
            };
            return Ok(resolve_after_alias_creation(
                &namespace, owner, entry, payload, deadline, allowed,
            ));
        }
        if decode(payload).is_err() {
            return Ok(Admission::Refused);
        }
        if let Ok(mut stream) = connect_until(&namespace.socket, deadline) {
            let mut sent = 0;
            while sent < payload.len() {
                let Some(timeout) = io_timeout(deadline) else {
                    return Ok(Admission::Refused);
                };
                stream.set_write_timeout(Some(timeout))?;
                match stream.write(&payload[sent..]) {
                    Ok(0) => return Ok(Admission::Refused),
                    Ok(count) => sent += count,
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(_) => return Ok(Admission::Refused),
                }
            }
            stream.shutdown(std::net::Shutdown::Write)?;
            let Some(timeout) = io_timeout(deadline) else {
                return Ok(Admission::Refused);
            };
            stream.set_read_timeout(Some(timeout))?;
            let mut response = [0u8; 1];
            return match stream.read(&mut response) {
                Ok(1) if response[0] == 1 && Instant::now() <= deadline => Ok(Admission::Forwarded),
                Ok(_) | Err(_) => Ok(Admission::Refused),
            };
        }
        if Instant::now() >= deadline {
            return Ok(Admission::Refused);
        }
        thread::sleep(RETRY_DELAY);
    }
}
