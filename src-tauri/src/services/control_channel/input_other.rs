//! Purpose: the control channel's input on platforms other than macOS
//! (ADR-0047 WI-009 item 17). The channel is Unix-only, as `verify-run` is,
//! so in practice this is Linux: every input command is refused as
//! unsupported, never compiled out and never a silent success.

use serde_json::Value;
use tauri::{Runtime, WebviewWindow};

use super::proto::Failure;
use super::server::Input;

pub fn input<R: Runtime>(_win: &WebviewWindow<R>, _input: Input) -> Result<Value, Failure> {
    Err(Failure::new(
        "unsupported",
        "native input is implemented on macOS only",
    ))
}
