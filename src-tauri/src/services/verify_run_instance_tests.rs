//! ADR-0047 WI-002 fix / WI-1: `verify_run::publish` writes `instance.json`
//! exclusively into a verified run dir (matrix `tests-20261007-230837.md`
//! WI5-T01, T02, T03, T10, and the vanished-dir and foreign-temp cases).
//! Every fixture is `Run::logged()`: the logger is primed outside the tree,
//! and `app.verify_run` lines land in `<run>/.mdpro/mdpro.log` because
//! HOME = run. Refusal cases live in `verify_run_publish_tests.rs`, the laws
//! in `verify_run_publish_law_tests.rs`. Feature-on only.
use super::verify_run_fixtures::{fresh_nonce, Run};
use super::verify_run_publish_fixtures::{
    assert_published, entries, fingerprint, hex, instance, keys, names, target, verify_run_lines,
};
use super::{publish, GuardError, VerifiedRun, GUARD_EXIT_CODE};
use crate::services::build_info::normalize_build_id;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use std::collections::BTreeSet;
use std::fs;

#[test]
fn wi5_t01_publish_writes_instance_json() {
    let fx = Run::logged();
    let id = hex(&mut StdRng::seed_from_u64(1), 64);
    let v = fx.check().expect("check");

    let got = publish(&v, 4242, Some(&id));

    assert_eq!(got, Ok(()));
    assert_published(&fx.run.join("instance.json"), &fx.nonce, 4242, &id);
    assert_eq!(
        entries(&fx.run),
        names(&["launch.json", "instance.json", ".mdpro"])
    );
}

#[test]
fn wi5_t02_build_id_round_trips_through_publish() {
    const SEED: u64 = 20261006;
    const NONCE_CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789\"\\/ ";
    let mut rng = StdRng::seed_from_u64(SEED);
    let fx = Run::logged();
    for trial in 0..200 {
        let raw: Option<String> = match rng.gen_range(0..8) {
            0 => Some(hex(&mut rng, 64)),
            1 => Some(hex(&mut rng, 63)),
            2 => Some(hex(&mut rng, 65)),
            3 => Some(hex(&mut rng, 64).to_uppercase().replace('0', "A")),
            4 => {
                let mut s = hex(&mut rng, 64);
                let at = rng.gen_range(0..64);
                s.replace_range(at..=at, "g");
                Some(s)
            }
            5 => Some(format!("{}\n", hex(&mut rng, 64))),
            6 => Some(String::new()),
            _ => None,
        };
        let pid = rng.gen::<u32>();
        let nonce = match rng.gen_range(0..3) {
            0 => fresh_nonce(),
            1 => "a\"b\\c\n\u{e9}".to_string(),
            _ => {
                let n = rng.gen_range(1..=40);
                (0..n)
                    .map(|_| NONCE_CHARS[rng.gen_range(0..NONCE_CHARS.len())] as char)
                    .collect()
            }
        };
        let v = VerifiedRun {
            nonce: nonce.clone(),
            ..target(&fx, &format!("d{trial}"))
        };
        let ctx = format!("seed {SEED} trial {trial} raw {raw:?} nonce {nonce:?}");

        let got = publish(&v, pid, raw.as_deref());

        assert_eq!(got, Ok(()), "{ctx}");
        let doc = instance(&v.run_dir.join("instance.json"));
        assert_eq!(keys(&doc), names(&["nonce", "pid", "buildId"]), "{ctx}");
        assert_eq!(doc["buildId"], normalize_build_id(raw.as_deref()), "{ctx}");
        assert_eq!(doc["nonce"], nonce.as_str(), "{ctx}");
        assert_eq!(doc["pid"], pid, "{ctx}");
        assert_eq!(entries(&v.run_dir), names(&["instance.json"]), "{ctx}");
    }
}

/// Regression reproducer: a second publication on one run dir is refused and
/// leaves the first byte-identical. Red stage ran these calls through the
/// old `write_instance`, which replaced the file.
#[test]
fn wi5_t03_second_publish_is_refused() {
    let fx = Run::logged();
    let path = fx.run.join("instance.json");
    let v = fx.check().expect("check");

    let first = publish(&v, 111, None);
    assert_eq!(first, Ok(()));
    let b1 = fs::read(&path).expect("read 1");
    let f1 = fingerprint(&path);

    let id = hex(&mut StdRng::seed_from_u64(3), 64);
    let second = publish(&v, 222, Some(&id));

    assert!(second.is_err(), "second write was accepted: {second:?}");
    assert_eq!(second, Err(GuardError::InstanceExists));
    assert_eq!(
        fs::read(&path).expect("read 2"),
        b1,
        "first publication changed"
    );
    assert_eq!(fingerprint(&path), f1);
    assert_eq!(
        entries(&fx.run),
        names(&["launch.json", "instance.json", ".mdpro"])
    );
}

#[test]
fn wi1_publish_into_vanished_run_dir_is_instance_write() {
    let fx = Run::logged();
    let gone = fx.run.join("gone");
    let v = VerifiedRun {
        run_dir: gone.clone(),
        nonce: fx.nonce.clone(),
    };

    let got = publish(&v, 4242, None);

    assert_eq!(got, Err(GuardError::InstanceWrite));
    assert!(!gone.exists(), "publish created the run dir");
    assert_eq!(entries(&fx.run), names(&["launch.json", ".mdpro"]));
    let lines = verify_run_lines(&fx);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_eq!(lines[0]["status"], "fail");
    let ctx = lines[0]["context"].as_object().expect("context object");
    let got_keys: BTreeSet<&str> = ctx.keys().map(String::as_str).collect();
    assert_eq!(got_keys, BTreeSet::from(["runDir", "pid", "reason"]));
    assert_eq!(ctx["runDir"], "gone");
    assert_eq!(ctx["pid"], 4242);
    assert_eq!(ctx["reason"], "instance_write");
}

#[test]
fn wi1_foreign_temp_names_do_not_block_publish() {
    let fx = Run::logged();
    let a = fx.run.join(".instance.json.tmp");
    let b = fx
        .run
        .join(".instance.json.00000000000000000000000000000000.tmp");
    fs::write(&a, b"A").expect("seed a");
    fs::write(&b, b"B").expect("seed b");
    let (fa, fb) = (fingerprint(&a), fingerprint(&b));

    let got = publish(&fx.check().expect("check"), 4242, None);

    assert_eq!(got, Ok(()));
    assert_eq!(fingerprint(&a), fa);
    assert_eq!(fingerprint(&b), fb);
    assert_eq!(
        entries(&fx.run),
        names(&[
            "launch.json",
            "instance.json",
            ".mdpro",
            ".instance.json.tmp",
            ".instance.json.00000000000000000000000000000000.tmp",
        ])
    );
    assert_published(&fx.run.join("instance.json"), &fx.nonce, 4242, "unknown");
}

#[test]
fn wi5_t10_guard_exit_code_is_78() {
    assert_eq!(GUARD_EXIT_CODE, 78);
}
