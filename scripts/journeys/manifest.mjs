/**
 * Purpose: The run manifest of plan §4.6 (`docs/test/journey-runs/<runId>.json`):
 * which cases a journey requires on a platform (§4.1 inheritance), the
 * aggregation rule for a journey and for a run, and the manifest's schema,
 * including that each stated verdict equals the aggregated one and that an
 * INCOMPLETE or interrupted run says why.
 *
 * Key decisions:
 * - INCOMPLETE is not green (plan D8): a required case that was not run, was
 *   blocked or is missing makes the journey INCOMPLETE, and any INCOMPLETE
 *   journey makes the run INCOMPLETE unless something FAILed.
 * - XPASS counts as FAIL until a person confirms it (§4.1); XFAIL counts
 *   towards PASS but is not coverage (that is the ledger gate's concern).
 * - A run in which no journey applied is INCOMPLETE: nothing was proved.
 *
 * @module scripts/journeys/manifest
 * @coordinates-with scripts/journeys/schema.mjs, scripts/journeys/check.mjs
 */
import { PLATFORMS, TIERS } from "./schema.mjs";

export const CASE_VERDICTS = Object.freeze(["PASS", "FAIL", "XFAIL", "XPASS", "未执行", "BLOCKED", "N/A"]);
export const JOURNEY_VERDICTS = Object.freeze(["PASS", "FAIL", "INCOMPLETE", "N/A"]);
export const RUN_VERDICTS = Object.freeze(["PASS", "FAIL", "INCOMPLETE"]);
export const RUNS_DIR = "docs/test/journey-runs";

const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const RUN_ID = /^(\d{4}-\d{2}-\d{2})-([a-z]+)-([a-z]+)-([0-9a-f]{7})-(\d+)$/;

const finding = (rule, message) => ({ severity: "error", rule, message });

/** The ids of the cases `meta` requires on `platform`, in catalogue order. */
export function requiredCases(meta, platform) {
  if (meta.platforms?.[platform]?.status !== "required") return [];
  return (meta.cases ?? [])
    .filter((c) => c.status !== "retired")
    .filter((c) => !Array.isArray(c.platforms) || c.platforms.includes(platform))
    .filter((c) => !Array.isArray(c.optional) || !c.optional.includes(platform))
    .map((c) => c.id);
}

/** One journey's verdict on one platform from its case verdicts (`[{ id, verdict }]`). */
export function aggregateJourney(meta, platform, results) {
  if (meta.platforms?.[platform]?.status === "n/a") return "N/A";
  const byId = new Map(results.map((r) => [r.id, r.verdict]));
  const required = requiredCases(meta, platform).map((id) => byId.get(id));
  if (required.some((v) => v === "FAIL" || v === "XPASS")) return "FAIL";
  if (required.every((v) => v === "PASS" || v === "XFAIL")) return "PASS";
  return "INCOMPLETE";
}

/** A run's verdict from its journeys' verdicts; N/A journeys are left out. */
export function aggregateRun(journeyVerdicts) {
  const applied = journeyVerdicts.filter((v) => v !== "N/A");
  if (applied.includes("FAIL")) return "FAIL";
  if (applied.length > 0 && applied.every((v) => v === "PASS")) return "PASS";
  return "INCOMPLETE";
}

/**
 * @param {object} m a parsed manifest
 * @param {Map<string, object>} catalogue journey metadata by id
 * @returns {object[]} findings
 */
export function checkManifest(m, catalogue) {
  const out = [];
  const schema = (message) => out.push(finding("manifest-schema", message));
  const b = m?.build ?? {};

  if (typeof m?.runId !== "string" || !RUN_ID.test(m.runId)) schema("`runId` must be <date>-<tier>-<platform>-<sha7>-<n>");
  if (!SHA40.test(b.sha ?? "")) schema("`build.sha` must be a 40-hex commit");
  if (!SHA64.test(b.binarySha256 ?? "")) schema("`build.binarySha256` must be a sha256");
  if (!["release", "debug"].includes(b.profile)) schema("`build.profile` must be release or debug");
  if (!PLATFORMS.includes(b.platform)) schema(`\`build.platform\` must be one of ${PLATFORMS.join(", ")}`);
  if (typeof b.os !== "string" || b.os === "") schema("`build.os` must name the system version");
  if (!TIERS.includes(m?.tier)) schema(`\`tier\` must be one of ${TIERS.join(", ")}`);
  if (!RUN_VERDICTS.includes(m?.verdict)) schema(`\`verdict\` must be one of ${RUN_VERDICTS.join(", ")}`);
  const id = RUN_ID.exec(m?.runId ?? "");
  if (id && (id[2] !== m.tier || id[3] !== b.platform || !String(b.sha ?? "").startsWith(id[4]))) {
    schema("`runId` does not match the build's tier, platform and sha");
  }
  if (!Array.isArray(m?.journeys)) {
    schema("`journeys` must be a list");
    return out;
  }

  const journeyVerdicts = [];
  for (const j of m.journeys) {
    if (!SHA40.test(j?.revision ?? "")) schema(`${j?.id}: \`revision\` must be the journey file's git blob sha`);
    if (!Number.isInteger(j?.projectionVersion)) schema(`${j?.id}: \`projectionVersion\` must be an integer`);
    if (!Array.isArray(j?.cases)) {
      schema(`${j?.id}: \`cases\` must be a list`);
      continue;
    }
    for (const c of j.cases) {
      if (!CASE_VERDICTS.includes(c?.verdict)) schema(`${j.id}/${c?.id}: verdict ${JSON.stringify(c?.verdict)} is not in the vocabulary`);
      if (!Array.isArray(c?.evidence)) schema(`${j.id}/${c?.id}: \`evidence\` must be a list`);
    }
    const meta = catalogue.get(j.id);
    if (!meta) {
      out.push(finding("manifest-journey", `${j.id} is not in the catalogue`));
      continue;
    }
    const want = aggregateJourney(meta, b.platform, j.cases);
    if (j.verdict !== want) out.push(finding("manifest-verdict", `${j.id} states ${j.verdict} but its cases aggregate to ${want}`));
    journeyVerdicts.push(want);
  }

  const run = aggregateRun(journeyVerdicts);
  if (RUN_VERDICTS.includes(m.verdict) && m.verdict !== run) {
    out.push(finding("manifest-verdict", `the run states ${m.verdict} but its journeys aggregate to ${run}`));
  }
  const reasonless = typeof m.incompleteReason !== "string" || m.incompleteReason.trim() === "";
  if ((m.verdict === "INCOMPLETE" || m.interrupted === true) && reasonless) {
    out.push(finding("manifest-reason", "an INCOMPLETE or interrupted run must give `incompleteReason`"));
  }
  return out;
}
