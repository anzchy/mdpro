//! Purpose: the agent control channel (ADR-0047 WI-009), ported from
//! candidate B's spike (`79bde78a`). It exists only with the `control-channel`
//! feature, which implies `verify-run`, so a default build has none of it.
//!
//! Key decisions:
//! - `proto`: the request contract, with no I/O. `handoff`: the token,
//!   `control.json` and the socket, inside the verified run dir.

pub mod handoff;
pub mod proto;
