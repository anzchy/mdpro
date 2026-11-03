//! Stable owner-lock validation, nonblocking election, and debug-only contention observation.

use std::fs::{File, OpenOptions};
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

use super::macos::AdmissionError;

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

pub(super) fn open_lock(path: &Path) -> Result<File, AdmissionError> {
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

pub(super) fn try_lock(file: &File) -> Result<bool, AdmissionError> {
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        return Ok(true);
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::EWOULDBLOCK) {
        #[cfg(debug_assertions)]
        if let Some(path) = std::env::var_os("D354_TEST_LOCK_CONTENTION_MARKER") {
            std::fs::write(path, b"contended")?;
        }
        Ok(false)
    } else {
        Err(error.into())
    }
}
