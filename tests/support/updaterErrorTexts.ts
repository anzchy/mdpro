/**
 * Updater rejection texts shared by the TS tests and pinned in Rust by
 * src-tauri/tests/updater_error_wire.rs.
 *
 * MALFORMED_METADATA_TEXTS (D85): none of them may classify as "updates
 * disabled": a server that answered with a broken latest.json is a failure,
 * never "no endpoint configured". Sources (tauri-plugin-updater 2.13.1):
 * - url / signature / pub_date: `RemoteRelease` Deserialize — pinned by K2.
 * - missing version: serde's `missing field` text for `InnerRemoteRelease`,
 *   pinned by K2.
 * - platform not found: `Error::TargetNotFound` Display — pinned by K3. Its
 *   2.9.0 wording ("on the response") changed to "in the response" in 2.13.1.
 * - decode error: reqwest's body-decode Display (`Error::Reqwest`, transparent).
 *   From reqwest 0.12 by reading, not pinned.
 *
 * PLATFORM_NOT_IN_MANIFEST_TEXTS (D224): `Error::TargetsNotFound` Display for
 * a Windows NSIS client and a Linux AppImage client — pinned by K3. latest.json
 * lists only darwin, so every non-macOS check rejects with one of these.
 */
export const MALFORMED_METADATA_TEXTS = [
  "error decoding response body",
  "the `url` field was not set on the updater response",
  "the `signature` field was not set on the updater response",
  "missing field `version`",
  "invalid value for `pub_date`: the 'year' component could not be parsed",
  "the platform `darwin-aarch64` was not found in the response `platforms` object",
] as const;

export const PLATFORM_NOT_IN_MANIFEST_TEXTS = [
  'None of the fallback platforms `["windows-x86_64-nsis", "windows-x86_64"]` were found in the response `platforms` object',
  'None of the fallback platforms `["linux-x86_64-appimage", "linux-x86_64"]` were found in the response `platforms` object',
] as const;
