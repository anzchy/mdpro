//! The holders' leaf handle for the notify callback (D185-WI-1, ADR-0086
//! decision 2).
//!
//! Purpose: `HoldsLeaf` shares lock H (the `HoldMap`) with `Holders` through
//! one `Arc`, and nothing else. The notify callback holds a `HoldsLeaf`, never
//! a `Holders`, so it can read the held spellings of a canonical group but
//! has no path to lock T (`transitions`): notify's `stop()` joins the
//! callback's thread while a teardown holds T, so a callback that could take
//! T would deadlock that teardown.
//!
//! Pipeline: `FileWatcher::new` → `Holders::leaf()` → `EventSink`
//! (file_watcher_fanout.rs) → the callback → `HoldsLeaf::spellings_of(raw)`
//! → `group_key(raw)` (canonicalize, no lock) → `with_map` (H only, one pure
//! `HoldMap::spellings` call).
//!
//! Key decisions:
//! - **A type, not a convention.** The handle's only field is the `Arc` of
//!   the map, so "the callback never takes T" holds by construction.
//! - **The canonicalize runs before H**, never inside a `with_map` argument
//!   (tripwires d173_wi1_k, d173_wi4_k).
//! - WI-1 builds the seam only: `spellings_of` has no caller until D185-WI-2
//!   fans the callback's emit out to every held spelling.
//!
//! @coordinates-with services/file_watcher_holders.rs (parent; `HoldMap`,
//! `with_map`), services/file_watcher_holders_teardown.rs (`group_key`),
//! services/file_watcher_fanout.rs (`EventSink`, the callback's emit step),
//! services/file_watcher.rs (`FileWatcher::new` builds the handle)
use super::teardown::group_key;
use super::{with_map, HoldMap, Holders};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Lock H alone, shared with `Holders`: what the notify callback may read.
#[derive(Clone)]
pub(crate) struct HoldsLeaf {
    map: Arc<Mutex<HoldMap>>,
}

impl Holders {
    /// A handle on H only, for the notify callback (D185). It shares this
    /// registry's map and cannot reach T.
    pub(crate) fn leaf(&self) -> HoldsLeaf {
        HoldsLeaf {
            map: Arc::clone(&self.map),
        }
    }
}

impl HoldsLeaf {
    /// Every distinct raw string held in `raw`'s canonical group, in a stable
    /// order. Canonicalizes first with no lock held, then takes H once.
    pub(crate) fn spellings_of(&self, raw: &Path) -> Vec<String> {
        let key = group_key(raw);
        let mut out = Vec::new();
        with_map(&self.map, |m| out = m.spellings(&key));
        out
    }
}
