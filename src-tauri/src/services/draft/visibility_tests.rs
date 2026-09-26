//! D27 WI-2 g1: the `visible` truth table over its whole domain.
use super::*;

#[test]
fn g1_visible_truth_table_over_the_full_domain() {
    let reasons = [
        None,
        Some(InUseReason::OwnedByLiveWindow),
        Some(InUseReason::OpenInWindow),
    ];
    let mut rows = 0;
    for recovered in [false, true] {
        for has_owner in [false, true] {
            for in_use in reasons {
                let expected = match (in_use.is_some(), recovered, has_owner) {
                    (true, _, _) => false,
                    (false, false, false) => true,
                    (false, false, true) => true,
                    (false, true, true) => true,
                    (false, true, false) => false,
                };
                assert_eq!(
                    visible(recovered, has_owner, in_use),
                    expected,
                    "row recovered={recovered} has_owner={has_owner} in_use={in_use:?}"
                );
                rows += 1;
            }
        }
    }
    assert_eq!(rows, 12);
}
