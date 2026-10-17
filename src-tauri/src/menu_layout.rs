//! Purpose: the Rust reader of `menu_layout.json` (plan M1A-WI-7): the
//! command table, the reserved chords and the editor-owned inventory,
//! generated from `src/commands/` by `buildMenuLayout` and embedded here with
//! `include_str!`, so Rust never keeps a second hand-written copy.
//!
//! Key decisions:
//! - Every struct denies unknown fields and every closed set is an enum, so a
//!   TS change the reader does not understand fails to parse rather than
//!   being dropped. Optional fields are skipped when absent, so the struct
//!   round-trips the file exactly.
//! - No production consumer in M1a; the conflict filter (WI-8) and the menu
//!   build (M1b) read it through `menu_layout()`.
//!
//! @coordinates-with src/commands/buildMenuLayout.ts — the generator
//! @coordinates-with tests/menu-layout-freshness.test.ts — keeps the file fresh

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

/// The committed, generated layout.
pub const MENU_LAYOUT_JSON: &str = include_str!("menu_layout.json");

/// How a menu click reaches its command (plan § 5.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MenuRoute {
    Frontend,
    Native,
    RustQuit,
    RustHide,
    Unavailable,
}

impl MenuRoute {
    /// Who writes the log line when a command on this route runs (matrix SD12,
    /// the twin of TS `routeLogOwner`).
    pub fn log_owner(self) -> &'static str {
        match self {
            MenuRoute::Frontend => "frontend",
            MenuRoute::Native => "native",
            MenuRoute::RustQuit => "rust",
            MenuRoute::RustHide => "rust",
            // A stale event carrying an unavailable id is refused, and logged,
            // by the frontend dispatcher.
            MenuRoute::Unavailable => "frontend",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Macos,
    Windows,
    Linux,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Availability {
    #[serde(rename = "both")]
    Both,
    W,
    S,
    #[serde(rename = "none")]
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OwnershipContext {
    EditorW,
    EditorS,
    TableW,
    TableS,
    Modal,
    Recorder,
    NativeFocus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PerPlatform<T> {
    pub macos: T,
    pub windows: T,
    pub linux: T,
}

/// One value per defaults version. Both entries are required, even when `T`
/// is an `Option` (`deserialize_with` turns off serde's missing-is-`None`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, bound(deserialize = "T: Deserialize<'de>"))]
pub struct Versioned<T> {
    #[serde(deserialize_with = "Deserialize::deserialize")]
    pub v1: T,
    #[serde(deserialize_with = "Deserialize::deserialize")]
    pub v2: T,
}

/// The literal `"none"`: a command with no menu item on that platform.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NoMenu {
    #[serde(rename = "none")]
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MenuPath {
    None(NoMenu),
    Path(Vec<String>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyKind {
    Configurable,
    Fixed,
}

/// A key per version. `defaults` is `null` only on a fixed key with no chord;
/// a configurable key has a string at both versions, as the TS schema says
/// (audit b186 F2), and the parse refuses anything else.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "RawKeySpec")]
pub struct KeySpec {
    pub kind: KeyKind,
    pub defaults: Versioned<Option<String>>,
    pub secondaries: Versioned<Vec<String>>,
}

/// `KeySpec` as written in the file, before the configurable-default check.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawKeySpec {
    kind: KeyKind,
    defaults: Versioned<Option<String>>,
    secondaries: Versioned<Vec<String>>,
}

impl TryFrom<RawKeySpec> for KeySpec {
    type Error = String;

    fn try_from(raw: RawKeySpec) -> Result<Self, String> {
        let RawKeySpec {
            kind,
            defaults,
            secondaries,
        } = raw;
        let unset = defaults.v1.is_none() || defaults.v2.is_none();
        match kind {
            KeyKind::Configurable if unset => {
                Err("a configurable key needs a string default at v1 and v2".to_string())
            }
            KeyKind::Configurable | KeyKind::Fixed => Ok(KeySpec {
                kind,
                defaults,
                secondaries,
            }),
        }
    }
}

impl KeySpec {
    /// The default for one defaults version (`v2` true selects v2).
    pub fn default_at(&self, v2: bool) -> Option<&str> {
        if v2 {
            self.defaults.v2.as_deref()
        } else {
            self.defaults.v1.as_deref()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandRow {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pref_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub menu_id: Option<String>,
    pub menu: PerPlatform<MenuPath>,
    pub key: PerPlatform<KeySpec>,
    pub contexts: Vec<OwnershipContext>,
    pub availability: PerPlatform<Versioned<Availability>>,
    pub route: PerPlatform<MenuRoute>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_behaviour: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InventoryEditor {
    W,
    S,
}

/// What M1b does about an editor-owned chord.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Disposition {
    Implements { command: String },
    EditorOwned {},
    RemoveInM1b { id: String },
    Shadowed { by: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditorOwnedRow {
    pub editor: InventoryEditor,
    pub source: String,
    pub key: String,
    pub platforms: Vec<Platform>,
    pub contexts: Vec<OwnershipContext>,
    pub disposition: Disposition,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub names: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MenuLayout {
    #[serde(rename = "$generated")]
    pub generated: String,
    pub rows: Vec<CommandRow>,
    pub reserved: PerPlatform<Vec<String>>,
    #[serde(rename = "editorOwned")]
    pub editor_owned: Vec<EditorOwnedRow>,
}

/// Parse a layout document; the error names what serde refused.
pub fn parse_menu_layout(json: &str) -> Result<MenuLayout, String> {
    serde_json::from_str(json).map_err(|e| format!("menu_layout.json: {e}"))
}

/// The committed layout, parsed once and cached for the process.
pub fn menu_layout() -> Result<&'static MenuLayout, String> {
    static LAYOUT: OnceLock<Result<MenuLayout, String>> = OnceLock::new();
    LAYOUT
        .get_or_init(|| parse_menu_layout(MENU_LAYOUT_JSON))
        .as_ref()
        .map_err(Clone::clone)
}

#[cfg(test)]
#[path = "menu_layout_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "menu_layout_reject_tests.rs"]
mod reject_tests;
