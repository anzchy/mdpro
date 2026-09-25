//! BS-8 of the ADR-0035 backstop specification: tally conservation over an
//! enumerated domain of N in 1..=3 windows, each drafting, silent or gone.
//! The oracle is written from the law in `coordinator_backstop_tests.rs`, not
//! from the implementation.
//!
//! Registered from `coordinator_backstop_tests.rs`.

use super::*;

// --- BS-8: tally conservation over an enumerated domain ----------------------

#[derive(Clone, Copy, Debug)]
enum Act {
    Drafted(u32, u32),
    Silent,
    Gone,
}

fn acts() -> Vec<Act> {
    let mut out: Vec<Act> = (0..=2)
        .flat_map(|d| (0..=2).map(move |f| Act::Drafted(d, f)))
        .collect();
    out.extend([Act::Silent, Act::Gone]);
    out
}

/// N windows; w0 discards `["k0"]` in phase 2, every window re-checks clean.
fn backstop_over(n: usize) -> (QuitCoordinator, u64, Vec<String>, u64) {
    let labels: Vec<String> = (0..n).map(|i| format!("w{i}")).collect();
    let refs: Vec<&str> = labels.iter().map(String::as_str).collect();
    let mut c = QuitCoordinator::new();
    let r = begin_later(&mut c, &refs, 0);
    for (t, label) in (1u64..).zip(&labels) {
        let answer = if t == 1 { Answer::Dirty } else { Answer::Clean };
        c.on_answer(r, label, answer, t);
    }
    c.on_answer(r, "w0", Answer::Delivered, 10);
    assert!(matches!(
        c.on_answer(r, "w0", discard(&["k0"]), 11),
        Step::Recheck { .. }
    ));
    let mut step = Step::Wait;
    for (t, label) in (20u64..).zip(&labels) {
        step = c.on_answer(r, label, Answer::Clean, t);
    }
    let deadline = 19 + n as u64 + QUIT_BACKSTOP_TIMEOUT_MS;
    assert_eq!(step, backstop(deadline, n), "n={n}");
    (c, r, labels, deadline)
}

fn check_row(n: usize, row: &[Act]) {
    let ctx = format!("n={n} row={row:?}");
    let (mut c, r, labels, deadline) = backstop_over(n);
    let mut steps = Vec::new();
    for (i, act) in row.iter().enumerate() {
        match act {
            Act::Drafted(d, f) => steps.push(c.on_answer(r, &labels[i], drafted(*d, *f), 100)),
            Act::Gone => steps.push(c.on_window_gone(&labels[i], 100)),
            Act::Silent => {}
        }
    }
    if c.request.is_some() {
        steps.push(c.on_tick(deadline));
    }
    let (last, earlier) = steps.split_last().expect("every row feeds an input");
    assert!(earlier.iter().all(|s| *s == Step::Wait), "{ctx}: {steps:?}");
    // The oracle, from the law: sums over Drafted, missing = the silent ones.
    let sum = |pick: fn(u32, u32) -> u32| -> u32 {
        row.iter()
            .map(|a| match a {
                Act::Drafted(d, f) => pick(*d, *f),
                _ => 0,
            })
            .sum()
    };
    let silent = row.iter().filter(|a| matches!(a, Act::Silent)).count() as u32;
    let expected = tally(sum(|d, _| d), sum(|_, f| f), silent, 0);
    assert_eq!(*last, committed(&["k0"], expected), "{ctx}");
    assert!(c.request.is_none(), "{ctx}: the commit drops the request");
}

#[test]
fn bs8_tally_conservation_over_every_backstop_row() {
    let mut rows = 0usize;
    for n in 1..=3usize {
        let mut domain: Vec<Vec<Act>> = vec![vec![]];
        for _ in 0..n {
            domain = domain
                .into_iter()
                .flat_map(|prefix| {
                    acts().into_iter().map(move |a| {
                        let mut row = prefix.clone();
                        row.push(a);
                        row
                    })
                })
                .collect();
        }
        for row in domain {
            check_row(n, &row);
            rows += 1;
        }
    }
    assert_eq!(rows, 11 + 121 + 1331, "the enumerated domain changed size");
}
