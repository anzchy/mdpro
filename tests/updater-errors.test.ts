// @vitest-environment node
/**
 * isUpdatesDisabledError — classifies an updater check() rejection message as
 * "updates disabled" versus a genuine failure (WI-1, plan-20261009-122014;
 * narrowed by WI-1, plan-20261010-093842).
 *
 * Law: for every m,
 *   isUpdatesDisabledError(m) === (m.includes("does not have any endpoints")
 *                                  || m.includes("Could not fetch a valid release"))
 * Case-sensitive and unanchored. Consequences: superstring closure (wrapping a
 * positive keeps it positive) and noise invariance (adding "empty" / "no endpoints"
 * never changes the result). U6 and U11 enumerate the wrapping domain, U7 checks
 * the law against an independent oracle, U10 checks the noise relation.
 *
 * U2/U6/U7 changed (rule 12): the prior spec asserted 'no endpoints' / 'empty' as
 * disabled markers; tauri-plugin-updater 2.9.0 never emits them (K1 pins its only
 * two Display texts), and 'empty' misclassified real failures.
 */
import { describe, it, expect } from "vitest";
import { isUpdatesDisabledError } from "../src/components/common/settings/updaterErrors";

/** tauri-plugin-updater 2.9.0 `Error::EmptyEndpoints` Display text. */
const REAL_EMPTY_ENDPOINTS = "Updater does not have any endpoints set.";
/**
 * tauri-plugin-updater 2.9.0 `Error::ReleaseNotFound` Display text.
 * Rule 12: formerly LEGACY_TRUE, which also held "no endpoints configured" and
 * "endpoint list is empty" as disabled. The plugin never emits those, and
 * "empty" misclassified real failures; both moved to EMPTY_NEGATIVES (U9).
 */
const REAL_RELEASE_NOT_FOUND = "Could not fetch a valid release JSON from the remote";
const NETWORK_MESSAGE =
  "error sending request for url (https://github.com/anzchy/mdpro/releases/latest/download/latest.json)";

/** Independent oracle for the law; must not import production code. */
function oracle(m: string): boolean {
  return m.includes("does not have any endpoints") || m.includes("Could not fetch a valid release");
}

const NETWORK_FALSE = [
  NETWORK_MESSAGE,
  "operation timed out",
  "dns error: failed to lookup address information",
];
const BLANK = ["", "   ", "\n"];
const UPPERCASED = ["UPDATER DOES NOT HAVE ANY ENDPOINTS SET.", "COULD NOT FETCH A VALID RELEASE"];
const NEAR_MISS_FALSE = ["failed to parse endpoints config", "Updater has endpoints set."];
/** Real failures that mention "empty" / "no endpoints" (formerly misclassified). */
const EMPTY_NEGATIVES = [
  "endpoint list is empty",
  "no endpoints configured",
  "Failed to read response body: body is empty",
  "error decoding response body: empty",
];
const FORMER_MARKERS = ["no endpoints", "empty"];

const PREFIXES = ["", "Error: ", "updater: ", "x"];
const SUFFIXES = ["", "\n", " (code 1)", "."];
const wrap = (bases: string[]) =>
  bases.flatMap((m) => PREFIXES.flatMap((p) => SUFFIXES.map((s) => `${p}${m}${s}`)));
/**
 * Rule 12: formerly MARKERS × PREFIXES × SUFFIXES (64) with "no endpoints" and
 * "empty" as positives. The plugin never emits them, and "empty" misclassified
 * real failures; that half is now FORMER_WRAPPED (U11, all false).
 */
const WRAPPED = wrap([REAL_EMPTY_ENDPOINTS, REAL_RELEASE_NOT_FOUND]);
const FORMER_WRAPPED = wrap(FORMER_MARKERS);

const NOISE = ["empty", "no endpoints", " is empty", "no endpoints configured"];
const U10_POSITIVE_BASES = [REAL_EMPTY_ENDPOINTS, REAL_RELEASE_NOT_FOUND].flatMap((m) =>
  PREFIXES.map((p) => ({ p, m })),
);
const U10_NEGATIVE_BASES = [...NETWORK_FALSE, ...BLANK, ...NEAR_MISS_FALSE, "endpoints"];

function u10Pairs(): { base: string; variant: string }[] {
  const pairs: { base: string; variant: string }[] = [];
  for (const noise of NOISE) {
    for (const { p, m } of U10_POSITIVE_BASES) {
      const base = `${p}${m}`;
      // Start, end, and the prefix/message seam — never the fragment interior.
      pairs.push({ base, variant: `${noise}${base}` });
      pairs.push({ base, variant: `${base}${noise}` });
      pairs.push({ base, variant: `${p}${noise}${m}` });
    }
    for (const base of U10_NEGATIVE_BASES) {
      const mid = Math.floor(base.length / 2);
      pairs.push({ base, variant: `${noise}${base}` });
      pairs.push({ base, variant: `${base}${noise}` });
      pairs.push({ base, variant: `${base.slice(0, mid)}${noise}${base.slice(mid)}` });
    }
  }
  return pairs;
}

describe("isUpdatesDisabledError", () => {
  it("U1: recognises the real plugin 2.9.0 empty-endpoints message", () => {
    expect(isUpdatesDisabledError(REAL_EMPTY_ENDPOINTS)).toBe(true);
  });

  // Rule 12: formerly "U2: keeps the legacy marker" over three fixtures; the two
  // "no endpoints" / "empty" fixtures are never emitted by plugin 2.9.0 and moved to U9.
  it("U2: recognises the plugin ReleaseNotFound message", () => {
    expect(isUpdatesDisabledError(REAL_RELEASE_NOT_FOUND)).toBe(true);
  });

  it.each(NETWORK_FALSE)("U3: treats a network failure %j as not disabled", (m) => {
    expect(isUpdatesDisabledError(m)).toBe(false);
  });

  it.each(BLANK)("U4: treats blank message %j as not disabled", (m) => {
    expect(isUpdatesDisabledError(m)).toBe(false);
  });

  it.each(UPPERCASED)("U5: stays case-sensitive for %j", (m) => {
    expect(isUpdatesDisabledError(m)).toBe(false);
  });

  // Rule 12: domain narrowed 64 → 32 — "no endpoints" / "empty" are not plugin
  // 2.9.0 messages and "empty" misclassified real failures; their half is U11.
  it("U6: both real messages stay recognised under any prefix/suffix wrapping (32 inputs)", () => {
    expect(WRAPPED).toHaveLength(32);
    const failures = WRAPPED.filter((m) => !isUpdatesDisabledError(m));
    expect(failures).toEqual([]);
  });

  // Rule 12: the frozen legacy() oracle encoded "no endpoints" / "empty", which
  // plugin 2.9.0 never emits and which misclassified real failures. The oracle body
  // is replaced by the two-fragment law; the input list is only extended.
  it("U7: agrees with the two-fragment oracle on every listed input and near-miss", () => {
    const inputs = [
      REAL_EMPTY_ENDPOINTS,
      REAL_RELEASE_NOT_FOUND,
      ...NETWORK_FALSE,
      ...BLANK,
      ...UPPERCASED,
      ...WRAPPED,
      ...FORMER_WRAPPED,
      ...EMPTY_NEGATIVES,
      ...NEAR_MISS_FALSE,
      ...u10Pairs().flatMap(({ base, variant }) => [base, variant]),
      "does not have any endpoints",
      "Could not fetch a valid release",
      "endpoints",
      "failed to parse endpoints config",
      "does not have any endpoint",
      "has no any endpoints",
      "Could not fetch update manifest",
      "could not fetch a valid release",
      "Could not fetch a valid releas",
    ];
    const mismatches = inputs.filter((m) => isUpdatesDisabledError(m) !== oracle(m));
    expect(mismatches).toEqual([]);
  });

  it.each(NEAR_MISS_FALSE)("U8: does not match bare endpoint wording %j", (m) => {
    expect(isUpdatesDisabledError(m)).toBe(false);
  });

  it.each(EMPTY_NEGATIVES)("U9: treats %j as a real failure, not disabled", (m) => {
    expect(isUpdatesDisabledError(m)).toBe(false);
  });

  it("U10: adding the former markers as noise never changes the classification", () => {
    expect(U10_POSITIVE_BASES.length).toBeGreaterThan(0);
    expect(U10_NEGATIVE_BASES.length).toBeGreaterThan(0);
    expect(U10_POSITIVE_BASES.some(({ p, m }) => isUpdatesDisabledError(`${p}${m}`))).toBe(true);
    expect(U10_NEGATIVE_BASES.some((m) => !isUpdatesDisabledError(m))).toBe(true);

    const violations = u10Pairs().filter(
      ({ base, variant }) => isUpdatesDisabledError(variant) !== isUpdatesDisabledError(base),
    );
    expect(violations).toEqual([]);
  });

  it("U11: the former markers under any wrapping are not disabled (32 inputs)", () => {
    expect(FORMER_WRAPPED).toHaveLength(32);
    const matches = FORMER_WRAPPED.filter((m) => isUpdatesDisabledError(m));
    expect(matches).toEqual([]);
  });
});
