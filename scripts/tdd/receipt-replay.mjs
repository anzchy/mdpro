/**
 * Purpose: `red-receipt.mjs replay --id <ID> [--base <rev>] [--expect-digest <hex>]`
 * (ADR-0149 d2–d4, ADR-0145 d2–d3): print the RED → head test diff and the base → head
 * production diff, replay the recorded ids against the PR base, digest the packet, and
 * write it all to `.claude/tdd-guardian/evidence/<id>.json`. The verdict never changes.
 *
 * Pipeline: sidecar entry (current, pin ref intact) or pre-entry → base = merge-base of
 * `--base` (default origin/master, else master) and HEAD → worktree: restore, base run,
 * head run → judge → diffs → digest → evidence file and sidecar `replay` field.
 *
 * Key decisions:
 * - Every recorded id must have been an assertion at RED, fail at base as an assertion at
 *   the RED location, and pass at head. The location is the RED line mapped through
 *   `git diff -U0` of the RED blob against the file as it sat in the base run; a line that
 *   falls inside a hunk (or no location) is matched by the assertion message instead, and
 *   the base failure must still sit in the RED's file.
 * - A receipt with no current entry takes the replay as far as it can run (ADR-0149 d4):
 *   the head's spec files over base production, listing the cases that pass there, and
 *   always `user_ruling_required`. A base run that did not complete lists nothing
 *   (`passing_at_base: null`) and records its cause in `base_run`; the pre-entry digest
 *   covers {id, mode, base, head, spec_blobs, base_run (completed, error, compileError),
 *   passing_at_base}.
 * - The digest is sha256 over canonical JSON (keys sorted at every level) of
 *   {id, recorded_at, tests_tree, base, head, head_tests_tree, spec_blobs, replay}, where
 *   `replay` is the result, the judge's reasons and, per id at base and head, status, kind,
 *   location and the whole message (fix 2, gpt-auditor H1 and M2: the text the auditor
 *   reads is bound). Reasons, messages and a pre-entry `base_run.error` enter the digest
 *   normalised, rewriting only what varies by nature between two runs of the same base and
 *   head (docs/guide/receipt-evidence.md names each rule). A message, and every reason that
 *   quotes one, takes normaliseText: the replay worktree; temp paths, ISO timestamps and
 *   pids only inside a runner line (a `[heavy-lock]` or `[load-guard]` line, Vitest's `RUN`
 *   banner); the timing inside the runner's own timing lines (fix 3, gpt-auditor r2 H1;
 *   fix 4, r3 H1: never a value in an assertion). The replay's own error text (a pre-entry
 *   `base_run.error`, and the reasons judge builds from a run's error, by index) takes
 *   normaliseRunnerText, the same rules over the whole text. The evidence file keeps the
 *   raw text, and the judge compares raw text.
 * @coordinates-with scripts/tdd/red-receipt.mjs, scripts/tdd/replay-worktree.mjs, .claude/agents/mdpro-landing-verifier.md
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { usageError } from "./unit-red-lane.mjs";
import { git, resolveRef } from "./receipt-tree.mjs";
import { entryFor, readEvidence, updateEntry, withEvidenceLock } from "./receipt-evidence.mjs";
import { classifyAt, ensureDir, isPureTest, linkDependencies, restoreHead, restoreToBase, runTests, treeOf, withWorktree } from "./replay-worktree.mjs";

export const canonical = (value) => (Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value));

/** RED line `line` of `redText` as it sits in `runText`, or null when it changed or vanished. */
function mapLine(redText, runText, line) {
  const folder = mkdtempSync(join(tmpdir(), "mdpro-replay-map-"));
  try {
    writeFileSync(join(folder, "red"), redText); writeFileSync(join(folder, "run"), runText);
    const diff = spawnSync("git", ["diff", "--no-index", "--no-ext-diff", "-U0", "red", "run"], { cwd: folder, encoding: "utf8" }).stdout;
    let delta = 0;
    for (const hunk of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/gm)) {
      const start = Number(hunk[1]), removed = hunk[2] === undefined ? 1 : Number(hunk[2]), added = hunk[3] === undefined ? 1 : Number(hunk[3]);
      if (removed > 0 && line >= start && line < start + removed) return null;
      if (removed === 0 ? line > start : line >= start + removed) delta += added - removed;
    }
    return line + delta;
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

/**
 * The replay's verdict: `{result, reasons, ids, runner}`. `runner` holds the indices of the
 * reasons built from a run's own error, which alone take the runner view in the digest.
 */
export function judge(cwd, entry, base, head, baseTexts) {
  const reasons = [], ids = {}, runner = [];
  if (!entry.failures.some((failure) => failure.kind === "assertion")) reasons.push("the RED holds no assertion-kind id");
  if (base.compileError) reasons.push("the tests did not compile at base");
  if (base.error) runner.push(reasons.push(`base run: ${base.error}`) - 1);
  if (head.error) runner.push(reasons.push(`head run: ${head.error}`) - 1);
  for (const red of entry.failures) {
    const b = base.outcomes.get(red.id), h = head.outcomes.get(red.id);
    ids[red.id] = { base: b ?? { status: "disappeared" }, head: h ?? { status: "disappeared" } };
    if (red.kind !== "assertion") { reasons.push(`${red.id}: RED was ${red.kind}, not an assertion failure`); continue; }
    if (!b) reasons.push(`${red.id}: disappeared at base`);
    else if (b.status !== "failed") reasons.push(`${red.id}: ${b.status} at base`);
    else if (b.kind !== "assertion") reasons.push(`${red.id}: ${b.kind} at base, not an assertion failure`);
    else {
      const blob = red.location && git(cwd, ["rev-parse", "--verify", "--quiet", `${entry.tests_tree.tree}:${red.location.file}`], { allowFail: true }).stdout.trim();
      const runText = red.location ? baseTexts[red.location.file] : null;
      const mapped = blob && runText != null ? mapLine(git(cwd, ["cat-file", "-p", blob]).stdout, runText, red.location.line) : null;
      const same = mapped !== null ? b.location?.file === red.location.file && b.location?.line === mapped : b.message === red.message && (!red.location || b.location?.file === red.location.file);
      if (!same) reasons.push(`${red.id}: failed at base at ${b.location ? `${b.location.file}:${b.location.line}` : "no location"} (${b.message.split("\n")[0]}), not at the RED assertion`);
    }
    if (!h) reasons.push(`${red.id}: disappeared at head`);
    else if (h.status !== "passed") reasons.push(`${red.id}: ${h.status} at head`);
  }
  return { result: reasons.length ? "failed" : "passed", reasons, ids, runner };
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TEMP_ROOTS = (() => {
  const roots = [tmpdir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];
  try { roots.push(realpathSync(tmpdir())); } catch {}
  return [...new Set(roots)].sort((a, b) => b.length - a.length);
})();
const TEMP_PATH = new RegExp(`(?<![\\w./-])(?:${TEMP_ROOTS.map(escape).join("|")})(?=[/\\s'"\`()\\[\\]{}<>,:]|$)[^\\s'"\`()\\[\\]{}<>,:]*`, "g");

const DURATION = /\d+(?:\.\d+)?\s?(?:ms|s)\b/g;
/** Vitest appends `: expected …` to a custom message's last line; from there on the line is assertion text. */
const beforeSuffix = (line, rewrite) => {
  const cut = line.indexOf(": expected ");
  return cut < 0 ? rewrite(line) : rewrite(line.slice(0, cut)) + line.slice(cut);
};
/**
 * The runner's own timing output, each recognised as a whole line, as a nested run's output
 * reaches a message through `expect(result.status, result.output)`. Only the timing inside
 * the line is rewritten: a Vitest test or file line's trailing duration; a Vitest `Duration`
 * line's durations; a Vitest `Start at` clock; libtest's `finished in`; cargo's `Finished …
 * target(s) in`. A duration anywhere else, as in `expected '10ms'`, stays (gpt-auditor r2 H1).
 */
const TIMING_SPANS = [
  [/^([ \t]*[✓✔×✗❯↓][ \t].*[ \t]\(?)\d+(?:\.\d+)? ?m?s(\)?[ \t]*\r?)$/gm, "$1<duration>$2"],
  [/^([ \t]*Duration[ \t]+)(\d.*)$/gm, (_, lead, rest) => lead + beforeSuffix(rest, (text) => text.replace(DURATION, "<duration>"))],
  [/^([ \t]*Start at[ \t]+)\d{2}:\d{2}:\d{2}/gm, "$1<timestamp>"],
  [/^(test result: .*; finished in )\d+(?:\.\d+)?s(\r?)$/gm, "$1<duration>$2"],
  [/^([ \t]*Finished .*target\(s\) in )(?:\d+m )?\d+(?:\.\d+)?s(\r?)$/gm, "$1<duration>$2"],
];

const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;
/** `ps -o lstart`, as heavy-lock's holder description prints `process_start=`. */
const LSTART = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}\b/g;
const volatileValues = (text) => text.replace(TEMP_PATH, "<tmp>").replace(ISO_TIMESTAMP, "<timestamp>").replace(/\bpid\b[ \t=:]*\d+/gi, "pid <pid>");
const toolValues = (text) => volatileValues(text).replace(LSTART, "<timestamp>").replace(DURATION, "<duration>").replace(/\bcwd=(?!<)\S+/g, "cwd=<path>");

/**
 * The runner's own lines that carry volatile values, each recognised as a whole line from
 * its start (or right after an error name, as on a message's first line), up to Vitest's
 * appended `: expected …`: a `[heavy-lock]` or `[load-guard]` status line (`still waiting
 * (Ns), held by: pid=N started=<ISO> process_start=<lstart> cwd=<path>`), whose wait
 * counts, process start and cwd are rewritten too; and Vitest's `RUN  v<version> <root>`
 * banner. A temp path, timestamp or pid anywhere else in a message is assertion text and
 * stays (gpt-auditor r3 H1).
 */
const RUNNER_LINES = [
  [/^(?:[ \t]*|[A-Za-z]*Error: )\[(?:heavy-lock|load-guard)\].*$/gm, toolValues],
  [/^[ \t]*RUN[ \t]+v\d[^ \t\r\n]*[ \t]+.*$/gm, volatileValues],
];

function withoutWorktree(text, worktree) {
  let out = text;
  for (const dir of [worktree].flat().filter(Boolean).sort((a, b) => b.length - a.length)) out = out.split(dir).join("<worktree>");
  return out;
}

function withoutTiming(text) {
  let out = text;
  for (const [span, to] of TIMING_SPANS) out = out.replace(span, to);
  return out;
}

/**
 * The digest's view of a message, or of a reason that quotes one: in this order, the
 * replay worktree (as given and as its realpath) → `<worktree>`; inside a RUNNER_LINES
 * line only (and before Vitest's `: expected` suffix), an absolute path under a temp root up to whitespace, a quote, a bracket, a
 * comma or a colon (so a `:line:col` stays) → `<tmp>`, an ISO-8601 date with a time →
 * `<timestamp>`, and `pid` and a number → `pid <pid>`; the timing inside a TIMING_SPANS
 * line → `<duration>` or `<timestamp>`. Nothing else changes, so assertion text, its
 * paths, timestamps, pids, durations, numbers and file:line locations stay bound.
 */
export function normaliseText(text, worktree) {
  if (typeof text !== "string") return text ?? null;
  let out = withoutWorktree(text, worktree);
  for (const [line, rewrite] of RUNNER_LINES) out = out.replace(line, (match) => beforeSuffix(match, rewrite));
  return withoutTiming(out);
}

/**
 * The digest's view of the replay's own error text, which no assertion wrote: the worktree
 * first, then temp paths, timestamps and pids anywhere in it, then the timing spans.
 */
export function normaliseRunnerText(text, worktree) {
  if (typeof text !== "string") return text ?? null;
  return withoutTiming(volatileValues(withoutWorktree(text, worktree)));
}

/**
 * The replay's digested part: result, reasons, and each id's status, kind, location and
 * message, normalised. The reasons at the `runner` indices take normaliseRunnerText.
 */
export function stableReplay(judged, worktree, runner = []) {
  const pick = (outcome) => ({ status: outcome.status, kind: outcome.kind ?? null, location: outcome.location ?? null, message: normaliseText(outcome.message ?? null, worktree) });
  return {
    result: judged.result, reasons: judged.reasons.map((reason, index) => (runner.includes(index) ? normaliseRunnerText : normaliseText)(reason, worktree)),
    ids: Object.fromEntries(Object.entries(judged.ids).map(([id, outcome]) => [id, { base: pick(outcome.base), head: pick(outcome.head) }])),
  };
}

/**
 * A pre-entry packet: the cases passing at base, or, when the base run did not complete
 * (timed out, killed, refused, no report, no compile), that cause and no case list.
 */
function preEntry({ id, receipt, files, base, head, headCls, baseRun, path, worktree }) {
  const completed = !baseRun.error && !baseRun.compileError;
  const passing = completed ? [...baseRun.outcomes].filter(([key, outcome]) => outcome.status === "passed" && (receipt.lane === "rust" || files.includes(JSON.parse(key)[0]))).map(([key]) => key).sort() : null;
  const baseRunRecord = { completed, error: baseRun.error ?? null, compileError: Boolean(baseRun.compileError) };
  const digestInput = {
    id, mode: "pre-entry", base, head, spec_blobs: Object.fromEntries(files.map((file) => [file, headCls.files.get(file)?.blob ?? null])),
    base_run: { completed, error: normaliseRunnerText(baseRunRecord.error, worktree), compileError: baseRunRecord.compileError }, passing_at_base: passing,
  };
  const digest = createHash("sha256").update(canonical(digestInput)).digest("hex");
  writeFileSync(path, `${JSON.stringify({ id, lane: receipt.lane, mode: "pre-entry", base, head, user_ruling_required: true, base_run: baseRunRecord, passing_at_base: passing, digest_input: digestInput, digest }, null, 2)}\n`);
  const cause = baseRun.error ?? "the tests did not compile at base";
  const summary = completed ? `${passing.length} case(s) pass at base` : `base run did not complete (${cause})`;
  process.stdout.write(`evidence: ${path}\nreplay: pre-entry receipt; ${summary}; user ruling required\ndigest: ${digest}\n`);
  return 1;
}

export function replay({ cwd, id, base: baseArg, expectDigest, receipt, pluginVersion, laneConfig }) {
  if (!receipt) throw usageError("No receipt has that id.");
  const entry = entryFor(withEvidenceLock(cwd, () => readEvidence(cwd)), receipt, pluginVersion);
  if (entry && resolveRef(cwd, entry.tests_tree.ref) !== entry.tests_tree.tree) throw usageError(`The pin ref ${entry.tests_tree.ref} is missing or moved; the evidence cannot be trusted.`);
  const head = git(cwd, ["rev-parse", "HEAD"]).stdout.trim();
  const baseRef = baseArg ?? (resolveRef(cwd, "refs/remotes/origin/master") ? "origin/master" : "master");
  const base = git(cwd, ["merge-base", baseRef, head]).stdout.trim();
  const baseCls = classifyAt(cwd, base), headCls = classifyAt(cwd, head);
  const files = Object.keys(receipt.test_files);
  const run = { lane: receipt.lane, files, laneCommand: entry?.lane_command ?? (receipt.lane === "rust" ? laneConfig("rust").command : null) };
  const locations = [...new Set((entry?.failures ?? []).map((failure) => failure.location?.file).filter(Boolean))];
  let worktree = [];
  const runs = withWorktree(cwd, head, id, (dir) => {
    worktree = [dir, realpathSync(dir)];
    const touched = restoreToBase(cwd, dir, base, head, baseCls, headCls);
    linkDependencies(cwd, dir, base, head);
    const baseRun = runTests(cwd, dir, run);
    const baseTexts = Object.fromEntries(locations.map((file) => [file, existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : null]));
    if (!entry) return { baseRun };
    restoreHead(dir, head, headCls, touched);
    return { baseRun, baseTexts, headRun: runTests(cwd, dir, run) };
  });
  const path = join(ensureDir(join(cwd, ".claude/tdd-guardian/evidence")), `${id}.json`);
  if (!entry) return preEntry({ id, receipt, files, base, head, headCls, baseRun: runs.baseRun, path, worktree });
  const { runner, ...judged } = judge(cwd, entry, runs.baseRun, runs.headRun, runs.baseTexts);
  const headTests = [...new Set([...headCls.tests, ...files])].sort();
  const headTestsTree = treeOf(cwd, headCls.files, headTests);
  const testDiff = git(cwd, ["diff-tree", "-p", "--no-renames", "--no-ext-diff", entry.tests_tree.tree, headTestsTree]).stdout;
  const changed = git(cwd, ["diff-tree", "-r", "-z", "--no-renames", "--name-only", base, head]).stdout.split("\0").filter(Boolean);
  const prodPaths = changed.filter((file) => !isPureTest(headCls, file) && !(!headCls.files.has(file) && isPureTest(baseCls, file)));
  const prodDiff = prodPaths.length ? git(cwd, ["diff-tree", "-p", "--no-renames", "--no-ext-diff", base, head, "--", ...prodPaths]).stdout : "";
  const digestInput = {
    id, recorded_at: entry.recorded_at, tests_tree: entry.tests_tree.tree, base, head, head_tests_tree: headTestsTree,
    spec_blobs: Object.fromEntries(files.map((file) => [file, headCls.files.get(file)?.blob ?? null])), replay: stableReplay(judged, worktree, runner),
  };
  const digest = createHash("sha256").update(canonical(digestInput)).digest("hex");
  writeFileSync(path, `${JSON.stringify({ id, lane: receipt.lane, mode: "entry", base, head, test_diff: testDiff, prod_diff: prodDiff, replay: judged, digest_input: digestInput, digest }, null, 2)}\n`);
  withEvidenceLock(cwd, () => updateEntry(cwd, id, { replay: { path: `.claude/tdd-guardian/evidence/${id}.json`, digest, result: judged.result, base, head } }));
  process.stdout.write(`evidence: ${path}\nreplay: ${judged.result}${judged.reasons.length ? `: ${judged.reasons.join("; ")}` : ""}\ndigest: ${digest}\n`);
  if (expectDigest && expectDigest !== digest) { process.stdout.write(`digest mismatch: expected ${expectDigest}, got ${digest}\n`); return 1; }
  return judged.result === "passed" ? 0 : 1;
}
