//! WI-1 (plan-20260925-232104): `fallback_alert_text` over the whole
//! `FallbackCause` domain. The expected literals are typed in here, never read
//! from the constants they pin.

use super::super::FallbackCause;
use super::{fallback_alert_text, AlertText};

/// Every cause, built through an exhaustive `match` so a new variant fails to
/// compile until it is added here.
fn all_causes() -> Vec<FallbackCause> {
    let first = FallbackCause::Timeout;
    match first {
        FallbackCause::Timeout | FallbackCause::Escape => {}
    }
    vec![FallbackCause::Timeout, FallbackCause::Escape]
}

/// Every ordered pair of distinct causes.
fn distinct_pairs() -> Vec<(FallbackCause, FallbackCause)> {
    let causes = all_causes();
    let mut pairs = Vec::new();
    for &a in &causes {
        for &b in &causes {
            if a != b {
                pairs.push((a, b));
            }
        }
    }
    pairs
}

const OVERCLAIM_NEEDLES: [&str; 7] = [
    "responding",
    "in time",
    "time out",
    "timed out",
    "timeout",
    "didn’t answer",
    "didn't answer",
];

fn overclaim(s: &str) -> Option<&'static str> {
    let lower = s.to_lowercase();
    OVERCLAIM_NEEDLES
        .iter()
        .copied()
        .find(|needle| lower.contains(needle))
}

#[test]
fn at1_timeout_text_is_byte_identical_to_the_macos_wording() {
    assert_eq!(
        fallback_alert_text(FallbackCause::Timeout),
        AlertText {
            title: "mdpro isn’t responding to the quit request",
            body: "One or more editor windows didn’t answer in time, so mdpro can’t check them for unsaved changes.\n\nQuitting now will discard unsaved changes in every window. Drafts are kept, so you may be able to recover them the next time you open mdpro.",
        }
    );
}

#[test]
fn at2_escape_text_is_the_proposed_wording() {
    assert_eq!(
        fallback_alert_text(FallbackCause::Escape),
        AlertText {
            title: "Stop waiting and quit mdpro?",
            body: "mdpro hasn’t finished checking every editor window for unsaved changes, so it can’t tell which ones have them.\n\nQuitting now will discard unsaved changes in every window. Drafts are kept, so you may be able to recover them the next time you open mdpro.",
        }
    );
}

#[test]
fn at3_escape_wording_does_not_overclaim_and_the_predicate_can_fire() {
    let e = fallback_alert_text(FallbackCause::Escape);
    assert_eq!(overclaim(e.title), None, "escape title overclaims");
    assert_eq!(overclaim(e.body), None, "escape body overclaims");

    let t = fallback_alert_text(FallbackCause::Timeout);
    assert!(
        overclaim(t.title).is_some(),
        "positive control: no needle fires on the timeout title {:?}",
        t.title
    );
    assert!(
        overclaim(t.body).is_some(),
        "positive control: no needle fires on the timeout body {:?}",
        t.body
    );
}

#[test]
fn at4_every_cause_states_the_loss_and_the_drafts() {
    for cause in all_causes() {
        let t = fallback_alert_text(cause);
        assert!(!t.title.is_empty(), "{cause:?}: empty title");
        assert!(
            t.body.contains("discard unsaved changes in every window"),
            "{cause:?}: body does not state the loss: {:?}",
            t.body
        );
        assert!(
            t.body.contains("Drafts are kept"),
            "{cause:?}: body does not say drafts are kept: {:?}",
            t.body
        );
    }
}

#[test]
fn at5_distinct_causes_differ_in_title_and_in_body() {
    let pairs = distinct_pairs();
    assert!(!pairs.is_empty(), "the domain has fewer than two causes");
    for (c1, c2) in pairs {
        let (a, b) = (fallback_alert_text(c1), fallback_alert_text(c2));
        assert_ne!(a.title, b.title, "{c1:?} and {c2:?} share a title");
        assert_ne!(a.body, b.body, "{c1:?} and {c2:?} share a body");
    }
}

#[test]
fn at6_title_is_one_line_body_is_two_paragraphs_apostrophes_are_typographic() {
    for cause in all_causes() {
        let t = fallback_alert_text(cause);
        assert!(!t.title.contains('\n'), "{cause:?}: title spans lines");
        assert_eq!(
            t.body.split("\n\n").filter(|p| !p.is_empty()).count(),
            2,
            "{cause:?}: body is not two paragraphs: {:?}",
            t.body
        );
        assert!(
            t.title.chars().count() < t.body.chars().count(),
            "{cause:?}: title is not shorter than body"
        );
        assert!(
            !t.title.contains('\''),
            "{cause:?}: ASCII apostrophe in title"
        );
        assert!(
            !t.body.contains('\''),
            "{cause:?}: ASCII apostrophe in body"
        );
    }
}

#[test]
fn at7_the_loss_paragraph_is_identical_across_causes() {
    let pairs = distinct_pairs();
    assert!(!pairs.is_empty(), "the domain has fewer than two causes");
    for (c1, c2) in pairs {
        let (a, b) = (fallback_alert_text(c1), fallback_alert_text(c2));
        let (a1, a2) = a
            .body
            .split_once("\n\n")
            .unwrap_or_else(|| panic!("{c1:?}: body has no paragraph break"));
        let (b1, b2) = b
            .body
            .split_once("\n\n")
            .unwrap_or_else(|| panic!("{c2:?}: body has no paragraph break"));
        assert_eq!(a2, b2, "{c1:?} and {c2:?} state the loss differently");
        assert_ne!(a1, b1, "{c1:?} and {c2:?} share a first paragraph");
    }
}
