//! ADR-0047 WI-009 WI 2: the request contract (plan WI-009 items 3, 6, 21).
use super::*;

fn req(token: &str, id: &str, cmd: &str) -> Request {
    parse(&json!({ "token": token, "id": id, "cmd": cmd }).to_string()).expect("a request")
}

#[test]
fn token_matches_only_the_same_non_empty_token() {
    assert!(token_matches("ab12", "ab12"));
    assert!(!token_matches("ab12", "ab13"));
    assert!(!token_matches("ab12", "ab1"));
    assert!(!token_matches("", ""));
}

#[test]
fn a_token_from_another_launch_is_refused() {
    let ids = IdCache::default();
    let f = admit(&req("old-launch", "a1", "ping"), "this-launch", &ids).unwrap_err();
    assert_eq!(f.code, "unauthorized");
}

#[test]
fn the_token_is_checked_before_the_id() {
    let ids = IdCache::default();
    let f = admit(&req("wrong", "", "key"), "right", &ids).unwrap_err();
    assert_eq!(f.code, "unauthorized");
}

#[test]
fn ids_must_be_1_to_64_safe_chars() {
    let ids = IdCache::default();
    for bad in ["", "a b", "a/b", &"x".repeat(65)] {
        let f = admit(&req("t", bad, "ping"), "t", &ids).unwrap_err();
        assert_eq!(f.code, "bad_request", "id {bad:?}");
    }
    assert!(admit(&req("t", &"x".repeat(64), "ping"), "t", &ids).is_ok());
    assert!(admit(&req("t", "A-z_0.9", "ping"), "t", &ids).is_ok());
}

#[test]
fn a_mutating_id_runs_once_and_a_read_may_repeat() {
    let ids = IdCache::default();
    assert!(admit(&req("t", "k1", "key"), "t", &ids).is_ok());
    assert_eq!(
        admit(&req("t", "k1", "key"), "t", &ids).unwrap_err().code,
        "duplicate"
    );
    assert_eq!(
        admit(&req("t", "k1", "click"), "t", &ids).unwrap_err().code,
        "duplicate"
    );
    assert!(admit(&req("t", "r1", "probe"), "t", &ids).is_ok());
    assert!(admit(&req("t", "r1", "probe"), "t", &ids).is_ok());
}

#[test]
fn every_input_command_is_mutating() {
    for cmd in ["key", "type", "click", "activate", "eval"] {
        assert!(is_mutating(cmd), "{cmd}");
    }
    for cmd in ["ping", "windows", "find", "count", "probe"] {
        assert!(!is_mutating(cmd), "{cmd}");
    }
}

/// Item 21: the spike forgot ids after 1,024, so the oldest could run twice.
#[test]
fn the_first_id_stays_claimed_past_the_spikes_capacity() {
    let ids = IdCache::default();
    assert!(ids.claim("first"));
    for n in 0..5_000 {
        assert!(ids.claim(&format!("id{n}")));
    }
    assert!(!ids.claim("first"));
}

#[test]
fn a_line_that_is_not_a_request_object_is_a_bad_request() {
    assert_eq!(parse("not json").unwrap_err().code, "bad_request");
    assert_eq!(parse("[1,2]").unwrap_err().code, "bad_request");
}

#[test]
fn the_timeout_defaults_and_is_clamped() {
    let at = |args: Value| {
        parse(&json!({ "token": "t", "id": "a", "cmd": "find", "args": args }).to_string())
            .expect("a request")
            .timeout_ms()
    };
    assert_eq!(at(json!({})), DEFAULT_TIMEOUT_MS);
    assert_eq!(at(json!({ "timeoutMs": 250 })), 250);
    assert_eq!(at(json!({ "timeoutMs": 999_999 })), MAX_TIMEOUT_MS);
}

#[test]
fn a_timeout_reply_says_the_outcome_is_unknown() {
    let v = reply_err("a1", &Failure::timeout());
    assert_eq!(v["ok"], json!(false));
    assert_eq!(v["error"]["code"], json!("timeout"));
    assert_eq!(v["outcome"], json!("unknown"));
    let plain = reply_err("a1", &Failure::new("bad_request", "x"));
    assert!(plain.get("outcome").is_none());
    assert_eq!(
        reply_ok("a1", json!(1)),
        json!({ "id": "a1", "ok": true, "value": 1 })
    );
}
