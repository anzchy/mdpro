//! ADR-0039 WI-2 — `mcp.serverEnabled` defaults on, and the legacy
//! `mcp.enabled` is retired and never read.
//!
//! Covers matrix cases M2-01 … M2-05, RET-01 and RET-02 of
//! `.claude/tdd-guardian/tests-20260926-235500.md`.
//!
//! **Why the wire form.** Every claim is made on `serde_json::Value`, as
//! `preferences_wi6_tests.rs` does: the serialised shape is the contract that
//! reaches `config.json` and TypeScript, and comparing whole `mcp` objects
//! also pins the exact key set (no stray `enabled`) in the same assertion.
//!
//! Nothing is mocked and nothing touches `$HOME`: real serde, real fixtures.

use super::preferences_wi8_tests::{read_fixture, CONTRACT_FIXTURE, SHIPPED_V1_FIXTURE};
use super::*;
use serde_json::{json, Map, Value};

/// A key of the `mcp` group in one enumerated input: absent, `true` or `false`.
const PRESENCE: [Option<bool>; 3] = [None, Some(true), Some(false)];

fn mcp_object(keys: [(&str, Option<bool>); 4]) -> Value {
    let mut map = Map::new();
    for (key, value) in keys {
        if let Some(v) = value {
            map.insert(key.to_string(), Value::Bool(v));
        }
    }
    Value::Object(map)
}

fn expected_mcp(server: bool, start: bool, approve: bool) -> Value {
    json!({ "serverEnabled": server, "startOnLaunch": start, "autoApproveEdits": approve })
}

/// M2-01 — **Law** (default-on-absence): for every `mcp` object over
/// `{Absent, T, F}⁴` of `serverEnabled`, `startOnLaunch`, `autoApproveEdits`
/// and the legacy `enabled`, the result is
/// `{serverEnabled: s ?? true, startOnLaunch: l ?? false, autoApproveEdits: a ?? false}`
/// — through `McpConfig` directly and through a whole `UserPreferences`.
/// The oracle never reads `enabled`, so every `enabled` value must give the
/// same output; that is also checked directly.
#[test]
fn m2_01_server_enabled_defaults_on_and_legacy_enabled_is_never_read() {
    let mut failures: Vec<String> = Vec::new();
    for server in PRESENCE {
        for start in PRESENCE {
            for approve in PRESENCE {
                let mut per_legacy: Vec<(Option<bool>, Value)> = Vec::new();
                for legacy in PRESENCE {
                    let obj = mcp_object([
                        ("serverEnabled", server),
                        ("startOnLaunch", start),
                        ("autoApproveEdits", approve),
                        ("enabled", legacy),
                    ]);
                    let want = expected_mcp(
                        server.unwrap_or(true),
                        start.unwrap_or(false),
                        approve.unwrap_or(false),
                    );
                    let tuple = format!("{server:?}/{start:?}/{approve:?}/enabled={legacy:?}");

                    match serde_json::from_value::<McpConfig>(obj.clone()) {
                        Ok(c) => {
                            let got = serde_json::to_value(&c).unwrap();
                            if got != want {
                                failures.push(format!("McpConfig {tuple}: got {got}, want {want}"));
                            }
                            per_legacy.push((legacy, got));
                        }
                        Err(e) => failures.push(format!("McpConfig {tuple}: error {e}")),
                    }

                    let mut doc = serde_json::to_value(UserPreferences::default()).unwrap();
                    doc["mcp"] = obj;
                    match serde_json::from_value::<UserPreferences>(doc) {
                        Ok(p) => {
                            let got = serde_json::to_value(&p.mcp).unwrap();
                            if got != want {
                                failures.push(format!("document {tuple}: got {got}, want {want}"));
                            }
                        }
                        Err(e) => failures.push(format!("document {tuple}: error {e}")),
                    }
                }
                if let Some((_, first)) = per_legacy.first() {
                    for (legacy, got) in &per_legacy {
                        if got != first {
                            failures.push(format!(
                                "{server:?}/{start:?}/{approve:?}: enabled={legacy:?} changed \
                                 the output to {got} (vs {first})"
                            ));
                        }
                    }
                }
            }
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

/// M2-02 — **Law** (round trip): for all 2³ `McpConfig` values,
/// `to_value(from_value(to_value(c))) == to_value(c)`, and the key set is
/// exactly `{serverEnabled, startOnLaunch, autoApproveEdits}` — `enabled` is
/// never emitted.
#[test]
fn m2_02_every_mcp_config_round_trips_and_never_emits_enabled() {
    let mut failures: Vec<String> = Vec::new();
    for server in [true, false] {
        for start in [true, false] {
            for approve in [true, false] {
                let wire = expected_mcp(server, start, approve);
                let c = serde_json::from_value::<McpConfig>(wire.clone()).unwrap();
                let once = serde_json::to_value(&c).unwrap();
                let back = serde_json::from_value::<McpConfig>(once.clone()).unwrap();
                let twice = serde_json::to_value(&back).unwrap();
                if once != wire || twice != wire {
                    failures.push(format!("{wire}: once={once}, twice={twice}"));
                }
                let mut keys: Vec<&String> = once.as_object().unwrap().keys().collect();
                keys.sort();
                if keys != ["autoApproveEdits", "serverEnabled", "startOnLaunch"] {
                    failures.push(format!("{wire}: key set {keys:?}"));
                }
            }
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

/// M2-03 — a whole document with no `mcp` group yields the new default group.
#[test]
fn m2_03_a_document_without_an_mcp_group_yields_server_enabled_true() {
    let mut doc = serde_json::to_value(UserPreferences::default()).unwrap();
    doc.as_object_mut().unwrap().remove("mcp");
    let parsed = serde_json::from_value::<UserPreferences>(doc);
    assert!(parsed.is_ok(), "{:?}", parsed.as_ref().err());
    assert_eq!(
        serde_json::to_value(&parsed.unwrap().mcp).unwrap(),
        expected_mcp(true, false, false)
    );
}

/// M2-04 — the fresh-install default is on (ADR-0039 decision 4), and the
/// serialised default carries no `enabled`.
#[test]
fn m2_04_rust_default_is_on_and_carries_no_enabled() {
    let d = serde_json::to_value(UserPreferences::default()).unwrap();
    assert_eq!(d["mcp"], expected_mcp(true, false, false));
}

/// M2-05 — Rust half of default-value parity: `McpConfig::default()` equals
/// the contract fixture's `$defaultMcpConfig`. The TS half (M2-06) reads the
/// same bytes in `tests/preferences-contract-parity.test.ts`.
#[test]
fn m2_05_mcp_config_default_equals_the_fixture_default_block() {
    let fixture = read_fixture(CONTRACT_FIXTURE);
    let block = fixture.get("$defaultMcpConfig");
    assert!(
        block.is_some(),
        "the contract fixture must declare $defaultMcpConfig"
    );
    assert_eq!(
        serde_json::to_value(McpConfig::default()).unwrap(),
        *block.unwrap()
    );
}

/// RET-01 — the frozen shipped-v1 witness (unedited, `enabled: true`)
/// deserialises to `serverEnabled == true` and conserves the other two
/// non-default `mcp` values. It cannot kill `alias = "enabled"` on its own —
/// the fixture says `true` — which is RET-02's job.
#[test]
fn ret_01_shipped_v1_yields_server_enabled_and_conserves_the_other_mcp_fields() {
    let raw = std::fs::read_to_string(SHIPPED_V1_FIXTURE).unwrap();
    let shipped = read_fixture(SHIPPED_V1_FIXTURE);
    assert_eq!(
        shipped["mcp"]["enabled"],
        json!(true),
        "the shipped-v1 witness must still carry its original mcp.enabled: true"
    );
    assert!(raw.contains("\"enabled\": true"));

    let parsed = serde_json::from_value::<UserPreferences>(shipped);
    assert!(parsed.is_ok(), "{:?}", parsed.as_ref().err());
    assert_eq!(
        serde_json::to_value(&parsed.unwrap().mcp).unwrap(),
        expected_mcp(true, true, true)
    );
}

/// RET-02 — the upgrade-safety kill: the shape on every install's disk today,
/// a materialised `enabled: false`, still yields `serverEnabled == true`, and
/// Rust drops `enabled` on its next write. Fails for an alias, a fallback
/// read of `enabled`, or a `#[serde(default)]` false. Nothing is written.
#[test]
fn ret_02_a_legacy_enabled_false_still_yields_server_enabled_true() {
    let mut shipped = read_fixture(SHIPPED_V1_FIXTURE);
    shipped["mcp"]["enabled"] = json!(false);

    let mut minimal = serde_json::to_value(UserPreferences::default()).unwrap();
    minimal["mcp"] = json!({ "enabled": false, "startOnLaunch": false, "autoApproveEdits": false });

    for (name, doc, want) in [
        (
            "shipped-v1 with enabled:false",
            shipped,
            expected_mcp(true, true, true),
        ),
        (
            "minimal legacy group",
            minimal,
            expected_mcp(true, false, false),
        ),
    ] {
        let parsed = serde_json::from_value::<UserPreferences>(doc);
        assert!(parsed.is_ok(), "{name}: {:?}", parsed.as_ref().err());
        let written = serde_json::to_value(parsed.unwrap()).unwrap();
        assert_eq!(written["mcp"], want, "{name}");
        assert!(
            written["mcp"].get("enabled").is_none(),
            "{name}: enabled re-emitted"
        );
    }
}
