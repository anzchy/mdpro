// @vitest-environment node
/**
 * Purpose: Pin the optional fixed build clock of `pnpm ledger:build`
 * (receipt D191-F-1). `render.mjs` stamps its wall clock into the HTML
 * subtitle, so a verifier could only compare a rebuild with the committed
 * `docs/feature-ledger.html` modulo that line. With `LEDGER_BUILD_TIME` set to
 * an ISO 8601 timestamp WITH a zone designator (`Z` or `±hh:mm`), the stamp is
 * that instant written in UTC as `YYYY-MM-DD HH:mm UTC`, so two builds of the
 * same markdown are byte-identical on any machine and in any TZ. Unset, the
 * stamp is the local wall clock as before. Set but invalid (unparseable, out
 * of range, zone-less, or empty) is an error exit that writes nothing.
 *
 * `render.mjs` writes next to itself, so every run here is on a copy of
 * `scripts/ledger/` in a temp root; the real `docs/feature-ledger.html` is
 * never written.
 *
 * @module tests/feature-ledger-build-time.test
 * @coordinates-with scripts/ledger/render.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { diff, inventory, ledger } from "./support/ledgerWindowsDiff";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = ledger([{ area: "文件", body: [...inventory("保存"), "", ...diff(["保存", "Unknown", ""])] }]);
const FIXED = "2026-10-13T08:30:00Z";

const tempRoots: string[] = [];
afterAll(() => {
  for (const dir of tempRoots) fs.rmSync(dir, { recursive: true, force: true });
});

/** A temp root with a copy of scripts/ledger/ and the fixture as the ledger markdown. */
function tempRepo(): string {
  const source = path.join(REPO_ROOT, "scripts/ledger");
  expect(fs.existsSync(path.join(source, "render.mjs")), "scripts/ledger/render.mjs is missing").toBe(true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdpro-d191-build-"));
  tempRoots.push(root);
  fs.cpSync(source, path.join(root, "scripts/ledger"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "docs/feature-ledger.md"), FIXTURE);
  return root;
}

/** Run the copied render.mjs; `buildTime` undefined means the variable is absent. */
function build(root: string, buildTime: string | undefined, tz = "UTC") {
  const env: NodeJS.ProcessEnv = { ...process.env, TZ: tz };
  delete env.LEDGER_BUILD_TIME;
  if (buildTime !== undefined) env.LEDGER_BUILD_TIME = buildTime;
  const run = spawnSync("node", ["scripts/ledger/render.mjs"], { cwd: root, encoding: "utf8", env });
  expect(run.error, `could not run the ledger build: ${run.error?.message}`).toBeUndefined();
  const out = path.join(root, "docs/feature-ledger.html");
  return { run, out, written: fs.existsSync(out) };
}

function readBuilt(root: string, buildTime: string | undefined, tz = "UTC"): Buffer {
  const { run, out, written } = build(root, buildTime, tz);
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  expect(written, "the build reported success but wrote no HTML").toBe(true);
  return fs.readFileSync(out);
}

describe("LEDGER_BUILD_TIME fixes the build stamp", () => {
  it("two builds with the same fixed time are byte-identical", () => {
    const a = readBuilt(tempRepo(), FIXED);
    const b = readBuilt(tempRepo(), FIXED);
    expect(a.equals(b)).toBe(true);
  });

  it("the stamp is the fixed instant written in UTC", () => {
    const html = readBuilt(tempRepo(), FIXED).toString("utf8");
    expect(html).toContain("渲染于 2026-10-13 08:30 UTC");
  });

  it("an offset timestamp is converted to UTC, and the machine's TZ does not change the bytes", () => {
    const shanghai = readBuilt(tempRepo(), "2026-10-13T16:30:00+08:00", "Asia/Shanghai");
    const newYork = readBuilt(tempRepo(), FIXED, "America/New_York");
    expect(shanghai.toString("utf8")).toContain("渲染于 2026-10-13 08:30 UTC");
    expect(shanghai.equals(newYork)).toBe(true);
  });
});

describe("without LEDGER_BUILD_TIME the behaviour is unchanged", () => {
  it("the output still carries a local wall-clock stamp, with no UTC suffix", () => {
    const html = readBuilt(tempRepo(), undefined).toString("utf8");
    expect(html).toMatch(/渲染于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}<\/span>/);
    expect(html).not.toContain(" UTC</span>");
  });
});

describe("an invalid LEDGER_BUILD_TIME is an error exit, not a silent fallback", () => {
  it.each([
    ["not a date", "yesterday"],
    ["out of range", "2026-13-45T00:00:00Z"],
    ["no zone designator (would be read as local time)", "2026-10-13T08:30:00"],
    ["date only", "2026-10-13"],
    ["set but empty", ""],
  ])("%s (%j) → non-zero exit, a message naming the variable, nothing written", (_why, value) => {
    const { run, written } = build(tempRepo(), value);
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain("LEDGER_BUILD_TIME");
    expect(written).toBe(false);
  });
});
