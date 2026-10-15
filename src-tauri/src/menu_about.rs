//! Purpose: the metadata the app menu's predefined About item carries per
//! target (D225).
//!
//! Key decisions:
//! - muda opens an About dialog off macOS only when it is given metadata
//!   (`About(Some(_))`); with `None` the click does nothing on Windows and
//!   Linux. macOS keeps `None`, so AppKit's native about panel is unchanged.
//! - Name, version and website only: Cargo.toml's `authors` is a placeholder
//!   and tauri.conf.json sets no copyright, so neither is shown.
//!
//! @coordinates-with src-tauri/src/menu.rs

use tauri::menu::{AboutMetadata, AboutMetadataBuilder};

/// The project page the About dialog links to.
const WEBSITE: &str = "https://github.com/anzchy/mdpro";
const WEBSITE_LABEL: &str = "GitHub";

/// The About item's metadata for target `os`, or `None` on macOS.
pub(crate) fn about_metadata_for(
    os: &str,
    name: &str,
    version: &str,
) -> Option<AboutMetadata<'static>> {
    if os == "macos" {
        return None;
    }
    Some(
        AboutMetadataBuilder::new()
            .name(Some(name))
            .version(Some(version))
            .website(Some(WEBSITE))
            .website_label(Some(WEBSITE_LABEL))
            .build(),
    )
}

#[cfg(test)]
#[path = "menu_about_d225_tests.rs"]
mod tests;
