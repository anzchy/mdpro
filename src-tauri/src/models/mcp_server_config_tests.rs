//! `ServerConfig`'s `Debug` never prints the token (ADR-0040 final review L2).

use super::{ServerConfig, SharedServerConfig};
use std::sync::{Arc, Mutex};

const TOKEN: &str = "tok0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab";

fn config() -> ServerConfig {
    ServerConfig {
        port: 41234,
        token: TOKEN.to_string(),
    }
}

#[test]
fn debug_redacts_the_token_and_keeps_the_port() {
    for shown in [format!("{:?}", config()), format!("{:#?}", config())] {
        assert!(!shown.contains(TOKEN), "Debug printed the token");
        assert!(
            shown.contains("<redacted>"),
            "Debug has no <redacted> marker"
        );
        assert!(shown.contains("41234"), "Debug lost the port");
    }
}

#[test]
fn debug_through_the_shared_wrapper_redacts_the_token() {
    let shared: SharedServerConfig = Arc::new(Mutex::new(Some(config())));
    let shown = format!("{shared:?}");
    assert!(
        !shown.contains(TOKEN),
        "SharedServerConfig Debug printed the token"
    );
    assert!(shown.contains("<redacted>"), "no <redacted> marker");
}
