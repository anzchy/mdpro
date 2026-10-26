//! Purpose: normalise the compiled-in release id (`MDPRO_RELEASE_ID`, D175)
//! to a value that is safe to log as `releaseId` in `app.ready`.
//!
//! `.github/workflows/release.yml` sets `MDPRO_RELEASE_ID` on the release app
//! build as `<version>@<preflight 40-hex SHA>`, e.g.
//! `0.3.1@0123456789abcdef0123456789abcdef01234567`. Development app builds
//! (`build-windows.yml` and local verify bundles) set `<version>-dev@<sha>`;
//! explicit dirty local builds use `-dev.dirty@`. The sidecar receives none.
//! A build without an id, or with a malformed value, logs `unknown`.
//!
//! Key decisions:
//! - A separate id, not a new `buildId` format (D175 option B): `buildId`
//!   (`build_info.rs`, ADR-0047) stays exactly 64 lowercase hex, so a valid
//!   release id is never a valid build id and the reverse.
//! - The `option_env!("MDPRO_RELEASE_ID")` read lives in the bin crate
//!   (`src-tauri/src/main.rs`), beside the build id's, for the same reason:
//!   a changing id recompiles only the `tauri-app` bin, never the lib or
//!   `mdpro_mcp`. This module only receives the raw value.
//! - Valid is `<semver>@<sha>`, split at the one `@`. `<semver>` is
//!   `MAJOR.MINOR.PATCH`, each ASCII digits without a leading zero (a lone
//!   `0` is fine), optionally `-<prerelease>` of one or more `[0-9A-Za-z.-]`;
//!   no `+build` metadata. `<sha>` is exactly 40 lowercase hex chars. The
//!   value is returned byte-for-byte; nothing is trimmed or case-folded.

/// The id reported when `MDPRO_RELEASE_ID` is missing or malformed.
const UNKNOWN_RELEASE_ID: &str = "unknown";

/// Length of the commit part, in bytes (a full git SHA-1 in hex).
const SHA_LEN: usize = 40;

/// Return `raw` when it is `<semver>@<40 lowercase hex>`, otherwise
/// `"unknown"`.
pub fn normalize_release_id(raw: Option<&str>) -> &str {
    match raw {
        Some(id) if is_valid_release_id(id) => id,
        _ => UNKNOWN_RELEASE_ID,
    }
}

/// `true` when `id` is exactly one `<semver>@<sha>`.
fn is_valid_release_id(id: &str) -> bool {
    match id.split_once('@') {
        Some((version, sha)) => is_semver(version) && is_full_sha(sha),
        None => false,
    }
}

/// `true` when `sha` is exactly 40 bytes, each in `[0-9a-f]`.
fn is_full_sha(sha: &str) -> bool {
    sha.len() == SHA_LEN && sha.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// `MAJOR.MINOR.PATCH[-prerelease]`, see the module docs.
fn is_semver(version: &str) -> bool {
    let (core, pre) = match version.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (version, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|p| is_numeric_part(p))
        && pre.is_none_or(|p| {
            !p.is_empty()
                && p.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        })
}

/// Non-empty ASCII digits with no leading zero, except `0` itself.
fn is_numeric_part(part: &str) -> bool {
    !part.is_empty()
        && part.bytes().all(|b| b.is_ascii_digit())
        && (part == "0" || !part.starts_with('0'))
}

#[cfg(test)]
#[path = "release_info_tests.rs"]
mod release_info_tests;
