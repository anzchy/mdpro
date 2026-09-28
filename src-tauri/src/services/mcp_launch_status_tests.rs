//! Pure and contract cases for the MCP status projection (ADR-0040 WI-4;
//! originally ADR-0039 WI-5).
//!
//! W-1 (BS-01′, `build_status` cross-product), W-2 (BS-04′, wire shape), W-3
//! (BS-05′, enum domains against the shared fixture). W-4 (the temporary
//! launch-state → phase mapping) and BS-06 (poisoned launch state) were
//! deleted with the launch state in ADR-0040 WI-5; the poisoned-snapshot
//! case is C-11(b) in `mcp_launch_status_snapshot_tests.rs`.

use super::*;
use crate::services::mcp_controller::snapshot::{McpPhase, McpServerError};
use serde_json::Value;

use McpConfigReadError::{Io, LockPoisoned, Parse};
use McpServerError::{BindFailed, BindInUse, PublishFailed, ServeFailed};

/// Shared with `tests/mcp-status-contract.test.ts` (TS-01).
const STATUS_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/mcp-status-contract.json"
);

fn read_status_fixture() -> Value {
    let text = std::fs::read_to_string(STATUS_FIXTURE)
        .unwrap_or_else(|e| panic!("fixture must be readable at {STATUS_FIXTURE}: {e}"));
    serde_json::from_str(&text).expect("fixture is valid JSON")
}

fn str_list(v: &Value) -> Vec<String> {
    let mut out: Vec<String> = v
        .as_array()
        .expect("fixture list")
        .iter()
        .map(|x| x.as_str().expect("fixture string").to_string())
        .collect();
    out.sort();
    out
}

/// Every phase, listed through a `match` witness so a new variant fails to
/// compile here.
fn all_phases() -> Vec<McpPhase> {
    let witness = |p: McpPhase| match p {
        McpPhase::Disabled
        | McpPhase::Starting
        | McpPhase::Running
        | McpPhase::Stopping
        | McpPhase::Failed => (),
    };
    let v = vec![
        McpPhase::Disabled,
        McpPhase::Starting,
        McpPhase::Running,
        McpPhase::Stopping,
        McpPhase::Failed,
    ];
    v.iter().copied().for_each(witness);
    v
}

/// Every server error, through a `match` witness.
fn all_errors() -> Vec<McpServerError> {
    let witness = |e: McpServerError| match e {
        BindInUse | BindFailed | PublishFailed | ServeFailed => (),
    };
    let v = vec![BindInUse, BindFailed, PublishFailed, ServeFailed];
    v.iter().copied().for_each(witness);
    v
}

/// Every configured state, through a `match` witness.
fn all_configured() -> Vec<McpConfigured> {
    let witness = |c: McpConfigured| match c {
        McpConfigured::Enabled | McpConfigured::Disabled | McpConfigured::Unreadable => (),
    };
    let v = vec![
        McpConfigured::Enabled,
        McpConfigured::Disabled,
        McpConfigured::Unreadable,
    ];
    v.iter().copied().for_each(witness);
    v
}

fn wire_str<T: serde::Serialize>(x: &T) -> String {
    serde_json::to_value(x)
        .expect("serialises")
        .as_str()
        .unwrap_or("?")
        .to_string()
}

fn strings<T: serde::Serialize>(xs: Vec<T>) -> Vec<String> {
    let mut out: Vec<String> = xs.iter().map(wire_str).collect();
    out.sort();
    out
}

#[test]
fn w1_full_cross_product_against_hand_written_per_axis_oracles() {
    // Hand-written per-axis oracles; the law is that each output field is a
    // function of exactly one input. The error axis is independent of the
    // phase here: Failed⇔error is a controller law, not a projection law.
    let phases: [(McpPhase, &str); 5] = [
        (McpPhase::Disabled, "disabled"),
        (McpPhase::Starting, "starting"),
        (McpPhase::Running, "running"),
        (McpPhase::Stopping, "stopping"),
        (McpPhase::Failed, "failed"),
    ];
    let errors: [(Option<McpServerError>, Option<&str>); 5] = [
        (None, None),
        (Some(BindInUse), Some("bind_in_use")),
        (Some(BindFailed), Some("bind_failed")),
        (Some(PublishFailed), Some("publish_failed")),
        (Some(ServeFailed), Some("serve_failed")),
    ];
    let reads: [(McpConfigRead, &str); 6] = [
        (Ok(Some(true)), "enabled"),
        (Ok(None), "enabled"),
        (Ok(Some(false)), "disabled"),
        (Err(LockPoisoned), "unreadable"),
        (Err(Io), "unreadable"),
        (Err(Parse), "unreadable"),
    ];
    let ports: [(Option<u16>, bool); 2] = [(None, false), (Some(55045), true)];

    let mut rows = 0;
    let mut failures = Vec::new();
    for (phase, want_phase) in phases {
        for (error, want_error) in errors {
            for (read, want_configured) in reads {
                for (port, want_running) in ports {
                    rows += 1;
                    let s = build_status(phase, error, read, port, "bin".to_string());
                    let v = serde_json::to_value(&s).unwrap();
                    let got = (
                        v["phase"].as_str().unwrap_or("?").to_string(),
                        v["error"].as_str().map(str::to_string),
                        v["configured"].as_str().unwrap_or("?").to_string(),
                        v["running"].as_bool(),
                        v["port"].as_u64(),
                        v["binaryPath"].as_str().unwrap_or("?").to_string(),
                    );
                    let want = (
                        want_phase.to_string(),
                        want_error.map(str::to_string),
                        want_configured.to_string(),
                        Some(want_running),
                        port.map(u64::from),
                        "bin".to_string(),
                    );
                    if got != want {
                        failures.push(format!(
                            "({phase:?}, {error:?}, {read:?}, {port:?}) → {got:?}, want {want:?}"
                        ));
                    }
                }
            }
        }
    }
    assert_eq!(rows, 300);
    assert!(
        failures.is_empty(),
        "{} rows: {failures:#?}",
        failures.len()
    );

    // Named off-diagonal rows: `running` follows the port, not the phase.
    assert!(
        build_status(
            McpPhase::Starting,
            None,
            Ok(Some(true)),
            Some(7),
            "b".into()
        )
        .running
    );
    assert!(!build_status(McpPhase::Running, None, Ok(Some(true)), None, "b".into()).running);
}

#[test]
fn w2_wire_key_set_equals_fixture_status_keys_and_no_key_mentions_a_token() {
    let s = build_status(
        McpPhase::Failed,
        Some(BindInUse),
        Ok(Some(false)),
        None,
        "/x".to_string(),
    );
    let v = serde_json::to_value(&s).unwrap();
    let mut keys: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "binaryPath",
            "configured",
            "error",
            "phase",
            "port",
            "running"
        ]
    );
    assert_eq!(keys, str_list(&read_status_fixture()["$statusKeys"]));
    assert_eq!(v["phase"], "failed");
    assert_eq!(v["error"], "bind_in_use");
    assert!(keys.iter().all(|k| !k.to_lowercase().contains("token")));

    // `error: None` is JSON `null`, not a missing key.
    let running = build_status(
        McpPhase::Running,
        None,
        Ok(Some(true)),
        Some(1),
        "/x".into(),
    );
    let v = serde_json::to_value(&running).unwrap();
    let obj = v.as_object().unwrap();
    assert!(obj.contains_key("error"), "error key missing: {v}");
    assert!(obj["error"].is_null(), "error must be null: {v}");
}

#[test]
fn w3_phase_error_configured_domains_are_a_bijection_with_the_fixture() {
    let fixture = read_status_fixture();
    // Sorted lists equal ⇒ every variant has a fixture string and every
    // fixture string has a variant; distinct counts pin injectivity.
    let pairs = [
        ("phase", strings(all_phases()), all_phases().len()),
        ("error", strings(all_errors()), all_errors().len()),
        (
            "configured",
            strings(all_configured()),
            all_configured().len(),
        ),
    ];
    for (name, got, variants) in pairs {
        let want = str_list(&fixture[name]);
        assert_eq!(got, want, "{name}: Rust vs fixture");
        let mut distinct = got.clone();
        distinct.dedup();
        assert_eq!(
            distinct.len(),
            variants,
            "{name}: two variants share a string"
        );
    }
}
