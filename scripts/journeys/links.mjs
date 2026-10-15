/**
 * Purpose: The files a live (non-draft) journey cites: its Tier-0 and Rust
 * tests exist and name it on their first line, every test that names a
 * journey is listed by that journey (the link is two-way, plan §4.3), the
 * projection file parses with a `projectionVersion`, and each fixture's
 * `fixture.json` holds (via `fixtures.mjs`).
 *
 * Key decisions:
 * - Back-reference lines are exact: `// Tier-0 for EJ-NNN` and
 *   `// Rust golden for EJ-NNN` (delegator ruling Q-c, 2026-10-15). A Tier-0
 *   file may put it on line 2 when line 1 is the `// @vitest-environment`
 *   marker, which ADR-0049 requires first.
 * - The reverse scan reads only the first two lines of each candidate:
 *   `tests/**` test files and `src-tauri/src/**` Rust files.
 *
 * @module scripts/journeys/links
 * @coordinates-with scripts/journeys/catalogue.mjs, scripts/journeys/fixtures.mjs
 */
import fs from "node:fs";
import path from "node:path";

import { checkFixture } from "./fixtures.mjs";

const TIER0_RE = /^\/\/ Tier-0 for (EJ-\d{3})\s*$/;
const RUST_RE = /^\/\/ Rust golden for (EJ-\d{3})\s*$/;
const ENV_RE = /^\/\/ @vitest-environment\b/;

const finding = (rule, message, file) => ({ severity: "error", rule, message, file });

/** The journey id a test file names, read from its first lines, or null. */
function backref(text, kind) {
  const [first = "", second = ""] = text.split(/\r?\n/, 2);
  if (kind === "rust") return RUST_RE.exec(first)?.[1] ?? null;
  return TIER0_RE.exec(first)?.[1] ?? (ENV_RE.test(first) ? (TIER0_RE.exec(second)?.[1] ?? null) : null);
}

function walk(root, rel, keep, acc = []) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return acc;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "target") walk(root, child, keep, acc);
    } else if (keep(entry.name)) acc.push(child);
  }
  return acc;
}

/** @returns {object[]} link findings for the parsed journeys under `root` */
export function checkLinks(root, parsed) {
  const out = [];
  const live = parsed.filter((j) => j.meta.status !== "draft");
  const listed = { tier0: new Map(), rust: new Map() };

  for (const j of live) {
    const { id } = j.meta;
    for (const kind of ["tier0", "rust"]) {
      for (const rel of j.meta[kind] ?? []) {
        listed[kind].set(rel, id);
        const abs = path.join(root, rel);
        if (!fs.existsSync(abs)) {
          out.push(finding("journey-test-missing", `${id} cites ${rel}, which does not exist`, j.rel));
        } else if (backref(fs.readFileSync(abs, "utf8"), kind) !== id) {
          const want = kind === "rust" ? `// Rust golden for ${id}` : `// Tier-0 for ${id}`;
          out.push(finding("journey-test-backref", `${rel} must start with "${want}"`, j.rel));
        }
      }
    }
    checkProjection(root, j, out);
    for (const fixture of j.meta.fixtures ?? []) {
      out.push(...checkFixture(root, fixture).map((f) => ({ ...f, file: j.rel })));
    }
  }

  const candidates = [
    ...walk(root, "tests", (n) => /\.test\.tsx?$/.test(n)).map((rel) => ["tier0", rel]),
    ...walk(root, "src-tauri/src", (n) => n.endsWith(".rs")).map((rel) => ["rust", rel]),
  ];
  for (const [kind, rel] of candidates) {
    const id = backref(fs.readFileSync(path.join(root, rel), "utf8"), kind);
    if (id !== null && listed[kind].get(rel) !== id) {
      out.push(finding("journey-test-backref", `${rel} names ${id}, but ${id} does not list it under \`${kind}\``, rel));
    }
  }
  return out;
}

function checkProjection(root, j, out) {
  const rel = j.meta.projection;
  const abs = path.join(root, rel);
  const fail = (why) => out.push(finding("journey-projection", `${j.meta.id}: ${rel} ${why}`, j.rel));
  if (!fs.existsSync(abs)) return fail("does not exist");
  let value;
  try {
    value = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (error) {
    return fail(`is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Number.isInteger(value?.projectionVersion) || value.projectionVersion < 1) {
    return fail("needs a positive integer `projectionVersion`");
  }
  if (value.events === null || typeof value.events !== "object" || Array.isArray(value.events)) {
    fail("needs an `events` object");
  }
}
