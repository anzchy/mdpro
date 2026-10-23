//! Purpose: the hard owners the binding conflict filter checks a custom value
//! against (plan M1A-WI-8, matrix SD5, SD7, SD8), the twin of
//! `src/commands/bindingOwners.ts`: fixed keys and secondaries, K5's reserved
//! chords and the editor-owned inventory, indexed by normal form.
//!
//! Key decisions:
//! - Precedence fixed (0) > native (1) > reserved (2) > editorOwned (3); ties
//!   go to the smallest id (SD15), so inventory order never matters.
//! - An `implements(X)` row and a secondary of X are listed as X and never
//!   conflict with X itself (`except`).
//! - The committed layout's stored-independent indexes are built once per
//!   process ([`shared_index`]); secondaries depend on availability
//!   overrides, so the filter adds them per call.
//! - Every function is total: an unparseable chord owns nothing. A retained
//!   editor-owned inventory row remains hard-owned in v2; only rows marked
//!   removed, shadowed, or implemented by a configurable command are projected out.

use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

use super::SuppressReason;
use crate::menu_layout::{
    menu_layout, Availability, CommandRow, Disposition, KeyKind, MenuLayout, MenuRoute,
    OwnershipContext, PerPlatform, Platform,
};
use crate::models::chord::{normalise_stored, Platform as ChordPlatform};

const ALL_CONTEXTS: [OwnershipContext; 7] = [
    OwnershipContext::EditorW,
    OwnershipContext::EditorS,
    OwnershipContext::TableW,
    OwnershipContext::TableS,
    OwnershipContext::Modal,
    OwnershipContext::Recorder,
    OwnershipContext::NativeFocus,
];

#[derive(Debug, Clone)]
pub(super) struct HardOwner {
    pub(super) id: String,
    pub(super) reason: SuppressReason,
    pub(super) precedence: u8,
    pub(super) contexts: Vec<OwnershipContext>,
    pub(super) except: Option<String>,
}

/// Hard owners by normalised chord.
pub(super) type OwnerIndex = BTreeMap<String, Vec<HardOwner>>;

pub(super) fn chord_platform(p: Platform) -> ChordPlatform {
    match p {
        Platform::Macos => ChordPlatform::Macos,
        Platform::Windows => ChordPlatform::Windows,
        Platform::Linux => ChordPlatform::Linux,
    }
}

pub(super) fn on<T>(values: &PerPlatform<T>, p: Platform) -> &T {
    match p {
        Platform::Macos => &values.macos,
        Platform::Windows => &values.windows,
        Platform::Linux => &values.linux,
    }
}

/// The editor contexts a command acts in, given the modes it works in.
pub(super) fn availability_contexts(a: Availability) -> Vec<OwnershipContext> {
    use OwnershipContext::{EditorS, EditorW, TableS, TableW};
    match a {
        Availability::Both => vec![EditorW, EditorS, TableW, TableS],
        Availability::W => vec![EditorW, TableW],
        Availability::S => vec![EditorS, TableS],
        Availability::None => vec![],
    }
}

/// A CodeMirror / ProseMirror keymap name in stored syntax, normalised; `None`
/// when the stored grammar cannot name it (TS `keymapNameToStored`).
pub(super) fn keymap_name_to_stored(name: &str, p: ChordPlatform) -> Option<String> {
    let chars: Vec<char> = name.chars().collect();
    if chars.is_empty() {
        return None;
    }
    let mut parts = vec![String::new()];
    for (i, c) in chars.iter().enumerate() {
        if *c == '-' && i + 1 < chars.len() {
            parts.push(String::new());
        } else if let Some(last) = parts.last_mut() {
            last.push(*c);
        }
    }
    let mut key = parts.pop().unwrap_or_default();
    let mut tokens: Vec<String> = Vec::new();
    for m in &parts {
        let token = match m.as_str() {
            "Mod" => "Cmd",
            "Cmd" | "Meta" if p == ChordPlatform::Macos => "Cmd",
            "Ctrl" | "Control" => "Ctrl",
            "Alt" => "Option",
            "Shift" => "Shift",
            _ => return None,
        };
        tokens.push(token.to_string());
    }
    let upper = key.len() == 1 && key.bytes().all(|b| b.is_ascii_uppercase());
    if upper && !tokens.iter().any(|t| t == "Shift") {
        tokens.push("Shift".into());
    }
    if key == " " {
        key = "Space".into();
    }
    tokens.push(key);
    normalise_stored(&tokens.join("+"), p)
}

fn precedence(reason: SuppressReason) -> u8 {
    match reason {
        SuppressReason::Fixed => 0,
        SuppressReason::Native => 1,
        SuppressReason::Reserved => 2,
        SuppressReason::EditorOwned
        | SuppressReason::CustomDuplicate
        | SuppressReason::YieldedToCustom
        | SuppressReason::Unavailable
        | SuppressReason::Unparseable
        | SuppressReason::PhysicalOverlap => 3,
    }
}

fn fixed_reason(route: MenuRoute) -> SuppressReason {
    match route {
        MenuRoute::Native => SuppressReason::Native,
        MenuRoute::Frontend
        | MenuRoute::RustQuit
        | MenuRoute::RustHide
        | MenuRoute::Unavailable => SuppressReason::Fixed,
    }
}

fn add(index: &mut OwnerIndex, chord: Option<String>, owner: HardOwner) {
    if let Some(chord) = chord.filter(|_| !owner.contexts.is_empty()) {
        index.entry(chord).or_default().push(owner);
    }
}

fn owner(id: String, reason: SuppressReason, contexts: Vec<OwnershipContext>) -> HardOwner {
    let precedence = precedence(reason);
    HardOwner {
        id,
        reason,
        precedence,
        contexts,
        except: None,
    }
}

/// Fixed rows' keys and secondaries, reserved chords and the inventory on `p`.
pub(super) fn hard_owner_index(layout: &MenuLayout, p: Platform, v2: bool) -> OwnerIndex {
    let cp = chord_platform(p);
    let mut index = OwnerIndex::new();
    for row in &layout.rows {
        let key = on(&row.key, p);
        let avail = on(&row.availability, p);
        let available = if v2 { avail.v2 } else { avail.v1 } != Availability::None;
        if key.kind != KeyKind::Fixed || !available {
            continue;
        }
        let (primary, secondaries) = if v2 {
            (&key.defaults.v2, &key.secondaries.v2)
        } else {
            (&key.defaults.v1, &key.secondaries.v1)
        };
        let reason = fixed_reason(*on(&row.route, p));
        for chord in primary.iter().chain(secondaries) {
            let o = owner(row.id.clone(), reason, row.contexts.clone());
            add(&mut index, normalise_stored(chord, cp), o);
        }
    }
    for chord in on(&layout.reserved, p) {
        let Some(norm) = normalise_stored(chord, cp) else {
            continue;
        };
        let o = owner(
            format!("reserved:{norm}"),
            SuppressReason::Reserved,
            ALL_CONTEXTS.to_vec(),
        );
        add(&mut index, Some(norm), o);
    }
    for r in layout
        .editor_owned
        .iter()
        .filter(|r| r.platforms.contains(&p))
    {
        if v2
            && match &r.disposition {
                Disposition::RemoveInM1b { .. } | Disposition::Shadowed { .. } => true,
                Disposition::Implements { command } => layout
                    .rows
                    .iter()
                    .any(|row| row.id == *command && row.pref_field.is_some()),
                Disposition::EditorOwned {} => false,
            }
        {
            continue;
        }
        let (id, except) = match &r.disposition {
            Disposition::Implements { command } => (command.clone(), Some(command.clone())),
            Disposition::EditorOwned {}
            | Disposition::RemoveInM1b { .. }
            | Disposition::Shadowed { .. } => (format!("editor:{}:{}", r.source, r.key), None),
        };
        let mut o = owner(id, SuppressReason::EditorOwned, r.contexts.clone());
        o.except = except;
        add(&mut index, keymap_name_to_stored(&r.key, cp), o);
    }
    index
}

/// A configurable row's fixed secondaries, acting where the row is available.
pub(super) fn add_secondaries(
    index: &mut OwnerIndex,
    row: &CommandRow,
    contexts: &[OwnershipContext],
    p: Platform,
    v2: bool,
) {
    let key = on(&row.key, p);
    if key.kind != KeyKind::Configurable {
        return;
    }
    let secondaries = if v2 {
        &key.secondaries.v2
    } else {
        &key.secondaries.v1
    };
    for chord in secondaries {
        let mut o = owner(row.id.clone(), SuppressReason::Fixed, contexts.to_vec());
        o.except = Some(row.id.clone());
        add(index, normalise_stored(chord, chord_platform(p)), o);
    }
}

/// The highest-precedence owner acting in `context`, smallest id on a tie.
pub(super) fn top_owner<'a>(
    owners: impl Iterator<Item = &'a HardOwner>,
    context: OwnershipContext,
) -> Option<String> {
    let here: Vec<&HardOwner> = owners.filter(|o| o.contexts.contains(&context)).collect();
    let top = here.iter().map(|o| o.precedence).min()?;
    let ids = here.iter().filter(|o| o.precedence == top);
    ids.map(|o| o.id.clone()).min()
}

/// The committed layout's indexes, built once per process for all six
/// (platform, version) pairs; any other layout (a test's permuted copy) is
/// indexed on each call.
pub(super) fn shared_index(layout: &MenuLayout, p: Platform, v2: bool) -> Arc<OwnerIndex> {
    type Shared = Vec<((Platform, bool), Arc<OwnerIndex>)>;
    static SHARED: OnceLock<Option<Shared>> = OnceLock::new();
    let shared = SHARED.get_or_init(|| {
        let committed = menu_layout().ok()?;
        let pairs = [Platform::Macos, Platform::Windows, Platform::Linux]
            .into_iter()
            .flat_map(|q| [false, true].map(|v| (q, v)));
        Some(
            pairs
                .map(|k| (k, Arc::new(hard_owner_index(committed, k.0, k.1))))
                .collect(),
        )
    });
    let is_committed = menu_layout().is_ok_and(|c| std::ptr::eq(c, layout));
    let hit = shared.as_ref().filter(|_| is_committed).and_then(|s| {
        s.iter()
            .find(|(k, _)| *k == (p, v2))
            .map(|(_, i)| Arc::clone(i))
    });
    hit.unwrap_or_else(|| Arc::new(hard_owner_index(layout, p, v2)))
}

/// A configurable row that resolved to a chord, and where it acts.
#[derive(Debug, Clone)]
pub(super) struct Holder {
    pub(super) id: String,
    pub(super) chord: String,
    pub(super) contexts: Vec<OwnershipContext>,
}

pub(super) fn min_holder(holders: &[Holder], chord: &str, ctx: OwnershipContext) -> Option<String> {
    let here = holders
        .iter()
        .filter(|h| h.chord == chord && h.contexts.contains(&ctx));
    here.map(|h| h.id.clone()).min()
}

pub(super) fn intersects(a: &[OwnershipContext], b: &[OwnershipContext]) -> bool {
    a.iter().any(|c| b.contains(c))
}
