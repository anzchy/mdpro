//! D32 WI-4b K7: the measured cost of one `is_unchanged` on an unchanged
//! file (stat, capped read and hash, stat). A hand-run measurement, not a
//! pass/fail gate: `#[ignore]`d, and its table feeds ADR-0068 Consequences.
//!
//! Run, in debug and in release:
//! `cargo test --manifest-path src-tauri/Cargo.toml k7_ -- --ignored --nocapture`
//! `cargo test --manifest-path src-tauri/Cargo.toml --release k7_ -- --ignored --nocapture`
use super::fixture::{varied, TempDir};
use super::BaselineStore;
use std::time::{Duration, Instant};

const MIB: usize = 1024 * 1024;
const RUNS: usize = 5;
/// One residual burst (Metadata(Any), Extended, Content) reads up to 3 times.
const BURST_READS: u32 = 3;

fn median(mut samples: Vec<Duration>) -> Duration {
    samples.sort();
    samples[samples.len() / 2]
}

/// K7: median wall time of `is_unchanged` over `RUNS` calls at 1, 5 and 10
/// MiB (10 MiB is exactly the hash cap), printed as a table.
#[test]
#[ignore = "measurement; run by hand with --ignored --nocapture"]
fn k7_is_unchanged_cost_at_1_5_10_mib() {
    let d = TempDir::new("k7");
    let profile = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    let mut table = format!("K7 is_unchanged ({profile}, median of {RUNS})\n");
    table.push_str("| size | median ms | x3 burst ms |\n|---|---|---|\n");
    for mib in [1, 5, 10] {
        let p = d.file(&format!("m{mib}.md"), &varied(mib * MIB));
        let store = BaselineStore::default();
        store.register(&p);
        assert!(
            store.get(&p).and_then(|e| e.hash).is_some(),
            "precondition: hashed"
        );
        let samples: Vec<Duration> = (0..RUNS)
            .map(|_| {
                let start = Instant::now();
                let unchanged = store.is_unchanged(&p);
                let took = start.elapsed();
                assert!(unchanged, "precondition: {mib} MiB file is unchanged");
                took
            })
            .collect();
        let m = median(samples);
        let ms = |t: Duration| t.as_secs_f64() * 1000.0;
        table.push_str(&format!(
            "| {mib} MiB | {:.2} | {:.2} |\n",
            ms(m),
            ms(m * BURST_READS)
        ));
    }
    // A measurement's only output is its table; there is no logger in tests.
    println!("{table}");
}
