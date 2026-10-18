/**
 * Purpose: `pnpm control:release-clean [--launch]`, the release clean check
 * of ADR-0047 WI-009 plan item 10 (ADR-0034 decision 4 plus decision 6's
 * runtime opt-in). Four layers, each judged by `releaseCleanChecks.mjs`:
 *   1. the default build's feature graph enables neither channel feature;
 *   2. the release `dist` carries no channel marker;
 *   3. the release main binary carries no channel string;
 *   4. (`--launch` only) the release app, started on a run dir holding the
 *      `eval` opt-in marker with a verify run's env, listens on nothing but
 *      MCP and single-instance, and writes no handoff.
 *
 * Pipeline: layers 1–3 → (if --launch) refuse if mdpro runs or the release
 *   single-instance socket exists → makeRun → placeOptin → launch →
 *   waitReady → lsof → stop (its leftover note) → listRun → removeRun →
 *   verdict line → exit.
 *
 * Key decisions:
 * - Exit 0 only when all four layers ran clean; 1 on any finding; 2 when
 *   layers 1–3 are clean and layer 4 did not run. A check that did not run
 *   never passes.
 * - The exit is read off each layer's status, never off its text, so a read
 *   that throws a message ending in ": clean" is still a finding (Codex
 *   round-1 M1 on PR #500).
 * - Layer 4 runs only with `--launch`, and only on the Mac mini (the user's
 *   choice, relayed by the delegator 2026-10-17): a release app would take
 *   the daily app's single-instance socket, so it refuses while any mdpro
 *   process runs or that socket exists.
 * - A read that throws is a finding of its layer, never clean. The app is
 *   always stopped and the run dir always removed once they exist, and a
 *   failure of either is one more finding, never a replacement.
 * - Every read is an injected dep; `releaseCleanDeps.mjs` has the real ones.
 * - A single-instance socket our app leaves (SIGTERM skips its exit hook) is
 *   a note line, not a finding, and never changes the exit (round 4, H1).
 *
 * @module scripts/control/releaseClean
 * @coordinates-with scripts/control/releaseCleanChecks.mjs (every judgement)
 * @coordinates-with scripts/control/releaseCleanDeps.mjs (the real reads)
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  binaryFinding,
  distFinding,
  featureGraphFinding,
  homeFinding,
  leftoverNote,
  listenerFinding,
  SI_SOCK_RELEASE,
} from "./releaseCleanChecks.mjs";

export const USAGE = "usage: pnpm control:release-clean [--launch]";
const NOT_RUN = "layer 4: not run (pass --launch, on the Mac mini)";

/** @typedef {{ layer: number, status: "clean" | "finding" | "not-run", line: string }} LayerResult */

/** @param {number} n @param {string | null} finding @returns {LayerResult} */
const judged = (n, finding) =>
  finding === null ? { layer: n, status: "clean", line: `layer ${n}: clean` } : { layer: n, status: "finding", line: finding };

/** @param {unknown} e */
const message = (e) => (e instanceof Error ? e.message : String(e));

/**
 * One layer's result: clean, its finding, or the read's error as a finding.
 * @param {number} n @param {() => string | null} judge
 * @returns {LayerResult}
 */
function layer(n, judge) {
  try {
    return judged(n, judge());
  } catch (e) {
    return judged(n, `layer ${n}: could not read: ${message(e)}`);
  }
}

/**
 * Layer 4's results and notes: a refusal, else one launch on a fresh run
 * dir. A failed stop retry or run-dir removal adds its own finding; it
 * never replaces the one already caught (Fable round-3 M2).
 * @param {any} d @returns {Promise<{ results: LayerResult[], notes: string[] }>}
 */
async function launchLayer(d) {
  if (d.mdproRunning()) return { results: [judged(4, "layer 4: refused: an mdpro process is running")], notes: [] };
  if (d.siSockExists()) return { results: [judged(4, `layer 4: refused: ${SI_SOCK_RELEASE} exists`)], notes: [] };
  const dir = d.makeRun();
  /** @type {number | undefined} */
  let pid;
  /** @type {LayerResult[]} */
  let results;
  /** @type {string[]} */
  const notes = [];
  try {
    d.placeOptin(dir);
    pid = d.launch(dir);
    await d.waitReady(pid);
    const { tcp, unix } = d.lsof(pid);
    const listeners = listenerFinding(tcp, unix);
    const note = leftoverNote((await d.stop(pid))?.left ?? null);
    pid = undefined;
    if (note !== null) notes.push(note);
    const home = homeFinding(d.listRun(dir));
    const found = [listeners, home].filter((f) => f !== null);
    results = found.length > 0 ? found.map((f) => judged(4, f)) : [judged(4, null)];
  } catch (e) {
    results = [judged(4, `layer 4: could not read: ${message(e)}`)];
  }
  if (pid !== undefined) {
    try {
      await d.stop(pid);
    } catch (e) {
      results.push(judged(4, `layer 4: could not stop the app: ${message(e)}`));
    }
  }
  try {
    d.removeRun(dir);
  } catch (e) {
    results.push(judged(4, `layer 4: could not remove ${dir}: ${message(e)}`));
  }
  if (results.some((r) => r.status === "finding")) results = results.filter((r) => r.status === "finding");
  return { results, notes };
}

/**
 * Run the check.
 * @param {any} d the deps (see the test's `deps()` for the shape)
 * @param {{ launch: boolean }} opts
 * @returns {Promise<{ exit: 0 | 1 | 2, layers: LayerResult[], lines: string[] }>}
 */
export async function releaseClean(d, { launch }) {
  const first = [
    layer(1, () => featureGraphFinding(d.cargoTree())),
    layer(2, () => distFinding(d.distFiles())),
    layer(3, () => binaryFinding(d.binaryBytes())),
  ];
  const four = launch
    ? await launchLayer(d)
    : { results: [{ layer: 4, status: /** @type {const} */ ("not-run"), line: NOT_RUN }], notes: [] };
  /** @type {LayerResult[]} */
  const layers = [...first, ...four.results];
  const lines = [...layers.map((l) => l.line), ...four.notes];
  const findings = layers.filter((l) => l.status === "finding").length;
  if (findings > 0) return { exit: 1, layers, lines: [...lines, `release-clean: ${findings} finding(s)`] };
  if (layers.some((l) => l.status === "not-run")) {
    return { exit: 2, layers, lines: [...lines, "release-clean: incomplete, layer 4 did not run"] };
  }
  return { exit: 0, layers, lines: [...lines, "release-clean: all four layers clean"] };
}

/* v8 ignore start -- only reached in a real `node scripts/control/releaseClean.mjs` process */
if (pathToFileURL(path.resolve(String(process.argv[1]))).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--launch")) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 1;
  } else {
    const { defaultDeps } = await import("./releaseCleanDeps.mjs");
    const { exit, lines } = await releaseClean(defaultDeps(), { launch: args.includes("--launch") });
    process.stdout.write(`${lines.join("\n")}\n`);
    process.exitCode = exit;
  }
}
/* v8 ignore stop */
