#!/usr/bin/env node
/**
 * Purpose: Deterministic generator for the large-document performance corpus
 * behind plan M's 「阶段 3 入口门禁二：大文档性能基线」.
 *
 * Why this file exists. The generator that produced the recorded baseline was
 * deliberately kept outside the repo under the throwaway-script convention, and
 * two defects in it were fixed *before* the measurement was taken. A seed alone
 * never determines output — the algorithm does — so the baseline was one
 * `$TMPDIR` sweep away from becoming a table of numbers nobody could re-derive,
 * and every "re-measure and compare against baseline × 1.2" exit criterion
 * would have become unexecutable. This file is that algorithm, in the repo.
 *
 * This is a BYTE-FAITHFUL port, not a rewrite. Every construct that influences
 * output bytes is preserved exactly as recovered, including the ones a fresh
 * implementation would have written differently (see "Preserved quirks"). It
 * reproduces plan M's recorded table exactly — all eleven byte counts and all
 * eleven heading counts — and `--check` asserts that on every run.
 *
 * Preserved quirks — DO NOT "fix" these; each one changes the output bytes and
 * would silently invalidate the recorded baseline:
 *   - The PRNG is a single stream shared by every file and never reset, so each
 *     file's bytes depend on how many files were generated before it. Adding,
 *     removing or reordering a shape rewrites every later file.
 *   - `seed * 1103515245` exceeds 2^53, so the multiply loses precision in
 *     IEEE-754 doubles. The LCG is therefore degenerate — but it is degenerate
 *     *identically* on every machine, since IEEE-754 and ToInt32 are both fully
 *     specified, which is all determinism requires here.
 *   - The WYSIWYG tier is `floor(0.45 * MiB)` = 471,859, not the "~460 KiB"
 *     plan M's prose rounds it to.
 *   - `large-table` subtracts `header.length` (UTF-16 units) from a budget
 *     measured in UTF-8 bytes; the CJK headers make those differ.
 *   - `very-long-line` ends with a trailing newline, so it splits into 4 lines,
 *     not the 3 plan M records.
 *
 * Determinism: no network, no clock, no PID, no locale, no filesystem ordering,
 * no `Math.random`. Node built-ins only — plan M's G0 gate forbids new
 * dependencies.
 *
 * Usage:
 *   node scripts/perf/generate-corpus.mjs [--out <dir>] [--check]
 *
 * Default output is `.perf-corpus/`, which is gitignored. The corpus is ~50 MiB
 * and is never committed; the generator is what gets committed.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MIB = 1024 * 1024;
/** Under the 10MB hard reject enforced in `commands/file.rs`. */
const SOURCE_TIER = Math.floor(9.5 * MIB); // 9,961,472
/** Under E39's 500 KiB WYSIWYG ceiling. */
const WYSIWYG_TIER = Math.floor(0.45 * MIB); // 471,859

/* ------------------------------------------------------------------- PRNG */

// Deterministic PRNG, seed recorded in plan M. Degenerate but reproducible;
// see "Preserved quirks" above.
let seed = 0x5eed;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const CJK = ["架构", "设计", "标题", "文档", "渲染", "解析", "性能", "基线", "导出", "契约"];
const ASCII = ["render", "parse", "export", "anchor", "heading", "token", "commit", "gate"];
const word = () => (rand() < 0.4 ? pick(CJK) : pick(ASCII));

/** Append chunks until the byte target is reached, overshooting to a chunk boundary. */
function buildTo(targetBytes, chunkFn) {
  const parts = [];
  let bytes = 0;
  let i = 0;
  while (bytes < targetBytes) {
    const chunk = chunkFn(i++);
    parts.push(chunk);
    bytes += Buffer.byteLength(chunk, "utf8");
  }
  return parts.join("");
}

/* ----------------------------------------------------------------- shapes */

const shapes = {
  // 普通长文: headings + prose, carrying duplicate headings on purpose so the
  // heading-identity work has something to bite on.
  //
  // Heading density is the first of the two recovered defect fixes. The first
  // version emitted a heading every ~135 bytes (73,910 in 9.96MB), which
  // measured the parser's heading path almost exclusively while being recorded
  // under the name 「普通长文」 — a number a later reader would have taken as
  // typical. One heading per 8 paragraphs (~3.3KB) is what a book-length
  // document looks like. The heading-dense extreme is not lost: dense-math
  // emits a `##` per formula and carries ~70k headings on its own.
  "normal-prose": (target) =>
    buildTo(target, (i) => {
      const level = "#".repeat((i % 6) + 1);
      const title = i % 7 === 0 ? "架构" : `${word()} ${word()} ${i}`;
      const paras = Array.from({ length: 8 }, () =>
        `${Array.from({ length: 60 }, word).join(" ")}。\n\n`).join("");
      return `${level} ${title}\n\n${paras}`;
    }),

  // 大表格: few nodes, enormous cell count.
  "large-table": (target) => {
    const header = `| ${["id", "名称", "value", "备注"].join(" | ")} |\n|---|:---:|---:|---|\n`;
    return header + buildTo(target - header.length, (i) =>
      `| ${i} | ${word()}${word()} | ${Math.floor(rand() * 1e6)} | ${word()} |\n`);
  },

  // 大量短节点: maximum node count per byte — stresses a ProseMirror mount
  // rather than the parser.
  "many-short-nodes": (target) =>
    buildTo(target, (i) => `- ${word()} ${i}\n`),

  // 超长单行: one enormous logical line. Exercises any line-splitting
  // assumption, including tocService's `split(/\r?\n/)`.
  "very-long-line": (target) => {
    const body = buildTo(target - 16, () => `${word()} `);
    return `# 超长单行\n\n${body}\n`;
  },

  // 密集数学: KaTeX load, both inline and display.
  "dense-math": (target) =>
    buildTo(target, (i) =>
      `## 公式 ${i}\n\n行内 $E_{${i}} = mc^2$ 与 $\\sum_{k=0}^{${i}} k^2$。\n\n` +
      `$$\\int_0^\\infty \\frac{x^{${i % 9}}}{e^x - 1}\\,dx = \\Gamma(${i % 9 + 1})\\zeta(${i % 9 + 1})$$\n\n`),
};

/* ------------------------------------------------- plan M's recorded table */

/**
 * Plan M's 「阶段 3 入口门禁二」 table. `--check` asserts the generated corpus
 * still reproduces it; a mismatch means the baseline numbers no longer describe
 * the corpus they were measured on.
 */
const RECORDED = {
  "normal-prose.source": [9961944, 3007],
  "large-table.source": [9961503, 0],
  "many-short-nodes.source": [9961474, 0],
  "very-long-line.source": [9961475, 1],
  "dense-math.source": [9961596, 70886],
  "normal-prose.wysiwyg": [473540, 143],
  "normal-prose-crlf.wysiwyg": [476114, 143],
  "large-table.wysiwyg": [471880, 0],
  "many-short-nodes.wysiwyg": [471867, 0],
  "very-long-line.wysiwyg": [471862, 1],
  "dense-math.wysiwyg": [471942, 3444],
};

/**
 * The ATX line regex the corpus's recorded heading counts were taken with.
 *
 * This USED TO mirror `tocService.ts` `parseHeadingsFromContent`. It no longer
 * does, and must not be re-synced: ADR-0012 replaced that function with a Lezer
 * walk over `@codemirror/lang-markdown`, which also recognises setext headings
 * and correctly ignores `#` lines inside fenced code. This regex sees neither.
 *
 * It is kept verbatim ON PURPOSE. The `RECORDED` counts above describe *the
 * corpus*, not the parser — they are a fingerprint asserting that these shape
 * functions still emit the same bytes, which is the only thing `--check` can
 * usefully prove. Swapping in the Lezer parser here would make `--check` fail
 * against a table it has no business re-deriving, would drag a `@codemirror`
 * import into a generator that is deliberately Node-built-ins-only (plan M's
 * G0 gate), and would make the fingerprint move whenever the parser moves —
 * destroying exactly the independence that makes it a fingerprint.
 *
 * As it happens the two agree on every file in this corpus (MEASURED, WI-7:
 * 3,007 / 143 / 3,444 from both), because none of the shapes emit a setext
 * heading or a fenced `#`. That agreement is a property of the corpus, not a
 * contract — do not rely on it.
 */
const ATX = /^(#{1,6})\s+(.+?)(?:\s+#*)?$/;

function countHeadings(content) {
  let n = 0;
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(ATX);
    if (m && m[2].trim()) n++;
  }
  return n;
}

/* -------------------------------------------------------------------- main */

function parseArgs(argv) {
  let out = ".perf-corpus";
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out = argv[++i];
    else if (argv[i] === "--check") check = true;
    else if (!argv[i].startsWith("--")) out = argv[i];
  }
  return { out: resolve(out), check };
}

function main() {
  const { out, check } = parseArgs(process.argv.slice(2));
  mkdirSync(out, { recursive: true });

  const results = [];
  const written = new Map();
  for (const [name, fn] of Object.entries(shapes)) {
    for (const [tier, target] of [["source", SOURCE_TIER], ["wysiwyg", WYSIWYG_TIER]]) {
      const content = fn(target);
      writeFileSync(join(out, `${name}.${tier}.md`), content, "utf8");
      written.set(`${name}.${tier}`, content);
      results.push([`${name}.${tier}`, `${name}.${tier}.md`, content]);
    }
  }

  // The CRLF variant must be the SAME document as its LF twin, differing only
  // in line endings, or it cannot isolate the cost of CRLF at all. This is the
  // second recovered defect fix: re-invoking the shape function does NOT do
  // that, because the shared PRNG has already advanced — the first version
  // produced 3,533 headings against the LF twin's 3,527, making the pair
  // useless as a control. Derive it from the exact bytes already written.
  const crlf = written.get("normal-prose.wysiwyg").replace(/\n/g, "\r\n");
  writeFileSync(join(out, "normal-prose.wysiwyg.crlf.md"), crlf, "utf8");
  results.push(["normal-prose-crlf.wysiwyg", "normal-prose.wysiwyg.crlf.md", crlf]);

  const manifest = results.map(([key, file, content]) => ({
    key,
    file,
    bytes: Buffer.byteLength(content, "utf8"),
    lines: content.split(/\r?\n/).length,
    headings: countHeadings(content),
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
  }));

  // Basenames only and no timestamp, so the manifest is itself byte-identical
  // across runs and across output directories.
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  process.stdout.write(`corpus: ${out}\nseed: 0x5eed\n\n`);
  process.stdout.write("file | bytes | lines | headings | sha256\n");
  for (const m of manifest) {
    process.stdout.write(`${m.file} | ${m.bytes} | ${m.lines} | ${m.headings} | ${m.sha256}\n`);
  }

  if (check) {
    const failures = [];
    for (const m of manifest) {
      const rec = RECORDED[m.key];
      if (!rec) {
        failures.push(`${m.key}: not in plan M's recorded table`);
        continue;
      }
      if (m.bytes !== rec[0]) failures.push(`${m.key}: bytes ${m.bytes} != recorded ${rec[0]}`);
      if (m.headings !== rec[1]) failures.push(`${m.key}: headings ${m.headings} != recorded ${rec[1]}`);
    }
    process.stdout.write("\n");
    if (failures.length) {
      for (const f of failures) process.stdout.write(`MISMATCH ${f}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`OK: reproduces plan M's recorded table (${manifest.length}/${manifest.length})\n`);
    }
  }
}

main();
