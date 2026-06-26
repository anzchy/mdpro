// Canonical body-hash transform for the small-feature approval-recorder (plan WI-F0).
//
// SECURITY-CRITICAL — this exact transform is the body-hash pin that closes the
// issue-content TOCTOU (BLOCK-4/BLOCK-5). It MUST stay byte-identical across all
// three sites that compute it:
//   1. the recorder workflow .github/workflows/cc-feature-approval-recorder.yml
//      (inlines a copy — the recorder is pure-API and cannot `actions/checkout`
//      to import this module),
//   2. WI-F1 (the builder) re-check before building,
//   3. WI-F3 (the verifier) re-check at merge time.
// tests/feature-loop-body-hash.test.ts pins a known input -> hex so any drift in
// any copy is caught. Update every copy together.

import { createHash } from "node:crypto";

/**
 * Canonicalize an issue body so cosmetic re-renders (CRLF line endings, trailing
 * whitespace, a trailing newline GitHub may add or strip) never flip the hash.
 *
 * Transform (exact, per WI-F0): split on "\n", rstrip each line, rejoin with "\n",
 * then rstrip the whole string. Splitting on "\n" then rstripping each line drops a
 * trailing "\r", collapsing CRLF -> LF.
 *
 * @param {string | null | undefined} body
 * @returns {string} canonical body
 */
export function canonicalizeBody(body) {
  const rstrip = (s) => s.replace(/\s+$/u, "");
  const text = body == null ? "" : String(body);
  return rstrip(text.split("\n").map(rstrip).join("\n"));
}

/**
 * Hex SHA-256 of the canonicalized body, UTF-8 encoded.
 *
 * @param {string | null | undefined} body
 * @returns {string} lowercase hex digest
 */
export function bodySha256(body) {
  return createHash("sha256").update(canonicalizeBody(body), "utf8").digest("hex");
}
