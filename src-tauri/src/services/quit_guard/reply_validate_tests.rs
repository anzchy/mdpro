//! D16F WI-3 (audit rows 4, 19): `validate_discard_ids` refuses with fixed,
//! id-free reasons, and caps each id at `MAX_DISCARD_ID_BYTES` bytes.
//!
//! Law:
//! - (a) no error message contains a submitted id;
//! - (b) `Ok(ids)` iff the answer is `Discard`, `len <= MAX_DISCARD_IDS`, and
//!   every id is shape-valid and at most `MAX_DISCARD_ID_BYTES` bytes — and on
//!   `Ok` the output is the input, unchanged.
//!
//! The refusal text ends up in `app.quit.answer` and in the rethrown frontend
//! error, so an id in it is an id in the log.

use super::{validate_discard_ids, QuitAnswer, MAX_DISCARD_IDS, MAX_DISCARD_ID_BYTES};

fn owned(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

fn invalid_at(i: usize) -> String {
    format!("invalid document id at index {i}")
}

fn exceeds() -> String {
    format!("document id exceeds {MAX_DISCARD_ID_BYTES} bytes")
}

fn discard(ids: Vec<String>) -> Result<Vec<String>, String> {
    validate_discard_ids(QuitAnswer::Discard, Some(ids))
}

// ── Bare hostile corpus: exact fixed message ─────────────────────────────────

#[test]
fn wi3_hostile_ids_are_refused_with_the_exact_fixed_message() {
    // Short ids make a "does not contain" check vacuous (`""` is in every
    // string), so the message is pinned by equality instead.
    for bad in ["", "a/b", "a\\b", "..", "../x", "..\\x", "x/../../y"] {
        assert_eq!(discard(owned(&[bad])), Err(invalid_at(0)), "bare {bad:?}");
        assert_eq!(
            discard(owned(&["ok1", bad])),
            Err(invalid_at(1)),
            "{bad:?} after a valid id"
        );
    }
}

// ── Per-id byte cap ──────────────────────────────────────────────────────────

#[test]
fn wi3_per_id_cap_is_counted_in_bytes_at_the_boundary() {
    let cases: [(String, Result<(), ()>); 5] = [
        ("a".repeat(MAX_DISCARD_ID_BYTES), Ok(())),
        ("a".repeat(MAX_DISCARD_ID_BYTES + 1), Err(())),
        ("é".repeat(MAX_DISCARD_ID_BYTES / 2), Ok(())),
        ("é".repeat(MAX_DISCARD_ID_BYTES / 2 + 1), Err(())),
        ("é".repeat(MAX_DISCARD_ID_BYTES), Err(())),
    ];
    assert_eq!(
        MAX_DISCARD_ID_BYTES % 2,
        0,
        "the é cases assume an even cap"
    );
    for (id, expected) in cases {
        let got = discard(vec![id.clone()]);
        match expected {
            Ok(()) => assert_eq!(
                got,
                Ok(vec![id.clone()]),
                "an id of {} bytes must be accepted",
                id.len()
            ),
            Err(()) => assert_eq!(
                got,
                Err(exceeds()),
                "an id of {} bytes must be refused",
                id.len()
            ),
        }
    }
}

#[test]
fn wi3_real_frontend_id_formats_fit_under_the_cap() {
    // `useDocument.ts` mints `doc-${Date.now()}-${hex}`; Rust mints UUIDs.
    let real = owned(&[
        "doc-1737000000000-9f3a2b1c4d5e6",
        "123e4567-e89b-12d3-a456-426614174000",
    ]);
    assert!(MAX_DISCARD_ID_BYTES >= 36, "the cap refuses a UUID");
    assert_eq!(discard(real.clone()), Ok(real));
}

// ── Property: acceptance partition and no id leak ────────────────────────────

const SEED: u64 = 0xD16_0003;
const CASES: usize = 2_000;
const MARK: &str = "zq7-";

struct SplitMix64(u64);
impl SplitMix64 {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Valid,
    Hostile,
    Oversized,
}

fn make_id(rng: &mut SplitMix64, kind: Kind) -> String {
    let tag = format!("{:x}", rng.next());
    match kind {
        Kind::Valid => {
            let id = format!("{MARK}{tag}");
            // Sometimes pad to exactly the cap: the boundary is valid.
            if rng.below(4) == 0 {
                format!("{id:a<width$}", width = MAX_DISCARD_ID_BYTES)
            } else {
                id
            }
        }
        Kind::Hostile => match rng.below(4) {
            0 => format!("{MARK}../{tag}"),
            1 => format!("{MARK}a/{tag}"),
            2 => format!("{MARK}a\\{tag}"),
            _ => format!("{MARK}{tag}.."),
        },
        Kind::Oversized => {
            let extra = 1 + rng.below(40) as usize;
            format!("{MARK}{tag:a<width$}", width = MAX_DISCARD_ID_BYTES + extra)
        }
    }
}

/// The oracle: what the validator must answer for this list, written from the
/// law rather than from the implementation.
fn oracle(ids: &[String], kinds: &[Kind]) -> Result<Vec<String>, String> {
    if ids.len() > MAX_DISCARD_IDS {
        return Err(format!(
            "too many documentIds: {} (the limit is {MAX_DISCARD_IDS})",
            ids.len()
        ));
    }
    match kinds.iter().position(|k| *k != Kind::Valid) {
        None => Ok(ids.to_vec()),
        Some(i) if kinds[i] == Kind::Hostile => Err(invalid_at(i)),
        Some(_) => Err(exceeds()),
    }
}

#[test]
fn wi3_property_acceptance_partition_and_no_id_leak() {
    let mut rng = SplitMix64(SEED);
    let (mut oks, mut errs) = (0usize, 0usize);
    for case in 0..CASES {
        let len = rng.below(MAX_DISCARD_IDS as u64 + 3) as usize;
        let mut kinds = vec![Kind::Valid; len];
        // Half the lists stay all-valid, so both sides of the partition are hit.
        if len > 0 && rng.below(2) == 0 {
            for _ in 0..=rng.below(2) {
                let at = rng.below(len as u64) as usize;
                kinds[at] = if rng.below(2) == 0 {
                    Kind::Hostile
                } else {
                    Kind::Oversized
                };
            }
        }
        let ids: Vec<String> = kinds.iter().map(|k| make_id(&mut rng, *k)).collect();
        let got = discard(ids.clone());
        let want = oracle(&ids, &kinds);
        assert_eq!(got, want, "seed {SEED:#x} case {case}: ids {ids:?}");
        match got {
            Ok(_) => oks += 1,
            Err(message) => {
                errs += 1;
                assert!(
                    !message.contains(MARK),
                    "seed {SEED:#x} case {case}: an id leaked into {message:?}"
                );
            }
        }
    }
    assert!(
        oks > CASES / 10 && errs > CASES / 10,
        "vacuous: {oks} ok, {errs} err"
    );
}
