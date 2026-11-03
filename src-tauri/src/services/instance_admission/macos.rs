use std::ffi::CStr;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::fd::AsRawFd;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

const STARTUP_DEADLINE: Duration = Duration::from_secs(10);
const RETRY_DELAY: Duration = Duration::from_millis(10);
const SOCKET_PATH_BYTES: usize = 104;

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

fn validate_lock(file: &File) -> Result<(), AdmissionError> {
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o7777 != 0o600
        || metadata.nlink() != 1
    {
        return Err(AdmissionError::Invalid("untrusted owner lock"));
    }
    Ok(())
}

fn open_lock(path: &Path) -> Result<File, AdmissionError> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)?;
    validate_lock(&file)?;
    Ok(file)
}

fn try_lock(file: &File) -> Result<bool, AdmissionError> {
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        return Ok(true);
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::EWOULDBLOCK) {
        Ok(false)
    } else {
        Err(error.into())
    }
}

fn ensure_private_socket_absent(path: &Path) -> Result<(), AdmissionError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if !metadata.file_type().is_socket() || metadata.uid() != unsafe { libc::geteuid() } {
                return Err(AdmissionError::Invalid("untrusted private socket"));
            }
            match UnixStream::connect(path) {
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

fn ensure_public_alias(namespace: &Namespace) -> Result<(), AdmissionError> {
    match std::os::unix::fs::symlink(&namespace.socket, &namespace.public_alias) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            let target = fs::read_link(&namespace.public_alias)
                .map_err(|_| AdmissionError::Invalid("public alias occupied"))?;
            if target == namespace.socket {
                Ok(())
            } else {
                Err(AdmissionError::Invalid("public alias occupied"))
            }
        }
        Err(error) => Err(error.into()),
    }
}

pub struct Owner {
    listener: UnixListener,
    _lock: File,
}

impl Owner {
    pub fn listener(&self) -> &UnixListener {
        &self.listener
    }
}

pub enum Admission {
    Owner(Owner),
    Forwarded,
    Refused,
}

pub fn admit(identifier: &str, payload: &[u8]) -> Result<Admission, AdmissionError> {
    let namespace = Namespace::for_identifier(identifier)?;
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
    let deadline = Instant::now() + STARTUP_DEADLINE;
    loop {
        if try_lock(&lock)? {
            ensure_private_socket_absent(&namespace.socket)?;
            let listener = UnixListener::bind(&namespace.socket)?;
            fs::set_permissions(&namespace.socket, fs::Permissions::from_mode(0o600))?;
            ensure_public_alias(&namespace)?;
            return Ok(Admission::Owner(Owner {
                listener,
                _lock: lock,
            }));
        }
        if let Ok(mut stream) = UnixStream::connect(&namespace.socket) {
            stream.write_all(payload)?;
            return Ok(Admission::Forwarded);
        }
        if Instant::now() >= deadline {
            return Ok(Admission::Refused);
        }
        thread::sleep(RETRY_DELAY);
    }
}
