//! Test-only random defect subsets for the verify-run guard (ADR-0047 WI-002,
//! matrix WI4-T16 and WI5-T07). A trial picks a non-empty set of compatible
//! defect slots, at most one option per slot, applies them to a fresh
//! `Run::valid()`, and returns the variants any of them may produce.
#![allow(dead_code)]
use super::verify_run_fixtures::{chmod, set_var, unset_var, Run, CF_HOME, HOME, NONCE};
use super::{GuardError, PathVar, Var};
use rand::rngs::StdRng;
use rand::Rng;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::PathBuf;

pub(super) struct Injection {
    pub(super) labels: Vec<&'static str>,
    pub(super) allowed: Vec<GuardError>,
    pub(super) args: (PathBuf, u32),
}

/// Options per slot, in slot order: HOME, CF, nonce env, run mode, parent
/// mode, `launch.json`, uid.
const SLOTS: [usize; 7] = [4, 2, 2, 1, 1, 4, 1];
/// Application order: tree edits and env first, chmods last (a 0755 parent
/// still allows the edits, but keeping them last makes that irrelevant).
const ORDER: [usize; 7] = [0, 1, 2, 5, 6, 3, 4];

pub(super) fn inject_random(fx: &Run, rng: &mut StdRng) -> Injection {
    let mut picks: Vec<Option<usize>> = vec![None; SLOTS.len()];
    while picks.iter().all(Option::is_none) {
        for (slot, n) in SLOTS.iter().enumerate() {
            if rng.gen_bool(0.35) {
                picks[slot] = Some(rng.gen_range(0..*n));
            }
        }
    }
    let mut inj = Injection {
        labels: Vec::new(),
        allowed: Vec::new(),
        args: fx.args(),
    };
    for slot in ORDER {
        if let Some(opt) = picks[slot] {
            apply(fx, slot, opt, &mut inj);
        }
    }
    inj
}

fn apply(fx: &Run, slot: usize, opt: usize, inj: &mut Injection) {
    use GuardError::*;
    let (label, allowed): (&'static str, Vec<GuardError>) = match (slot, opt) {
        (0, 0) => {
            unset_var(HOME);
            ("HOME unset", vec![VarUnset(Var::Home)])
        }
        (0, 1) => {
            set_var(HOME, "");
            ("HOME empty", vec![VarEmpty(Var::Home)])
        }
        (0, 2) => {
            set_var(HOME, fx.mkdir(&fx.parent.join("r-other")));
            ("HOME outside", vec![HomeOutsideRun])
        }
        (0, _) => {
            let link = fx.root.join("home-link");
            symlink(&fx.run, &link).expect("symlink HOME");
            set_var(HOME, &link);
            ("HOME symlink", vec![NotCanonical(PathVar::Home)])
        }
        (1, 0) => {
            unset_var(CF_HOME);
            ("CF unset", vec![VarUnset(Var::CfHome)])
        }
        (1, _) => {
            set_var(CF_HOME, fx.mkdir(&fx.parent.join("r-other")));
            ("CF outside", vec![CfHomeOutsideRun])
        }
        (2, 0) => {
            unset_var(NONCE);
            ("nonce unset", vec![VarUnset(Var::Nonce)])
        }
        (2, _) => {
            set_var(NONCE, format!("b{}", &fx.nonce[1..]));
            ("nonce different", vec![NonceMismatch])
        }
        (3, _) => {
            chmod(&fx.run, 0o755);
            ("run mode 0755", vec![RunDirMode])
        }
        (4, _) => {
            chmod(&fx.parent, 0o755);
            ("parent mode 0755", vec![ParentMode])
        }
        (5, 0) => {
            fs::remove_file(fx.launch()).expect("remove launch.json");
            ("launch missing", vec![LaunchJsonMissing])
        }
        (5, 1) => {
            fx.write_launch("{nonce:");
            ("launch malformed", vec![LaunchJsonMalformed])
        }
        (5, 2) => {
            let real = fx.run.join("real.json");
            fs::write(&real, format!("{{\"nonce\":\"{}\"}}", fx.nonce)).expect("write real");
            fs::remove_file(fx.launch()).expect("remove launch.json");
            symlink(&real, fx.launch()).expect("symlink launch.json");
            ("launch symlink", vec![LaunchJsonNotRegular])
        }
        (5, _) => {
            fx.write_launch(r#"{"nonce":42}"#);
            ("launch nonce 42", vec![NonceMissing])
        }
        _ => {
            inj.args.1 = fx.uid.wrapping_add(1);
            ("uid + 1", vec![RunDirNotOwner, ParentNotOwner])
        }
    };
    inj.labels.push(label);
    inj.allowed.extend(allowed);
}
