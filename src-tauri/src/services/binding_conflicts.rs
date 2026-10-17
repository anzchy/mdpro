//! Purpose: the binding conflict filter (plan M1A-WI-8, § 5.6, ADR-0114
//! Decision 5), the twin of `src/commands/bindingConflicts.ts`: resolves every
//! configurable row's stored key for a platform and defaults version into a
//! [`Resolution`], and answers who owns a chord in a context. It reads the
//! command table, the reserved chords and the editor inventory from
//! `menu_layout()`. Both languages are held to
//! `tests/fixtures/binding-owner-cases.json` (`cases` and the generated
//! `sweep`). Inert until M1b: nothing feeds the menu, the shortcut hook or the
//! applied snapshot from it.
//!
//! Pipeline: hard-owner index → classify each row (sentinel, unparseable,
//! unavailable, default, custom) → customs vs hard owners and each other →
//! defaults yield to bound customs → unavailable rows record who took their
//! chord.
//!
//! Key decisions (matrix SD4–SD16):
//! - "Custom" = the normal form differs from the row's default (SD4).
//! - A default is never suppressed by a hard owner or a sibling default; it
//!   yields only to a bound custom (SD6).
//! - `conflictsWith` is sorted and de-duplicated; a displaced default is not
//!   listed (SD7). `customDuplicate` applies only without a hard owner (SD8).
//! - Total: stored input is never unwrapped; a version >= 2 selects v2.
//!
//! @coordinates-with services/binding_conflicts_owners.rs — the hard owners
//! @coordinates-with models/chord.rs — normal form

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::menu_layout::{
    menu_layout, Availability, CommandRow, MenuLayout, OwnershipContext, Platform,
};
use crate::models::chord::{normalise_stored, Platform as ChordPlatform};
use owners::{
    add_secondaries, availability_contexts, chord_platform, intersects, min_holder, on,
    shared_index, top_owner, Holder, OwnerIndex,
};
use std::sync::Arc;

#[path = "binding_conflicts_owners.rs"]
mod owners;

const UNASSIGNED: &str = "<unassigned>";
const SYSTEM: &str = "<system>";

/// Why a row binds nothing (matrix SD8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SuppressReason {
    Fixed,
    Native,
    Reserved,
    EditorOwned,
    CustomDuplicate,
    YieldedToCustom,
    Unavailable,
    Unparseable,
}

/// What one configurable row resolves to; the same JSON as TS `Resolution`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Resolution {
    Bound {
        chord: String,
    },
    Unassigned {},
    System {},
    Suppressed {
        reason: SuppressReason,
        #[serde(rename = "conflictsWith")]
        conflicts_with: Vec<String>,
        flagged: bool,
    },
}

/// The resolutions of one input, and who owns each chord.
#[derive(Debug, Clone)]
pub struct BindingState {
    pub resolutions: BTreeMap<String, Resolution>,
    platform: ChordPlatform,
    hard: Arc<OwnerIndex>,
    secondaries: OwnerIndex,
    bound: Vec<Holder>,
    reservers: Vec<Holder>,
}

impl BindingState {
    /// Who owns `chord` (stored syntax) in `context` (SD10, SD15); `None` if no one.
    pub fn owner_of(&self, context: OwnershipContext, chord: &str) -> Option<String> {
        let chord = normalise_stored(chord, self.platform)?;
        let owners = [&self.hard, &self.secondaries].map(|i| i.get(&chord));
        let hard = top_owner(owners.into_iter().flatten().flatten(), context);
        hard.or_else(|| min_holder(&self.bound, &chord, context))
            .or_else(|| min_holder(&self.reservers, &chord, context))
    }
}

struct Entry<'a> {
    row: &'a CommandRow,
    field: String,
    chord: String,
    active: Vec<OwnershipContext>,
    reserve: Vec<OwnershipContext>,
    custom: bool,
}

fn suppressed(reason: SuppressReason, mut ids: Vec<String>, flagged: bool) -> Resolution {
    ids.sort();
    ids.dedup();
    Resolution::Suppressed {
        reason,
        conflicts_with: ids,
        flagged,
    }
}

fn holder(e: &Entry, contexts: &[OwnershipContext]) -> Holder {
    Holder {
        id: e.row.id.clone(),
        chord: e.chord.clone(),
        contexts: contexts.to_vec(),
    }
}

/// Resolve every configurable row of `layout` (tests pass permuted layouts).
pub fn resolve_with(
    layout: &MenuLayout,
    platform: Platform,
    defaults_version: u32,
    stored: &BTreeMap<String, String>,
    overrides: &BTreeMap<String, Availability>,
) -> BindingState {
    let (cp, v2) = (chord_platform(platform), defaults_version >= 2);
    let hard = shared_index(layout, platform, v2);
    let mut secondaries = OwnerIndex::new();
    let mut out = BTreeMap::new();
    let (mut live, mut reservers) = (Vec::new(), Vec::new());
    for row in &layout.rows {
        let Some(field) = row.pref_field.clone() else {
            continue;
        };
        let key = on(&row.key, platform);
        let def = if v2 {
            &key.defaults.v2
        } else {
            &key.defaults.v1
        };
        let def = def.as_deref().unwrap_or_default();
        let value = stored.get(&field).map_or(def, String::as_str);
        let avail = on(&row.availability, platform);
        let ov = overrides.get(&field).copied();
        let avail = ov.unwrap_or(if v2 { avail.v2 } else { avail.v1 });
        let reserve = match ov {
            Some(a @ (Availability::Both | Availability::W | Availability::S)) => {
                availability_contexts(a)
            }
            Some(Availability::None) | None => row.contexts.clone(),
        };
        let allowed = availability_contexts(avail);
        let active: Vec<OwnershipContext> = reserve
            .iter()
            .filter(|c| allowed.contains(c))
            .copied()
            .collect();
        add_secondaries(&mut secondaries, row, &active, platform, v2);
        let chord = normalise_stored(value, cp);
        let custom = chord != normalise_stored(def, cp);
        match (value, chord) {
            (UNASSIGNED, _) => drop(out.insert(field, Resolution::Unassigned {})),
            (SYSTEM, _) => drop(out.insert(field, Resolution::System {})),
            (_, None) => {
                drop(out.insert(field, suppressed(SuppressReason::Unparseable, vec![], true)))
            }
            (_, Some(chord)) => {
                let e = Entry {
                    row,
                    field,
                    chord,
                    active,
                    reserve,
                    custom,
                };
                if e.active.is_empty() {
                    reservers.push(e)
                } else {
                    live.push(e)
                }
            }
        }
    }
    let customs: Vec<&Entry> = live.iter().filter(|e| e.custom).collect();
    let mut bound_customs: Vec<&Entry> = Vec::new();
    for e in &customs {
        let owners: Vec<_> = [&hard, &secondaries]
            .into_iter()
            .filter_map(|i| i.get(&e.chord))
            .flatten()
            .filter(|o| {
                o.except.as_deref() != Some(e.row.id.as_str()) && intersects(&o.contexts, &e.active)
            })
            .collect();
        let dups: Vec<String> = customs
            .iter()
            .filter(|d| {
                d.field != e.field && d.chord == e.chord && intersects(&d.active, &e.active)
            })
            .map(|d| d.row.id.clone())
            .collect();
        let top = owners.iter().min_by_key(|o| o.precedence).map(|o| o.reason);
        let res = match top {
            Some(reason) => suppressed(
                reason,
                owners.iter().map(|o| o.id.clone()).chain(dups).collect(),
                true,
            ),
            None if !dups.is_empty() => suppressed(SuppressReason::CustomDuplicate, dups, true),
            None => {
                bound_customs.push(e);
                Resolution::Bound {
                    chord: e.chord.clone(),
                }
            }
        };
        out.insert(e.field.clone(), res);
    }
    let takers = |e: &Entry, ctx: &[OwnershipContext]| -> Vec<String> {
        bound_customs
            .iter()
            .filter(|c| c.field != e.field && c.chord == e.chord && intersects(&c.active, ctx))
            .map(|c| c.row.id.clone())
            .collect()
    };
    let mut bound: Vec<Holder> = bound_customs.iter().map(|e| holder(e, &e.active)).collect();
    for e in live.iter().filter(|e| !e.custom) {
        let by = takers(e, &e.active);
        let res = if by.is_empty() {
            bound.push(holder(e, &e.active));
            Resolution::Bound {
                chord: e.chord.clone(),
            }
        } else {
            suppressed(SuppressReason::YieldedToCustom, by, false)
        };
        out.insert(e.field.clone(), res);
    }
    for e in &reservers {
        out.insert(
            e.field.clone(),
            suppressed(SuppressReason::Unavailable, takers(e, &e.reserve), false),
        );
    }
    let reservers = reservers.iter().map(|e| holder(e, &e.reserve)).collect();
    BindingState {
        resolutions: out,
        platform: cp,
        hard,
        secondaries,
        bound,
        reservers,
    }
}

/// Each configurable field's resolution, read from the committed layout.
pub fn resolve_bindings(
    platform: Platform,
    defaults_version: u32,
    stored: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, Resolution>, String> {
    let layout = menu_layout()?;
    Ok(resolve_with(layout, platform, defaults_version, stored, &BTreeMap::new()).resolutions)
}

/// Who owns `chord` in `context` for this input (SD10); `None` if no one.
pub fn owner_of(
    platform: Platform,
    defaults_version: u32,
    stored: &BTreeMap<String, String>,
    context: OwnershipContext,
    chord: &str,
) -> Result<Option<String>, String> {
    let layout = menu_layout()?;
    Ok(
        resolve_with(layout, platform, defaults_version, stored, &BTreeMap::new())
            .owner_of(context, chord),
    )
}

#[cfg(test)]
#[path = "binding_conflicts_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "binding_conflicts_law_tests.rs"]
mod law_tests;

#[cfg(test)]
#[path = "binding_conflicts_sweep_tests.rs"]
mod sweep_tests;
