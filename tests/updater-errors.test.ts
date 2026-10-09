// @vitest-environment node
/**
 * isUpdatesDisabledError — classifies an updater check() rejection message as
 * "updates disabled" versus a genuine failure (WI-1, plan-20261009-122014).
 *
 * Law: isUpdatesDisabledError(m) === legacy(m) || m.includes("does not have any endpoints")
 * for every m, where legacy is the three markers AboutSettings matched before WI-1.
 * U6 enumerates the superstring closure; U7 checks the law against a frozen oracle.
 */
import { describe, it, expect } from "vitest";
import { isUpdatesDisabledError } from "../src/components/common/settings/updaterErrors";

/** tauri-plugin-updater 2.9.0 `Error::EmptyEndpoints` Display text. */
const REAL_EMPTY_ENDPOINTS = "Updater does not have any endpoints set.";
const NETWORK_MESSAGE =
  "error sending request for url (https://github.com/anzchy/mdpro/releases/latest/download/latest.json)";

/** Frozen copy of the pre-WI-1 chain; the oracle must not import production code. */
function legacy(m: string): boolean {
  return (
    m.includes("no endpoints") ||
    m.includes("empty") ||
    m.includes("Could not fetch a valid release")
  );
}
function oracle(m: string): boolean {
  return legacy(m) || m.includes("does not have any endpoints");
}

const LEGACY_TRUE = [
  "no endpoints configured",
  "endpoint list is empty",
  "Could not fetch a valid release JSON from the remote",
];
const NETWORK_FALSE = [
  NETWORK_MESSAGE,
  "operation timed out",
  "dns error: failed to lookup address information",
];
const BLANK = ["", "   ", "\n"];
const UPPERCASED = ["UPDATER DOES NOT HAVE ANY ENDPOINTS SET.", "COULD NOT FETCH A VALID RELEASE"];
const NEAR_MISS_FALSE = ["failed to parse endpoints config", "Updater has endpoints set."];

const MARKERS = [REAL_EMPTY_ENDPOINTS, "no endpoints", "empty", "Could not fetch a valid release"];
const PREFIXES = ["", "Error: ", "updater: ", "x"];
const SUFFIXES = ["", "\n", " (code 1)", "."];
const WRAPPED = MARKERS.flatMap((m) =>
  PREFIXES.flatMap((p) => SUFFIXES.map((s) => `${p}${m}${s}`)),
);

describe("isUpdatesDisabledError", () => {
  it("U1: recognises the real plugin 2.9.0 empty-endpoints message", () => {
    expect(isUpdatesDisabledError(REAL_EMPTY_ENDPOINTS)).toBe(true);
  });

  it.each(LEGACY_TRUE)("U2: keeps the legacy marker in %j", (m) => {
    expect(isUpdatesDisabledError(m)).toBe(true);
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

  it("U6: every marker stays recognised under any prefix/suffix wrapping (64 inputs)", () => {
    expect(WRAPPED).toHaveLength(64);
    const failures = WRAPPED.filter((m) => !isUpdatesDisabledError(m));
    expect(failures).toEqual([]);
  });

  it("U7: agrees with the reference oracle on every listed input and near-miss", () => {
    const inputs = [
      REAL_EMPTY_ENDPOINTS,
      ...LEGACY_TRUE,
      ...NETWORK_FALSE,
      ...BLANK,
      ...UPPERCASED,
      ...WRAPPED,
      ...NEAR_MISS_FALSE,
      "endpoints",
      "failed to parse endpoints config",
      "does not have any endpoint",
      "has no any endpoints",
    ];
    const mismatches = inputs.filter((m) => isUpdatesDisabledError(m) !== oracle(m));
    expect(mismatches).toEqual([]);
  });

  it.each(NEAR_MISS_FALSE)("U8: does not match bare endpoint wording %j", (m) => {
    expect(isUpdatesDisabledError(m)).toBe(false);
  });
});
