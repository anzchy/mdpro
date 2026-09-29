//! The MCP write approval rule (ADR-0042 decision 2), as a pure function.

/// What an MCP write must do before it applies.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Gate {
    /// The owning window is focused: apply without a prompt.
    ApplyNow,
    /// Ask the owning window (never the focused one) to confirm.
    Prompt { window: String },
    /// No window holds the document.
    NoOwner,
}

/// Decide the gate for a write from the document's owning window and the
/// focused window. Labels compare exactly.
pub fn decide(owner: Option<&str>, focused: Option<&str>) -> Gate {
    match owner {
        None => Gate::NoOwner,
        Some(o) if focused == Some(o) => Gate::ApplyNow,
        Some(o) => Gate::Prompt {
            window: o.to_string(),
        },
    }
}

#[cfg(test)]
#[path = "gate_tests.rs"]
mod tests;
