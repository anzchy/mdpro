#!/usr/bin/env node
/**
 * @module scripts/design/d278-parity-compare
 * Purpose: D278 layer-2 evidence tool. It gates nothing: layer 1
 * (tests/d278-parity-values.test.ts) is the parity gate, and this only lists
 * what the browser run saw, for the record in docs/test/20261017-d278-parity.md.
 *
 *   node scripts/design/d278-parity-compare.mjs pixel <png>
 *     The centre pixel of a PNG as `rgb(r, g, b)` (8-bit RGB or RGBA,
 *     non-interlaced, as Chromium writes them).
 *   node scripts/design/d278-parity-compare.mjs bundle <label> <collector.jsonl> <png-dir>
 *     One JSON array: the page's collector reads, plus a pixel row per theme
 *     from <png-dir>/<label>-<theme>-progress.png.
 *   node scripts/design/d278-parity-compare.mjs diff <master.json> <head.json>
 *     A markdown table of every row × theme with both values, colours
 *     normalised (see `normalise`), then the differences. The exit code is
 *     always 0.
 */

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

function centrePixel(path) {
  const png = readFileSync(path);
  let pos = 8;
  let width = 0, height = 0, colourType = 0;
  const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit non-interlaced PNGs");
      colourType = data[9];
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const bpp = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  if (!bpp) throw new Error(`unsupported colour type ${colourType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const add = [0, a, b, (a + b) >> 1, paeth][filter];
      line[i] = (line[i] + add) & 0xff;
    }
    rows.push(line);
    prev = line;
  }
  const y = Math.floor(height / 2), x = Math.floor(width / 2);
  const px = rows[y].subarray(x * bpp, x * bpp + 3);
  return `rgb(${px[0]}, ${px[1]}, ${px[2]})`;
}

function bundle(label, jsonl, dir) {
  const rows = readFileSync(jsonl, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    const v = JSON.parse(l);
    return Array.isArray(v) ? v : [v];
  });
  for (const theme of ["root", "light", "dark"]) {
    rows.push({ id: "progress", theme, state: null, pseudo: "::-webkit-progress-value", property: "pixel (centre)", value: centrePixel(`${dir}/${label}-${theme}-progress.png`), status: "OK", via: "pixel" });
  }
  return rows;
}

/**
 * A computed value with every colour rewritten as `rgba(r, g, b, a)`, channels
 * 0–255 rounded and alpha to three places. A token built with `color-mix()`
 * computes to `color(srgb …)` where the literal it replaced computed to
 * `rgba(…)`; the two name the same colour, so the diff compares this form.
 */
function normalise(value) {
  const fmt = (r, g, b, a) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Number(Number(a).toFixed(3))})`;
  return value
    .replace(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/g, (_, r, g, b, a) => fmt(r * 255, g * 255, b * 255, a ?? 1))
    .replace(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/g, (_, r, g, b, a) => fmt(r, g, b, a ?? 1));
}

const key = (r) => [r.id, r.theme, r.state ?? "", r.pseudo ?? "", r.property ?? ""].join("|");
const show = (r) => (r === undefined ? "absent" : r.id === "reduced-motion" ? JSON.stringify(r.found) : r.status === "OK" ? normalise(r.value) : r.status);

function diff(masterPath, headPath) {
  const master = new Map(JSON.parse(readFileSync(masterPath, "utf8")).map((r) => [key(r), r]));
  const head = new Map(JSON.parse(readFileSync(headPath, "utf8")).map((r) => [key(r), r]));
  const keys = [...new Set([...master.keys(), ...head.keys()])];
  const lines = ["| Row | Theme | State / pseudo | Property | Via | Master | Head |", "|---|---|---|---|---|---|---|"];
  const differences = [];
  for (const k of keys) {
    const m = master.get(k), h = head.get(k);
    const r = m ?? h;
    const a = show(m), b = show(h);
    lines.push(`| ${r.id} | ${r.theme} | ${[r.state, r.pseudo].filter(Boolean).join(" ") || "—"} | ${r.property ?? "--motion-duration-fast"} | ${r.via} | \`${a}\` | \`${b}\` |`);
    if (a !== b) differences.push(`- ${r.id} · ${r.theme} · ${[r.state, r.pseudo].filter(Boolean).join(" ") || "—"} · ${r.property ?? ""}: \`${a}\` → \`${b}\``);
  }
  return `${lines.join("\n")}\n\nDifferences (${differences.length}):\n${differences.join("\n") || "- none"}\n`;
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "pixel") process.stdout.write(`${centrePixel(args[0])}\n`);
else if (mode === "bundle") process.stdout.write(`${JSON.stringify(bundle(args[0], args[1], args[2]), null, 1)}\n`);
else if (mode === "diff") process.stdout.write(diff(args[0], args[1]));
else {
  process.stderr.write("usage: pixel <png> | bundle <label> <jsonl> <png-dir> | diff <master.json> <head.json>\n");
  process.exitCode = 2;
}
