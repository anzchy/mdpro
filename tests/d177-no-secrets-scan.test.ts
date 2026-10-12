// @vitest-environment node
/**
 * D177: nothing under scripts/device/hooks/ carries the MacBook's Tailscale
 * address, a tailnet name, a hard-coded token header value, or the real hook
 * token. The token check runs only where ~/.mdpro-redesign/hooks/token exists,
 * and a failure names files only, never the value.
 *
 * tests/ is excluded from the address check on purpose: the builder test uses
 * a made-up 100.x literal to prove it gets dropped.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOOKS_DIR, REPO_ROOT } from "./support/d177Hooks";

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__pycache__" ? [] : walk(p);
    return e.isFile() ? [p] : [];
  });
}

const rel = (f: string) => path.relative(REPO_ROOT, f);
const hookFiles = () => walk(HOOKS_DIR);
const d177Tests = () =>
  fs
    .readdirSync(path.join(REPO_ROOT, "tests"))
    .filter((n) => n.startsWith("d177-"))
    .map((n) => path.join(REPO_ROOT, "tests", n))
    .concat(
      fs
        .readdirSync(path.join(REPO_ROOT, "tests", "support"))
        .filter((n) => n.startsWith("d177"))
        .map((n) => path.join(REPO_ROOT, "tests", "support", n)),
    );

/** 100.64.0.0/10: 100.64.x.x through 100.127.x.x. */
const CGNAT = /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/;
const TAILNET_NAME = /\.ts\.net\b/i;
const TOKEN_LITERAL = /["']?X-Mdpro-Token["']?\s*:\s*["'][^"']+["']/i;

function offenders(files: string[], test: (text: string) => boolean): string[] {
  return files.filter((f) => test(fs.readFileSync(f, "utf8"))).map(rel);
}

describe("D177 no-secrets scan of scripts/device/hooks/", () => {
  it("the pipeline files exist", () => {
    const names = hookFiles().map((f) => path.basename(f));
    expect(names).toEqual(
      expect.arrayContaining(["receiver.py", "push.mjs", "pushCore.mjs", "build-mini-settings.mjs", "wait-dtrack.sh", "last-dtrack.sh"]),
    );
    expect(names).not.toContain("build-mini-settings.py");
  });

  it("no file holds a 100.64.0.0/10 address", () => {
    expect(offenders(hookFiles(), (t) => CGNAT.test(t))).toEqual([]);
  });

  it("no file holds a .ts.net name", () => {
    expect(offenders(hookFiles(), (t) => TAILNET_NAME.test(t))).toEqual([]);
  });

  it("no file assigns a literal X-Mdpro-Token header value", () => {
    expect(offenders(hookFiles(), (t) => TOKEN_LITERAL.test(t))).toEqual([]);
  });

  it("the regexes catch what they claim to (self-check)", () => {
    expect(CGNAT.test("url = 'http://100.101.5.6:8787/hook'")).toBe(true);
    expect(CGNAT.test("http://100.63.1.1/")).toBe(false);
    expect(CGNAT.test("http://100.128.1.1/")).toBe(false);
    expect(TAILNET_NAME.test("macbook.tail1234.ts.net")).toBe(true);
    expect(TOKEN_LITERAL.test('"headers": {"X-Mdpro-Token": "abc"}')).toBe(true);
    expect(TOKEN_LITERAL.test('headers: { "X-Mdpro-Token": token }')).toBe(false);
  });

  const tokenFile = path.join(os.homedir(), ".mdpro-redesign", "hooks", "token");
  it.skipIf(!fs.existsSync(tokenFile))("the real hook token appears in no hook file and no D177 test", () => {
    const secret = fs.readFileSync(tokenFile, "utf8").trim();
    if (secret.length === 0) return;
    expect(offenders([...hookFiles(), ...d177Tests()], (t) => t.includes(secret))).toEqual([]);
  });
});
