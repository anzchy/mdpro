/**
 * Purpose: Parse a RED or replay run into per-test outcomes (ADR-0145 d1, ADR-0149 d1):
 * Vitest JSON and libtest text → Map<id, {status, kind, location, message}>.
 *
 * Ids: Vitest `JSON.stringify([file, ...ancestorTitles, title])` (a space-joined fullName
 * is ambiguous across ancestor boundaries); a file that failed to collect is `[file]`.
 * libtest `<target>::<name>`, where the target is the test binary's stem without its hash
 * (or `doctest:<crate>`), because one name can exist in several targets.
 *
 * Key decisions:
 * - Kind `assertion` only for an `AssertionError` (vitest `expect`, chai, node:assert) or
 *   a failed `expect.assertions` count; any other throw is `panic`. libtest: `assert*!`
 *   and `should_panic` mismatches are `assertion`, every other panic is `panic`; exit
 *   output with no test block but a compiler error is `compileError`.
 * - The location is the first stack frame under `tests/` (Vitest) or libtest's
 *   `panicked at` path, repo-relative. Messages lose ANSI SGR and the absolute repo
 *   prefix, and are capped at MESSAGE_CAP characters.
 * - libtest's stdout blocks and cargo's stderr `Running`/`Doc-tests` lines are piped
 *   apart, so they are paired by order; a count mismatch refuses rather than guesses.
 * @coordinates-with scripts/tdd/red-receipt.mjs, scripts/tdd/receipt-replay.mjs
 */
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { usageError } from "./unit-red-lane.mjs";

const MESSAGE_CAP = 2000;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI SGR is the point
const SGR = /\u001b\[[0-9;]*m/g;
const SKIPPED = new Set(["skipped", "pending", "todo"]);
const VITEST_ASSERTION = /^(?:AssertionError\b|Error: expected number of assertions to be )/;
const RUST_ASSERTION = /assertion `left [=!]= right` failed|assertion failed:|panic did not contain expected string|did not panic as expected/;

function clean(text, cwd) {
  const plain = String(text ?? "").replace(SGR, "").split(`${cwd}/`).join("");
  return plain.trim().slice(0, MESSAGE_CAP);
}

/** Repo-relative path of a stack frame or panic location, or null outside the repo. */
function repoPath(raw, cwd) {
  const path = raw.startsWith("file://") ? fileURLToPath(raw) : raw;
  if (!isAbsolute(path)) return path;
  const rel = relative(cwd, path);
  return rel.startsWith("..") ? null : rel;
}

function vitestLocation(text, cwd) {
  for (const match of String(text).replace(SGR, "").matchAll(/^\s+at (?:.*\()?((?:file:\/\/)?\/[^():]+):(\d+):\d+\)?$/gm)) {
    const file = repoPath(match[1], cwd);
    if (file && file.startsWith("tests/")) return { file, line: Number(match[2]) };
  }
  return null;
}

function add(outcomes, id, outcome) {
  if (outcomes.has(id)) throw usageError(`Duplicate test id in the run: ${id}.`);
  outcomes.set(id, outcome);
}

/** Per-test outcomes of a Vitest JSON report. */
export function vitestOutcomes(report, cwd) {
  if (!report || !Array.isArray(report.testResults)) throw usageError("Vitest JSON report is malformed.");
  const outcomes = new Map();
  for (const suite of report.testResults) {
    const file = repoPath(String(suite.name || ""), cwd);
    if (!file || !Array.isArray(suite.assertionResults)) throw usageError("Vitest JSON report is malformed.");
    if (typeof suite.message === "string" && suite.message.trim()) {
      add(outcomes, JSON.stringify([file]), { status: "failed", kind: "collect", location: null, message: clean(suite.message, cwd) });
    }
    for (const test of suite.assertionResults) {
      const id = JSON.stringify([file, ...(test.ancestorTitles || []), test.title]);
      if (test.status === "passed") add(outcomes, id, { status: "passed", kind: null, location: null, message: "" });
      else if (SKIPPED.has(test.status)) add(outcomes, id, { status: "skipped", kind: null, location: null, message: "" });
      else if (test.status === "failed") {
        const text = String((test.failureMessages || [])[0] ?? "").replace(SGR, "");
        const head = text.split(/\n\s+at /)[0];
        add(outcomes, id, { status: "failed", kind: VITEST_ASSERTION.test(head) ? "assertion" : "panic", location: vitestLocation(text, cwd), message: clean(head, cwd) });
      } else throw usageError(`Unknown Vitest status ${test.status} for ${id}.`);
    }
  }
  return outcomes;
}

function targetOf(line) {
  const running = /^\s*Running (?:unittests )?\S+ \((?:.*\/)?([^/()]+?)(?:-[0-9a-f]{16})?\)\s*$/.exec(line);
  if (running) return running[1];
  const doc = /^\s*Doc-tests (\S+)\s*$/.exec(line);
  return doc ? `doctest:${doc[1]}` : null;
}

function rustPath(raw, cwd) {
  const path = repoPath(raw, cwd);
  if (!path) return null;
  return path.startsWith("src-tauri/") || isAbsolute(raw) ? path : `src-tauri/${path}`;
}

function sections(block) {
  const found = new Map();
  const parts = block.split(/^---- (.+?) stdout ----$/m);
  for (let index = 1; index < parts.length; index += 2) found.set(parts[index], parts[index + 1].split(/^failures:$/m)[0]);
  return found;
}

function rustFailure(body, cwd) {
  const at = /panicked at (.+?):(\d+):\d+:\n/.exec(body);
  const rest = (at ? body.slice(at.index + at[0].length) : body).split("\n");
  const kept = [];
  for (const line of rest) {
    if (/^note: run with `RUST_BACKTRACE/.test(line)) break;
    if (!line.trim() && kept.length) break;
    if (line.trim()) kept.push(line);
  }
  return {
    status: "failed",
    kind: RUST_ASSERTION.test(body) ? "assertion" : "panic",
    location: at ? (() => { const file = rustPath(at[1], cwd); return file ? { file, line: Number(at[2]) } : null; })() : null,
    message: clean(kept.join("\n"), cwd),
  };
}

/** Per-test outcomes of a cargo test run, from its separate stdout and stderr text. */
export function libtestOutcomes(stdout, stderr, cwd) {
  const out = String(stdout ?? "").replace(SGR, "").replace(/\r/g, "");
  const err = String(stderr ?? "").replace(SGR, "").replace(/\r/g, "");
  const targets = err.split("\n").map(targetOf).filter(Boolean);
  const blocks = out.split(/^running \d+ tests?$/m).slice(1);
  if (!blocks.length) {
    return { outcomes: new Map(), compileError: /^error(?:\[E\d+\])?:/m.test(err) || /could not compile/.test(err) };
  }
  if (blocks.length !== targets.length) throw usageError(`Cannot pair ${blocks.length} libtest blocks with ${targets.length} cargo Running lines.`);
  const outcomes = new Map();
  blocks.forEach((block, index) => {
    const failures = sections(block);
    for (const match of block.matchAll(/^test (.+?)(?: - should panic)? \.\.\. (ok|FAILED|ignored)\b.*$/gm)) {
      const id = `${targets[index]}::${match[1]}`;
      if (match[2] === "ok") add(outcomes, id, { status: "passed", kind: null, location: null, message: "" });
      else if (match[2] === "ignored") add(outcomes, id, { status: "skipped", kind: null, location: null, message: "" });
      else add(outcomes, id, rustFailure(failures.get(match[1]) ?? "", cwd));
    }
  });
  return { outcomes, compileError: false };
}

/** The failed outcomes as sidecar records, sorted by id. */
export function failuresOf(outcomes) {
  return [...outcomes].filter(([, outcome]) => outcome.status === "failed")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([id, outcome]) => ({ id, kind: outcome.kind, location: outcome.location, message: outcome.message }));
}
