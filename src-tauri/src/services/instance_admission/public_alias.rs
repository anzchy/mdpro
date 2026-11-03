//! Classification and exclusive creation of the optional public compatibility alias.

use std::fs;
use std::io;
use std::os::unix::fs::FileTypeExt;
use std::os::unix::fs::MetadataExt;

use super::macos::{AdmissionError, Namespace};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum PublicEntry {
    Absent,
    OwnAlias,
    ForeignUid,
    LegacySocket,
    UnknownSameUid,
}

pub(super) fn classify(namespace: &Namespace) -> Result<PublicEntry, AdmissionError> {
    let metadata = match fs::symlink_metadata(&namespace.public_alias) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(PublicEntry::Absent);
        }
        Err(error) => return Err(error.into()),
    };
    if metadata.uid() != unsafe { libc::geteuid() } {
        return Ok(PublicEntry::ForeignUid);
    }
    if metadata.file_type().is_symlink()
        && fs::read_link(&namespace.public_alias).ok().as_deref()
            == Some(namespace.socket.as_path())
    {
        return Ok(PublicEntry::OwnAlias);
    }
    if metadata.file_type().is_socket() {
        return Ok(PublicEntry::LegacySocket);
    }
    Ok(PublicEntry::UnknownSameUid)
}

pub(super) fn ensure(namespace: &Namespace) -> Result<PublicEntry, AdmissionError> {
    match std::os::unix::fs::symlink(&namespace.socket, &namespace.public_alias) {
        Ok(()) => Ok(PublicEntry::OwnAlias),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => classify(namespace),
        Err(error) => Err(error.into()),
    }
}
