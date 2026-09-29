//! Specification for `decide` (ADR-0042 decision 2). Law: total over
//! `Option<&str>²`; `ApplyNow` iff `owner.is_some() && owner == focused`,
//! `NoOwner` iff `owner.is_none()`, otherwise `Prompt { window: owner }`.

use super::*;

fn prompt(w: &str) -> Gate {
    Gate::Prompt {
        window: w.to_string(),
    }
}

/// G-1: the literal 9-row table over {None, "A", "B"}², plus the law
/// checked independently of the table.
#[test]
fn g1_exhaustive_rule_over_three_by_three() {
    let table: [(Option<&str>, Option<&str>, Gate); 9] = [
        (None, None, Gate::NoOwner),
        (None, Some("A"), Gate::NoOwner),
        (None, Some("B"), Gate::NoOwner),
        (Some("A"), None, prompt("A")),
        (Some("A"), Some("A"), Gate::ApplyNow),
        (Some("A"), Some("B"), prompt("A")),
        (Some("B"), None, prompt("B")),
        (Some("B"), Some("A"), prompt("B")),
        (Some("B"), Some("B"), Gate::ApplyNow),
    ];
    let mut checked = 0;
    for (o, f, expected) in table.iter() {
        let g = decide(*o, *f);
        assert_eq!(&g, expected, "{o:?},{f:?}");
        assert_eq!(
            matches!(g, Gate::ApplyNow),
            o.is_some() && o == f,
            "ApplyNow-iff law at {o:?},{f:?}"
        );
        assert_eq!(
            matches!(g, Gate::NoOwner),
            o.is_none(),
            "NoOwner-iff law at {o:?},{f:?}"
        );
        if let Gate::Prompt { window } = &g {
            assert_eq!(Some(window.as_str()), *o, "prompt goes to the owner");
        }
        checked += 1;
    }
    assert_eq!(checked, 9, "the table must cover all 9 pairs");
}

/// G-2: regression for ADR-0042 defect 2 — a document in B while A is
/// focused must prompt B, not apply.
#[test]
fn g2_regression_doc_in_b_while_a_focused_prompts_b() {
    assert_eq!(decide(Some("B"), Some("A")), prompt("B"));
}

/// G-3: labels compare by exact equality — no case folding, trimming or
/// prefix matching.
#[test]
fn g3_labels_compare_exactly() {
    assert_eq!(decide(Some("main"), Some("Main")), prompt("main"));
    assert_eq!(decide(Some("main"), Some("main ")), prompt("main"));
    assert_eq!(decide(Some("main-2"), Some("main")), prompt("main-2"));
    assert_eq!(decide(Some(""), Some("")), Gate::ApplyNow);
}

/// Boundary (plan): nothing focused, owner A → Prompt A.
#[test]
fn nothing_focused_prompts_owner() {
    assert_eq!(decide(Some("A"), None), prompt("A"));
}
