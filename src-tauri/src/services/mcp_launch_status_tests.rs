//! Pure and contract cases for the MCP status projection (ADR-0039, WI-5).
//!
//! BS-01 (`build_status` cross-product), BS-04 (wire shape), BS-05 (enum
//! domains against the shared fixture), BS-06 (poisoned launch state).

use super::*;
use serde_json::Value;
use std::sync::{Arc, Mutex};

use McpConfigReadError::{Io, LockPoisoned, Parse};
use McpLaunchStatus::{Disabled, Failed, Running, Starting};

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

#[test]
fn bs01_full_cross_product_against_hand_written_projections() {
    // Hand-written per-axis oracles; the law is that each output field is a
    // function of exactly one input.
    let launches: [(McpLaunchStatus, &str); 4] = [
        (Starting, "starting"),
        (Running, "running"),
        (Failed, "failed"),
        (Disabled, "disabled"),
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
    for (launch, want_launch) in launches {
        for (read, want_configured) in reads {
            for (port, want_running) in ports {
                rows += 1;
                let s = build_status(launch, read, port, "bin".to_string());
                let v = serde_json::to_value(&s).unwrap();
                let got = (
                    v["launch"].as_str().unwrap_or("?").to_string(),
                    v["configured"].as_str().unwrap_or("?").to_string(),
                    s.running,
                    s.port,
                    s.binary_path.clone(),
                );
                let want = (
                    want_launch.to_string(),
                    want_configured.to_string(),
                    want_running,
                    port,
                    "bin".to_string(),
                );
                if got != want {
                    failures.push(format!(
                        "({launch:?}, {read:?}, {port:?}) → {got:?}, want {want:?}"
                    ));
                }
            }
        }
    }
    assert_eq!(rows, 48);
    assert!(
        failures.is_empty(),
        "{} rows: {failures:#?}",
        failures.len()
    );

    // Named off-diagonal rows: `running` follows the port, not `launch`.
    assert!(build_status(Starting, Ok(Some(true)), Some(7), "b".to_string()).running);
    assert!(!build_status(Running, Ok(Some(true)), None, "b".to_string()).running);
}

#[test]
fn bs04_wire_shape_exact_keys_lowercase_enums_no_token() {
    let s = build_status(Failed, Ok(Some(false)), None, "/x/mdpro_mcp".to_string());
    let v = serde_json::to_value(&s).unwrap();
    let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort();
    assert_eq!(
        keys,
        ["binaryPath", "configured", "launch", "port", "running"]
    );
    assert_eq!(v["launch"], "failed");
    assert_eq!(v["configured"], "disabled");
    assert!(keys.iter().all(|k| !k.to_lowercase().contains("token")));

    // The same key list is the fixture's `$statusKeys` (TS-01 reads it).
    let fixture = read_status_fixture();
    let owned: Vec<String> = keys.iter().map(|k| k.to_string()).collect();
    assert_eq!(str_list(&fixture["$statusKeys"]), owned);
}

#[test]
fn bs05_enum_domains_are_a_bijection_with_the_shared_fixture() {
    // Written with `match` so a new variant fails to compile here.
    fn all_launch() -> Vec<McpLaunchStatus> {
        let witness = |s: McpLaunchStatus| match s {
            Starting | Running | Failed | Disabled => (),
        };
        let v = vec![Starting, Running, Failed, Disabled];
        v.iter().copied().for_each(witness);
        v
    }
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
    fn strings<T: serde::Serialize>(xs: Vec<T>) -> Vec<String> {
        let mut out: Vec<String> = xs
            .iter()
            .map(|x| {
                serde_json::to_value(x)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        out.sort();
        out
    }

    let fixture = read_status_fixture();
    assert_eq!(strings(all_launch()), str_list(&fixture["launch"]));
    assert_eq!(strings(all_configured()), str_list(&fixture["configured"]));
}

#[test]
fn bs06_poisoned_launch_state_is_err_not_panic() {
    let state: SharedMcpLaunchState = Arc::new(Mutex::new(Starting));
    let s2 = Arc::clone(&state);
    let _ = std::thread::spawn(move || {
        let _g = s2.lock();
        panic!("poisoning the local launch state on purpose");
    })
    .join();
    assert!(
        state.is_poisoned(),
        "precondition: launch state is poisoned"
    );

    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| current_launch(&state)));
    let r = outcome.expect("current_launch panicked");
    assert!(
        matches!(&r, Err(msg) if !msg.contains('/')),
        "expected a path-free Err for a poisoned launch state, got {r:?}"
    );
}
