//! ADR-0047 WI-006 spike (candidate A): the agent control channel.
//!
//! Purpose: build the `tauri-plugin-wdio-webdriver` plugin for the
//! `control-channel` feature. Exists only with that feature; a default build
//! has neither this module nor the crate (S1.1).
//!
//! Spike state: step 0 registers the vendored plugin unchanged, to prove it
//! builds against this Tauri. Auth, Host/Origin checks, the script gate and
//! at-most-once come as a patch to the vendored copy (S1.2–S1.4).

use tauri::{plugin::TauriPlugin, Wry};

/// The control-channel plugin, ready to register on the builder.
pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_wdio_webdriver::init()
}
