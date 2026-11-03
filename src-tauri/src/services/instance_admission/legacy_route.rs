//! Routes existing and late-arriving public legacy sockets through one qualification path.

use std::time::Instant;

use super::legacy_peer::{forward_if_qualified, CompatibleImage};
use super::macos::{Admission, Namespace, Owner};
use super::public_alias::PublicEntry;

pub(super) fn forward_legacy(
    namespace: &Namespace,
    payload: &[u8],
    deadline: Instant,
    allowed: &[CompatibleImage],
) -> Admission {
    if forward_if_qualified(&namespace.public_alias, payload, deadline, allowed) {
        Admission::Forwarded
    } else {
        Admission::Refused
    }
}

pub(super) fn resolve_after_alias_creation(
    namespace: &Namespace,
    mut owner: Owner,
    entry: PublicEntry,
    payload: &[u8],
    deadline: Instant,
    allowed: &[CompatibleImage],
) -> Admission {
    match entry {
        PublicEntry::LegacySocket => {
            let retired = owner.retire().is_ok();
            drop(owner);
            if retired {
                forward_legacy(namespace, payload, deadline, allowed)
            } else {
                Admission::Refused
            }
        }
        PublicEntry::UnknownSameUid => Admission::Refused,
        PublicEntry::Absent | PublicEntry::OwnAlias | PublicEntry::ForeignUid => {
            Admission::Owner(owner)
        }
    }
}
