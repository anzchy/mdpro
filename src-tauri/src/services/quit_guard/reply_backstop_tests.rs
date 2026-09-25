//! ADR-0035 WI-5: the backstop answer's wire vocabulary (VC-1 … VC-3).
//!
//! Registered from `reply.rs`. Pure: nothing on disk, no guard.
//!
//! Law: `validate_backstop_counts(answer, drafted, failed)` is accepted iff
//! `answer == Drafted`, both counts are present, and each is at most
//! `MAX_BACKSTOP_COUNT` (= `MAX_DOCUMENTS_PER_WINDOW + 1` = 101). Every refusal
//! names a limit or a field, never an over-limit value that was sent.

use super::{validate_backstop_counts, validate_discard_ids, QuitAnswer, MAX_BACKSTOP_COUNT};

const ANSWERS: [QuitAnswer; 6] = [
    QuitAnswer::Clean,
    QuitAnswer::Dirty,
    QuitAnswer::Discard,
    QuitAnswer::Cancel,
    QuitAnswer::Delivered,
    QuitAnswer::Drafted,
];

const COUNTS: [Option<u32>; 6] = [None, Some(0), Some(1), Some(101), Some(102), Some(u32::MAX)];

/// The law, written independently of the implementation: the accepted pair,
/// or the fragment the refusal must contain (`None` when the law pins no text).
fn oracle(
    answer: QuitAnswer,
    drafted: Option<u32>,
    failed: Option<u32>,
) -> Result<(u32, u32), Option<&'static str>> {
    if answer != QuitAnswer::Drafted {
        if drafted.is_some() || failed.is_some() {
            return Err(Some("only with drafted"));
        }
        return Err(None);
    }
    let Some(d) = drafted else {
        return Err(Some("draftedCount"));
    };
    let Some(f) = failed else {
        return Err(Some("failedCount"));
    };
    if d > 101 || f > 101 {
        return Err(Some("101"));
    }
    Ok((d, f))
}

// ── VC-1 ──────────────────────────────────────────────────────────────────────

#[test]
fn vc1_the_acceptance_rule_over_the_whole_answer_by_count_domain() {
    assert_eq!(MAX_BACKSTOP_COUNT, 101);
    assert_eq!(
        MAX_BACKSTOP_COUNT as usize,
        crate::MAX_DOCUMENTS_PER_WINDOW + 1,
        "the cap is derived from the per-window document limit, plus one failed flush"
    );
    let mut rows = 0;
    let mut accepted = 0;
    for answer in ANSWERS {
        for drafted in COUNTS {
            for failed in COUNTS {
                rows += 1;
                let row = format!("{answer:?} drafted={drafted:?} failed={failed:?}");
                let got = validate_backstop_counts(answer, drafted, failed);
                match oracle(answer, drafted, failed) {
                    Ok(pair) => {
                        accepted += 1;
                        assert_eq!(got, Ok(pair), "{row}");
                    }
                    Err(fragment) => {
                        let err = match got {
                            Err(err) => err,
                            Ok(pair) => panic!("{row}: accepted as {pair:?}"),
                        };
                        assert!(!err.is_empty(), "{row}: a refusal must say why");
                        if let Some(fragment) = fragment {
                            assert!(err.contains(fragment), "{row}: {err:?} lacks {fragment:?}");
                        }
                        for sent in [drafted, failed].into_iter().flatten() {
                            if sent > MAX_BACKSTOP_COUNT {
                                assert!(
                                    !err.contains(&sent.to_string()),
                                    "{row}: the refusal quoted the value sent: {err:?}"
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    assert_eq!(rows, 216);
    assert_eq!(
        accepted, 9,
        "only Drafted with both counts in {{0, 1, 101}}"
    );
}

// ── VC-2 ──────────────────────────────────────────────────────────────────────

#[test]
fn vc2_document_ids_with_drafted_are_refused() {
    let refused = validate_discard_ids(QuitAnswer::Drafted, Some(vec!["x".to_string()]));
    let err = refused.expect_err("drafted carries counts, never ids");
    assert!(!err.contains('x'), "the refusal quoted the id: {err:?}");
    assert_eq!(
        validate_discard_ids(QuitAnswer::Drafted, None),
        Ok(Vec::new())
    );
}

// ── VC-3 ──────────────────────────────────────────────────────────────────────

#[test]
fn vc3_drafted_deserializes_from_its_wire_string() {
    assert_eq!(
        serde_json::from_str::<QuitAnswer>("\"drafted\"").ok(),
        Some(QuitAnswer::Drafted)
    );
    assert_eq!(
        serde_json::to_string(&QuitAnswer::Drafted).ok().as_deref(),
        Some("\"drafted\"")
    );
    for bad in ["\"Drafted\"", "\"DRAFTED\"", "\"draft\""] {
        assert!(
            serde_json::from_str::<QuitAnswer>(bad).is_err(),
            "{bad} was accepted"
        );
    }
}
