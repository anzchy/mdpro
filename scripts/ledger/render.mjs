#!/usr/bin/env node
/**
 * Purpose: Render `docs/feature-ledger.md` into a single self-contained
 * `docs/feature-ledger.html` — no runtime dependency, no network request, opens
 * straight from `file://`.
 *
 * Usage: node scripts/ledger/render.mjs
 *
 * Pipeline: read markdown → md.mjs → body HTML + headings → inline CSS/JS shell
 *           → write docs/feature-ledger.html
 *
 * Key decisions:
 * - Everything is inlined. A ledger that needs `pnpm dev` to be readable will
 *   be read by nobody; it has to survive being mailed as one file.
 * - The five state chips are emitted unconditionally, even at count 0, so the
 *   legend is stable across renders and a state dropping to zero is visible
 *   rather than silently missing.
 *
 * @module scripts/ledger/render
 * @coordinates-with scripts/ledger/md.mjs, scripts/ledger/template.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { escapeHtml, renderMarkdown } from "./md.mjs";
import { LEDGER_STATES } from "./parse.mjs";
import { LEDGER_CSS, LEDGER_JS } from "./template.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_REL = "docs/feature-ledger.md";
const OUTPUT_REL = "docs/feature-ledger.html";

/** Local wall-clock `YYYY-MM-DD HH:mm` — the subtitle is for humans, not sorting. */
function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

const chip = (state) =>
  `<button class="chip" type="button" data-state="${state}" aria-pressed="true">` +
  `<span class="dot"></span>${state}<span class="n">0</span></button>`;

const tocLink = (h) =>
  `<a class="lvl${h.level}" href="#${escapeHtml(h.anchor)}">${escapeHtml(h.text)}</a>`;

export function buildHtml(markdown, now = new Date()) {
  const { html, headings } = renderMarkdown(markdown);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>功能账簿 · mdpro</title>
<style>${LEDGER_CSS}</style>
</head>
<body>
<header class="top">
  <div class="brand">
    <h1>功能账簿</h1>
    <span class="sub">mdpro · 渲染于 ${escapeHtml(stamp(now))}</span>
  </div>
  <div class="controls">
    <input id="search" type="search" placeholder="搜索能力 / 状态 / 路径 / 确认方式（按 / 聚焦，Esc 清空）" aria-label="搜索账簿行" />
    ${LEDGER_STATES.map(chip).join("\n    ")}
    <span id="counter">0 / 0 行</span>
  </div>
</header>
<div class="layout">
  <nav class="toc" aria-label="目录">
    ${headings.map(tocLink).join("\n    ")}
  </nav>
  <main>
${html}
  </main>
</div>
<script>${LEDGER_JS}</script>
</body>
</html>
`;
}

function main() {
  const source = path.join(REPO_ROOT, SOURCE_REL);
  if (!fs.existsSync(source)) {
    console.error(`!! ${SOURCE_REL} 不存在，无法渲染。`);
    process.exit(1);
  }
  const markdown = fs.readFileSync(source, "utf8");
  const out = buildHtml(markdown);
  fs.writeFileSync(path.join(REPO_ROOT, OUTPUT_REL), out, "utf8");
  // 用字节而不是字符：正文是中文，UTF-8 下每字 3 字节，按 out.length 报会少算三成。
  const bytes = Buffer.byteLength(out, "utf8");
  console.log(`wrote ${OUTPUT_REL} (${(bytes / 1024).toFixed(1)} KB, 0 external requests)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
