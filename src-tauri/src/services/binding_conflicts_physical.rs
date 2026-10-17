//! Purpose: the K8 physical-overlap rule of the binding conflict filter (audit
//! b186 F1), the twin of `src/commands/physicalOverlap.ts` with the same
//! table. A Shift binding on a digit or symbol key also matches its physical
//! key (`src/utils/shortcutMatch.ts`), so A = mods+Shift+k1 and B = the same
//! mods+k2 meet on one keypress wherever Shift+k1 types k2. The hook gives
//! that keypress to B (logical before physical), so the filter suppresses A
//! (`physicalOverlap`, flagged) and leaves B bound, when at least one of the
//! two is a custom value.
//!
//! Limit: the table covers the US and German layouts only. Other layouts
//! (AZERTY, Nordic, …) get the logical-priority fix in the hook, which stops
//! the misfire on any layout, but not the Settings refusal or the resolver
//! flag.
//!
//! @coordinates-with services/binding_conflicts.rs — the only caller

use std::collections::BTreeMap;

use super::owners::{intersects, Holder};
use super::{suppressed, Entry, Resolution, SuppressReason};

/// The 21 K8 keys: (binding character, US shifted, German shifted).
pub const SHIFTED_ON_LAYOUTS: [(&str, &str, &str); 21] = [
    ("0", ")", "="),
    ("1", "!", "!"),
    ("2", "@", "\""),
    ("3", "#", "§"),
    ("4", "$", "$"),
    ("5", "%", "%"),
    ("6", "^", "&"),
    ("7", "&", "/"),
    ("8", "*", "("),
    ("9", "(", ")"),
    ("`", "~", "°"),
    ("-", "_", "?"),
    ("=", "+", "`"),
    ("[", "{", "Ü"),
    ("]", "}", "*"),
    ("\\", "|", "'"),
    (";", ":", "Ö"),
    ("'", "\"", "Ä"),
    (",", "<", ";"),
    (".", ">", ":"),
    ("/", "?", "_"),
];

/// True when `a` and `b` (normal forms) meet as A and B on some table layout:
/// the same modifiers with Shift, A's key one of the 21, and Shift+A's key
/// typing B's key on the US or German layout.
pub fn physically_shadowed_by(a: &str, b: &str) -> bool {
    let (Some((a_mods, a_key)), Some((b_mods, b_key))) = (a.rsplit_once('+'), b.rsplit_once('+'))
    else {
        return false;
    };
    if a_mods != b_mods || a_key == b_key || !a_mods.split('+').any(|m| m == "Shift") {
        return false;
    }
    SHIFTED_ON_LAYOUTS
        .iter()
        .filter(|(k, _, _)| *k == a_key)
        .any(|(_, us, de)| [us, de].iter().any(|t| t.to_uppercase() == b_key))
}

/// Suppress every bound A that some bound B shadows, judged on the bound set
/// before this step so the result does not depend on row order, and drop A
/// from the owner holders.
pub(super) fn apply(
    live: &[Entry],
    out: &mut BTreeMap<String, Resolution>,
    bound: &mut Vec<Holder>,
) {
    let pre: Vec<&Entry> = live
        .iter()
        .filter(|e| matches!(out.get(&e.field), Some(Resolution::Bound { .. })))
        .collect();
    let mut gone: Vec<String> = Vec::new();
    for a in &pre {
        let by: Vec<String> = pre
            .iter()
            .filter(|b| {
                b.field != a.field
                    && (a.custom || b.custom)
                    && intersects(&a.active, &b.active)
                    && physically_shadowed_by(&a.chord, &b.chord)
            })
            .map(|b| b.row.id.clone())
            .collect();
        if !by.is_empty() {
            gone.push(a.row.id.clone());
            let res = suppressed(SuppressReason::PhysicalOverlap, by, true);
            out.insert(a.field.clone(), res);
        }
    }
    bound.retain(|h| !gone.contains(&h.id));
}

#[cfg(test)]
#[path = "binding_conflicts_physical_tests.rs"]
mod tests;
