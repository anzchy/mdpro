//! Pure cases for `services::mcp_launch` (ADR-0039, WI-3).
//!
//! DC-01: `decide_mcp_launch` over its whole 6-value input domain.

use super::*;

use McpConfigReadError::{Io, LockPoisoned, Parse};
use McpLaunchDecision::{Skip, Start};

/// The six reads, in DC-01 order.
fn all_reads() -> [McpConfigRead; 6] {
    [
        Ok(Some(true)),
        Ok(Some(false)),
        Ok(None),
        Err(LockPoisoned),
        Err(Io),
        Err(Parse),
    ]
}

#[test]
fn dc01_skip_iff_explicit_false_with_the_exact_reason_per_variant() {
    let expected = [
        Start(StartReason::Enabled),
        Skip(SkipReason::Disabled),
        Start(StartReason::NoConfig),
        Start(StartReason::ConfigUnreadable(LockPoisoned)),
        Start(StartReason::ConfigUnreadable(Io)),
        Start(StartReason::ConfigUnreadable(Parse)),
    ];
    for (read, want) in all_reads().into_iter().zip(expected) {
        assert_eq!(decide_mcp_launch(read), want, "read {read:?}");
    }
    // The law, independently of the table: Skip ⟺ Ok(Some(false)).
    for read in all_reads() {
        let d = decide_mcp_launch(read);
        assert_eq!(
            matches!(d, Skip(_)),
            read == Ok(Some(false)),
            "fail-open totality broken for {read:?} → {d:?}"
        );
    }
}
