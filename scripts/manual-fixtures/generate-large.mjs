#!/usr/bin/env node
/**
 * Purpose: Regenerate the multi-MB manual (device-check) fixtures that are too
 * large to commit under `tests/manual-fixtures/` (CLAUDE.md § Manual test
 * fixtures: commit the generator, not the file).
 *
 * Each shape is a byte-faithful reproduction of the file the recorded device
 * runs actually opened, and `--check` asserts the recorded sha256 so a later
 * edit cannot silently change what "d12-above" means:
 *   - d12-table-below / d12-table-above — 4-column tables just under and over
 *     ADR-0022's 50 000 table-row Source guard (D12 device review, 2026-10-01).
 *   - d37-big-source / d37-big-wysiwyg — ~9 MB prose for D37.
 *   - d46-exactly-10mib / d46-over-10mib — the 10 MiB hard-reject boundary in
 *     `commands/file.rs` (3.8 exit retest, D46).
 *
 * Usage:
 *   node scripts/manual-fixtures/generate-large.mjs <out-dir> [--check]
 *
 * There is no default output directory: write into a session scratchpad, since
 * device runs edit and save the file (run on a copy, never on the original).
 * Node built-ins only.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MIB = 1024 * 1024;
const TEN_MIB = 10 * MIB;
const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ";
const LOREM_SENTENCE =
  "lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.";
const REJECT_LINE = "plain prose line for the 10 MiB rejection check\n";

function table(bodyRows) {
  const lines = ["| c0 | c1 | c2 | c3 |", "| --- | --- | --- | --- |"];
  for (let r = 0; r < bodyRows; r++) {
    lines.push(`| r${r}c0 | r${r}c1 | r${r}c2 | r${r}c3 |`);
  }
  return `${lines.join("\n")}\n`;
}

/** Exactly `bytes` long, always ending in "\n" (the last line is truncated). */
function repeatToBytes(line, bytes) {
  return `${line.repeat(Math.ceil(bytes / line.length) + 1).slice(0, bytes - 1)}\n`;
}

/** name → [build, recorded sha256]. Order does not affect output. */
const shapes = {
  "d12-table-below": [
    () => table(49_990),
    "61416fa63e62b5704a6b7efa6dd3a4d842d41aea061a2589fe81aeea4fa4454c",
  ],
  "d12-table-above": [
    () => table(50_010),
    "a7a1853cac41f2ce5a0911bbd143e05c84604e4a0c0575feb3a4ade46fa042cc",
  ],
  "d37-big-source": [
    () => {
      let s = "# D37 big file\n\n";
      for (let i = 0; i < 79_926; i++) s += `Paragraph ${i}: ${LOREM_SENTENCE}\n\n`;
      return s;
    },
    "6ac439d482585b11ff4ad21d0c6f7024c87a07e5e09e7407a922e4af20618295",
  ],
  "d37-big-wysiwyg": [
    () => {
      let s = "# D37 big wysiwyg\n\nCARET TARGET paragraph: put the caret after the word TARGET.\n\n";
      const body = LOREM.repeat(12);
      for (let i = 0; i < 10_000; i++) s += `P${i} ${body}\n\n`;
      return s;
    },
    "4405d48166c23e6e5ab4105c5adf791986da4d3f57ada0011872abdb1eac6180",
  ],
  "d46-exactly-10mib": [
    () => repeatToBytes(REJECT_LINE, TEN_MIB),
    "03a3d9bbb94b75078f80453021ca62cb4eaf3d18f8d73bdb52928cc3e561a0f8",
  ],
  "d46-over-10mib": [
    () => repeatToBytes(REJECT_LINE, TEN_MIB + 1),
    "2f7153cb639df2127749a9658b11144dab388c63841cc2bbebf5656504c3b295",
  ],
};

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const outArg = args.find((a) => !a.startsWith("--"));
  if (!outArg) {
    process.stderr.write("usage: generate-large.mjs <out-dir> [--check]\n");
    process.exit(2);
  }
  const out = resolve(outArg);
  mkdirSync(out, { recursive: true });

  let failed = 0;
  for (const [name, [build, expected]] of Object.entries(shapes)) {
    const content = build();
    writeFileSync(join(out, `${name}.md`), content, "utf8");
    const sha = createHash("sha256").update(content, "utf8").digest("hex");
    const ok = sha === expected;
    if (!ok) failed++;
    const mark = check ? (ok ? "ok" : "MISMATCH") : "";
    process.stdout.write(`${name}.md | ${Buffer.byteLength(content, "utf8")} B | ${sha} ${mark}\n`);
  }
  if (check && failed > 0) {
    process.stderr.write(`${failed} file(s) differ from the recorded sha256\n`);
    process.exit(1);
  }
}

main();
