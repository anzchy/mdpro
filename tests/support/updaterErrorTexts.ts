/**
 * Updater rejection texts for malformed release metadata (D85). None of them
 * may classify as "updates disabled": a server that answered with a broken
 * latest.json is a failure, never "no endpoint configured".
 *
 * Sources (tauri-plugin-updater 2.9.0):
 * - url / signature / pub_date: `RemoteRelease` Deserialize, updater.rs:1292-1310
 *   — pinned in Rust by src-tauri/tests/updater_error_wire.rs (K2).
 * - missing version: serde's `missing field` text for `InnerRemoteRelease`,
 *   pinned by K2.
 * - platform not found: `Error::TargetNotFound` Display, error.rs:43.
 * - decode error: reqwest's body-decode Display (`Error::Reqwest`, transparent).
 *   From reqwest 0.12 by reading, not pinned by K2.
 */
export const MALFORMED_METADATA_TEXTS = [
  "error decoding response body",
  "the `url` field was not set on the updater response",
  "the `signature` field was not set on the updater response",
  "missing field `version`",
  "invalid value for `pub_date`: the 'year' component could not be parsed",
  "the platform `darwin-aarch64` was not found on the response `platforms` object",
] as const;
