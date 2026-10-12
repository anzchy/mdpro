//! ADR-0047 WI-002 fix / WI-1: the laws of `instance.json` publication
//! (matrix `tests-20261007-230837.md`): an existing entry of any kind is
//! refused and never modified or followed, at most one of N concurrent
//! publications wins, and a reader never sees a partial file (WI5-T16, moved
//! here from `verify_run_exec_tests.rs`). Each trial publishes into its own
//! fresh subdir of one `Run::logged()`, which holds `HOME_LOCK`; the threads
//! never touch the environment. Feature-on only.
use super::verify_run_fixtures::Run;
use super::verify_run_publish_fixtures::{
    entries, fingerprint, hex, instance, keys, names, seed_entry, target,
};
use super::{publish, GuardError};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use serde_json::Value;
use std::fs;
use std::io::{ErrorKind, Read};
use std::os::unix::fs::MetadataExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Barrier};

#[test]
fn wi1_publish_refuses_any_existing_entry() {
    const SEED: u64 = 20261009;
    let mut rng = StdRng::seed_from_u64(SEED);
    let fx = Run::logged();
    for trial in 0..200 {
        let v = target(&fx, &format!("p{trial}"));
        let pid_b: u32 = rng.gen();
        let raw = rng.gen::<bool>().then(|| hex(&mut rng, 64));
        let seed = seed_entry(&mut rng, &fx, &v, pid_b);
        let ctx = format!("seed {SEED} trial {trial} kind {}", seed.kind);
        let before: Vec<_> = seed.watched.iter().map(|p| fingerprint(p)).collect();
        let names_before = entries(&v.run_dir);

        let got = publish(&v, pid_b, raw.as_deref());

        assert_eq!(got, Err(GuardError::InstanceExists), "{ctx}");
        let after: Vec<_> = seed.watched.iter().map(|p| fingerprint(p)).collect();
        assert_eq!(after, before, "{ctx}: entry or target changed");
        if let Some(gone) = &seed.absent {
            assert!(
                fs::symlink_metadata(gone).is_err(),
                "{ctx}: dangling target created"
            );
        }
        assert_eq!(entries(&v.run_dir), names_before, "{ctx}: temp left");
    }
}

#[test]
fn wi1_concurrent_publish_has_exactly_one_winner() {
    const THREADS: u32 = 8;
    let fx = Run::logged();
    for trial in 0..40u32 {
        let v = Arc::new(target(&fx, &format!("c{trial}")));
        let gate = Arc::new(Barrier::new(THREADS as usize));
        let handles: Vec<_> = (0..THREADS)
            .map(|k| {
                let (v, gate) = (Arc::clone(&v), Arc::clone(&gate));
                let pid = 10_000 + trial * THREADS + k;
                std::thread::spawn(move || {
                    gate.wait();
                    (pid, publish(&v, pid, None))
                })
            })
            .collect();
        let results: Vec<(u32, Result<(), GuardError>)> = handles
            .into_iter()
            .map(|h| h.join().expect("publisher thread"))
            .collect();

        let winners: Vec<u32> = results
            .iter()
            .filter(|(_, r)| r.is_ok())
            .map(|(p, _)| *p)
            .collect();
        assert_eq!(winners.len(), 1, "trial {trial}: {results:?}");
        for (pid, r) in &results {
            if *pid != winners[0] {
                assert_eq!(r, &Err(GuardError::InstanceExists), "trial {trial}");
            }
        }
        let path = v.run_dir.join("instance.json");
        let doc = instance(&path);
        assert_eq!(doc["pid"], winners[0], "trial {trial}");
        assert_eq!(keys(&doc), names(&["nonce", "pid", "buildId"]));
        assert_eq!(fs::metadata(&path).expect("instance").nlink(), 1);
        assert_eq!(
            entries(&v.run_dir),
            names(&["instance.json"]),
            "trial {trial}"
        );
    }
}

#[derive(Debug)]
enum Read1 {
    NotFound,
    Ok(Value),
    Bad(String),
}

fn read1(path: &std::path::Path) -> Read1 {
    match fs::File::open(path) {
        Err(e) if e.kind() == ErrorKind::NotFound => Read1::NotFound,
        Err(e) => Read1::Bad(format!("open: {e}")),
        Ok(mut f) => {
            let mut s = String::new();
            match f.read_to_string(&mut s) {
                Err(e) => Read1::Bad(format!("read: {e}")),
                Ok(_) => match serde_json::from_str::<Value>(&s) {
                    Ok(v) => Read1::Ok(v),
                    Err(_) => Read1::Bad(format!("parse: {s:?}")),
                },
            }
        }
    }
}

#[test]
fn wi5_t16_instance_json_is_never_partial() {
    const TRIALS: u32 = 300;
    let fx = Run::logged();
    for i in 0..TRIALS {
        let v = target(&fx, &format!("v{i}"));
        let path = v.run_dir.join("instance.json");
        let stop = Arc::new(AtomicBool::new(false));
        let reader = {
            let (stop, path) = (Arc::clone(&stop), path.clone());
            std::thread::spawn(move || {
                let mut seen = Vec::new();
                while !stop.load(Ordering::Acquire) {
                    seen.push(read1(&path));
                }
                seen.push(read1(&path));
                seen
            })
        };

        let got = publish(&v, 20_000 + i, None);
        stop.store(true, Ordering::Release);
        let seen = reader.join().expect("reader thread");

        assert_eq!(got, Ok(()), "trial {i}");
        let first_ok = seen.iter().position(|r| matches!(r, Read1::Ok(_)));
        let first_ok = first_ok.unwrap_or_else(|| panic!("trial {i}: never saw the file"));
        for (k, r) in seen.iter().enumerate() {
            match r {
                Read1::NotFound if k < first_ok => {}
                Read1::Ok(doc) => {
                    assert_eq!(keys(doc), names(&["nonce", "pid", "buildId"]), "trial {i}");
                    assert_eq!(doc["nonce"], fx.nonce.as_str(), "trial {i} read {k}");
                    assert_eq!(doc["pid"], 20_000 + i, "trial {i} read {k}");
                }
                Read1::NotFound => panic!("trial {i} read {k}: NotFound after a success"),
                Read1::Bad(why) => panic!("trial {i} read {k}: {why}"),
            }
        }
        assert_eq!(entries(&v.run_dir), names(&["instance.json"]), "trial {i}");
    }
}
