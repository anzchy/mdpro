// @vitest-environment node
/**
 * isUpdatesDisabledError — classifies an updater check() rejection message as
 * "updates disabled" versus a genuine failure (WI-1, plan-20261009-122014;
 * narrowed by WI-1, plan-20261010-093842; narrowed again by D85-WI-1; anchored
 * by D110-WI-2).
 *
 * Law (D110): for every m,
 *   isUpdatesDisabledError(m) === (m.trim() === "Updater does not have any endpoints set.")
 * Case-sensitive and anchored on the full plugin Display text; only surrounding
 * whitespace is tolerated. Consequences: any non-whitespace wrapping of the
 * positive is negative (U6, U14, U15), and noise never turns a negative positive
 * (U10). U7 checks the law against an independent oracle.
 *
 * D110 / rule 12: the former law was an unanchored substring match, so a
 * Serialization error echoing a response body that contains the marker read as
 * "updates disabled". Superstring closure was the defect, not a property:
 * U6, U7 (oracle) and U10 (positive half) changed; U14-U16 are new.
 *
 * U2/U6/U7 changed (rule 12): the prior spec asserted 'no endpoints' / 'empty' as
 * disabled markers; tauri-plugin-updater 2.9.0 never emits them (K1 pins its only
 * two Display texts), and 'empty' misclassified real failures.
 *
 * D85 / rule 12: ReleaseNotFound is what the plugin returns for any non-2xx
 * (updater.rs:442-446), so "disabled" was a false spec. It is now pinned as the
 * uncertain class: U2, U6, U7, U10 changed; U12 and U13 are new.
 */
import { describe, it, expect } from "vitest";
import { classifyCheckRejection, isUpdatesDisabledError } from "../src/components/common/settings/updaterErrors";
import { MALFORMED_METADATA_TEXTS, PLATFORM_NOT_IN_MANIFEST_TEXTS } from "./support/updaterErrorTexts";
import { collectionCases } from "./support/collectionCases";

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
// D85 / rule 12: ReleaseNotFound is what the plugin returns for any non-2xx, so "disabled" was a false spec.
// D110 / rule 12: a substring oracle accepts an echoed body containing the marker; the law is anchored.
function oracle(m: string): boolean {
  return m.trim() === REAL_EMPTY_ENDPOINTS;
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
// D85 / rule 12: ReleaseNotFound is what the plugin returns for any non-2xx, so "disabled" was a false spec.
const WRAPPED = wrap([REAL_EMPTY_ENDPOINTS]);
/** D85: ReleaseNotFound under every wrapping — all uncertain, never disabled (U12). */
const RNF_WRAPPED = wrap([REAL_RELEASE_NOT_FOUND]);
const MALFORMED = [...MALFORMED_METADATA_TEXTS];
const FORMER_WRAPPED = wrap(FORMER_MARKERS);

const NOISE = ["empty", "no endpoints", " is empty", "no endpoints configured"];
// D85 / rule 12: ReleaseNotFound is what the plugin returns for any non-2xx, so "disabled" was a
// false spec; it moves from the positive to the negative bases.
const U10_POSITIVE_BASES = [REAL_EMPTY_ENDPOINTS].flatMap((m) => PREFIXES.map((p) => ({ p, m })));
const U10_NEGATIVE_BASES = [
  ...NETWORK_FALSE,
  ...BLANK,
  ...NEAR_MISS_FALSE,
  "endpoints",
  REAL_RELEASE_NOT_FOUND,
];

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
  // D85 / rule 12: ReleaseNotFound is what the plugin returns for any non-2xx, so "disabled" was a false spec.
  it("U2: treats the plugin ReleaseNotFound message as uncertain, not disabled", () => {
    expect(isUpdatesDisabledError(REAL_RELEASE_NOT_FOUND)).toBe(false);
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
  // D85 / rule 12: ReleaseNotFound is what the plugin returns for any non-2xx, so "disabled" was a
  // false spec; domain 32 → 16, its half is U12.
  // D110 / rule 12: formerly "stays recognised under any prefix/suffix wrapping" — that
  // superstring closure is the D110 defect. Only whitespace around the exact text is accepted.
  it("U6: of the 16 wrappings of the empty-endpoints message only the bare and newline-suffixed ones are recognised", () => {
    expect(WRAPPED).toHaveLength(16);
    const recognised = WRAPPED.filter((m) => isUpdatesDisabledError(m));
    expect(recognised).toEqual([REAL_EMPTY_ENDPOINTS, `${REAL_EMPTY_ENDPOINTS}\n`]);
  });

  // Rule 12: the frozen legacy() oracle encoded "no endpoints" / "empty", which
  // plugin 2.9.0 never emits and which misclassified real failures. The oracle body
  // is replaced by the two-fragment law; the input list is only extended.
  // D85 / rule 12: ReleaseNotFound is what the plugin returns for any non-2xx, so "disabled" was a
  // false spec; the oracle is now the one-fragment law, inputs only extended (RNF_WRAPPED, MALFORMED).
  it("U7: agrees with the one-fragment oracle on every listed input and near-miss", () => {
    const inputs = [
      REAL_EMPTY_ENDPOINTS,
      REAL_RELEASE_NOT_FOUND,
      ...NETWORK_FALSE,
      ...BLANK,
      ...UPPERCASED,
      ...WRAPPED,
      ...RNF_WRAPPED,
      ...MALFORMED,
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

  // D110 / rule 12: formerly "never changes the classification" — noise invariance held for
  // positives only because matching was unanchored. Noise still never makes a negative
  // positive; noise on a positive now makes it negative (anchored on the full text).
  it("U10: noise never makes a negative positive, and always makes a positive negative", () => {
    expect(U10_POSITIVE_BASES.length).toBeGreaterThan(0);
    expect(U10_NEGATIVE_BASES.length).toBeGreaterThan(0);
    expect(U10_POSITIVE_BASES.some(({ p, m }) => isUpdatesDisabledError(`${p}${m}`))).toBe(true);
    expect(U10_NEGATIVE_BASES.some((m) => !isUpdatesDisabledError(m))).toBe(true);

    const violations = u10Pairs().filter(
      ({ base, variant }) => isUpdatesDisabledError(variant) && !isUpdatesDisabledError(base),
    );
    expect(violations).toEqual([]);
    const surviving = u10Pairs().filter(
      ({ base, variant }) => isUpdatesDisabledError(base) && isUpdatesDisabledError(variant),
    );
    expect(surviving).toEqual([]);
  });

  it("U11: the former markers under any wrapping are not disabled (32 inputs)", () => {
    expect(FORMER_WRAPPED).toHaveLength(32);
    const matches = FORMER_WRAPPED.filter((m) => isUpdatesDisabledError(m));
    expect(matches).toEqual([]);
  });

  it("U12: ReleaseNotFound under any wrapping is never disabled (16 inputs)", () => {
    expect(RNF_WRAPPED).toHaveLength(16);
    const matches = RNF_WRAPPED.filter((m) => isUpdatesDisabledError(m));
    expect(matches).toEqual([]);
  });

  it.each(collectionCases("tests/updater-errors.test.ts:224", MALFORMED))("U13: malformed release metadata %j is a failure, not disabled", (m) => {
    expect(isUpdatesDisabledError(m)).toBe(false);
  });

  // D110: a Serialization error echoing a response body that happens to contain the
  // marker must not read as "updates disabled".
  it.each([
    `expected value at line 1 column 1: ${REAL_EMPTY_ENDPOINTS}`,
    `invalid type: string "${REAL_EMPTY_ENDPOINTS}", expected struct RemoteRelease`,
    `error decoding response body: ${REAL_EMPTY_ENDPOINTS}`,
    `${REAL_EMPTY_ENDPOINTS} trailing garbage`,
    "Updater does not have any endpoints",
    "does not have any endpoints",
  ])("U14: %j carries the marker but is not the plugin's message, so it is not disabled", (m) => {
    expect(isUpdatesDisabledError(m)).toBe(false);
  });

  it.each([
    REAL_EMPTY_ENDPOINTS,
    `${REAL_EMPTY_ENDPOINTS}\n`,
    `  ${REAL_EMPTY_ENDPOINTS}  `,
    `\t${REAL_EMPTY_ENDPOINTS}\r\n`,
  ])("U15: the exact Display text with only surrounding whitespace %j is disabled", (m) => {
    expect(isUpdatesDisabledError(m)).toBe(true);
  });

  it("U16: any non-whitespace text before or after the Display text makes it not disabled (generated)", () => {
    // Deterministic generator over printable ASCII fragments of length 1-6.
    let seed = 110;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    const fragment = () => {
      const len = 1 + (next() % 6);
      let out = "";
      for (let i = 0; i < len; i++) out += String.fromCharCode(33 + (next() % 94));
      return out;
    };
    const accepted: string[] = [];
    for (let i = 0; i < 300; i++) {
      const f = fragment();
      for (const m of [`${f}${REAL_EMPTY_ENDPOINTS}`, `${REAL_EMPTY_ENDPOINTS}${f}`, `${f} ${REAL_EMPTY_ENDPOINTS} ${f}`]) {
        if (isUpdatesDisabledError(m)) accepted.push(m);
      }
    }
    expect(accepted).toEqual([]);
  });
});

/**
 * D224: plugin 2.13.1's `check()` rejects with `TargetsNotFound` whenever latest.json has no
 * entry for the client's platform, even when the remote version is not newer. latest.json lists
 * only darwin (ADR-0102), so off macOS that rejection means "updates are not offered here", the
 * updates-disabled state (user's ruling 「A: coming soon (Recommended)」). On macOS it means a
 * broken release and stays an error. Texts pinned in Rust by K3.
 */
describe("D224 classifyCheckRejection", () => {
  const [WINDOWS, LINUX] = PLATFORM_NOT_IN_MANIFEST_TEXTS;

  it("C1: the platform-not-in-manifest texts are platform-not-offered off macOS, an error on macOS", () => {
    for (const text of PLATFORM_NOT_IN_MANIFEST_TEXTS) {
      expect(classifyCheckRejection(text, false)).toBe("platform-not-offered");
      expect(classifyCheckRejection(text, true)).toBe("error");
    }
  });

  it("C2: EmptyEndpoints is updates-disabled on every platform", () => {
    expect(classifyCheckRejection(REAL_EMPTY_ENDPOINTS, false)).toBe("updates-disabled");
    expect(classifyCheckRejection(REAL_EMPTY_ENDPOINTS, true)).toBe("updates-disabled");
  });

  it("C3: ReleaseNotFound and every malformed-metadata text stay errors on every platform", () => {
    for (const text of ["Could not fetch a valid release JSON from the remote", ...MALFORMED_METADATA_TEXTS]) {
      expect(classifyCheckRejection(text, false), text).toBe("error");
      expect(classifyCheckRejection(text, true), text).toBe("error");
    }
  });

  it.each([
    ["inside a longer message", `failed: ${WINDOWS}`],
    ["followed by more text", `${WINDOWS} (retry)`],
    ["lower-cased", WINDOWS.toLowerCase()],
    ["without the backticks", WINDOWS.replace(/`/g, "")],
    ["an empty platform list", "None of the fallback platforms `[]` were found in the response `platforms` object"],
    ["unquoted entries", "None of the fallback platforms `[windows-x86_64]` were found in the response `platforms` object"],
    ["the 2.9.0 'on the response' wording", WINDOWS.replace("in the response", "on the response")],
  ])("C4: a near miss (%s) is an error off macOS", (_label, text) => {
    expect(classifyCheckRejection(text, false)).toBe("error");
  });

  it("C5: surrounding whitespace is tolerated, as for EmptyEndpoints", () => {
    expect(classifyCheckRejection(`  ${LINUX}\n`, false)).toBe("platform-not-offered");
  });

  it("C6: a single-entry list (no installer suffix) still reads as platform-not-offered", () => {
    const text = "None of the fallback platforms `[\"linux-x86_64\"]` were found in the response `platforms` object";
    expect(classifyCheckRejection(text, false)).toBe("platform-not-offered");
  });
});
