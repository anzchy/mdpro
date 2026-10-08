// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-1: the run-dir layout, run naming, length budget,
 * `launch.json` body and child env (`scripts/control/runDir.mjs`, pure), plus
 * the launcher's default deps (`scripts/control/launchDeps.mjs`).
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, WI-1, R-01..R-22.
 *
 * Literals (suffix, budget 103, reasons) are pinned here, never imported.
 * Every path is a literal; nothing here touches the real home.
 */
import crypto, { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkBudget,
  childEnv,
  launchJsonBody,
  layout,
  runName,
  runsParent,
  SOCKET_PATH_BUDGET,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/control/runDir.mjs";
import {
  defaultDeps,
  newNonce,
  newRunName,
  resolveRunsParent,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/control/launchDeps.mjs";
import { bytes, int, mulberry32, pick, str } from "./support/seededRandom";

const SUFFIX = "/Library/Application Support/mdpro-verify/runs";
const NAME_RE = /^[0-9a-z]{25}$/;
const CONTROL_DIR = path.resolve(__dirname, "..", "scripts", "control");
const RESERVED = ["HOME", "CFFIXED_USER_HOME", "MDPRO_VERIFY_RUN", "MDPRO_VERIFY_NONCE"];

type Env = Record<string, string>;
type Layout = Record<string, string>;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Decodes a base36 name (decodes only; does not re-implement the encoder). */
function decodeBase36(name: string): bigint {
  let n = 0n;
  for (const c of name) {
    const d = parseInt(c, 36);
    if (Number.isNaN(d)) throw new Error(`bad digit ${c}`);
    n = n * 36n + BigInt(d);
  }
  return n;
}
const bytesToBigInt = (b: Uint8Array): bigint =>
  b.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);

function deepFreeze<T extends object>(o: T): T {
  for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runDir#runsParent", () => {
  it("R-01 builds the parent from the given passwd home", () => {
    expect(runsParent("/Users/jackcheng")).toBe(
      "/Users/jackcheng/Library/Application Support/mdpro-verify/runs",
    );
    expect(runsParent("/Users/a")).toBe("/Users/a/Library/Application Support/mdpro-verify/runs");
  });

  it("R-02 a contaminated HOME does not nest the new run", () => {
    const deps = { passwdHome: "/Users/jackcheng" };
    vi.stubEnv("HOME", `/Users/jackcheng${SUFFIX}/0abc0abc0abc0abc0abc0abc0`);
    const a = resolveRunsParent(deps);
    vi.stubEnv("HOME", "/tmp");
    const b = resolveRunsParent(deps);
    expect(a).toBe(`/Users/jackcheng${SUFFIX}`);
    expect(b).toBe(a);
    expect(a).not.toContain("runs/0abc");
  });

  it("R-03 a relative or empty passwd home is refused", () => {
    for (const home of ["", "Users/x", "./x"]) {
      expect(() => runsParent(home)).toThrow(/^passwd home must be absolute$/);
    }
  });

  it("R-04 the default dep is the passwd home, not $HOME", () => {
    vi.stubEnv("HOME", "/tmp/not-home");
    const home = defaultDeps().passwdHome;
    expect(home).toBe(os.userInfo().homedir);
    expect(home).not.toBe("/tmp/not-home");
  });
});

describe("runDir#runName", () => {
  it("R-05 round-trips 1000 random 16-byte inputs (seed 2026100801)", () => {
    const r = mulberry32(2026100801);
    for (let i = 0; i < 1000; i++) {
      const b = bytes(r, 16);
      const name = runName(b);
      expect(name, `seed 2026100801 index ${i}`).toMatch(NAME_RE);
      expect(decodeBase36(name), `seed 2026100801 index ${i}`).toBe(bytesToBigInt(b));
    }
  });

  it("R-06 encodes the domain boundaries", () => {
    expect(runName(new Uint8Array(16))).toBe("0".repeat(25));
    const max = runName(new Uint8Array(16).fill(0xff));
    expect(max).toMatch(NAME_RE);
    expect(max[0]).not.toBe("0");
    expect(decodeBase36(max)).toBe(2n ** 128n - 1n);
  });

  it("R-07 a wrong byte count is refused", () => {
    expect(() => runName(new Uint8Array(15))).toThrow(/^runName needs 16 random bytes$/);
    expect(() => runName(new Uint8Array(17))).toThrow(/^runName needs 16 random bytes$/);
  });

  it("R-08 real-crypto names are unique, in charset and within budget", () => {
    const deps = { randomBytes: crypto.randomBytes };
    const parent = runsParent("/Users/jackcheng");
    const names: string[] = Array.from({ length: 1000 }, () => newRunName(deps));
    expect(new Set(names).size).toBe(1000);
    for (const name of names) {
      expect(name).toMatch(NAME_RE);
      expect(Buffer.byteLength((layout(parent, name) as Layout).ctlSocket)).toBeLessThanOrEqual(103);
    }
  });

  it("R-22 the default randomness is the real CSPRNG, and nonces are unique", () => {
    expect(defaultDeps().randomBytes).toBe(crypto.randomBytes);
    const nonces: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const deps = defaultDeps();
      const name: string = newRunName(deps);
      const nonce: string = newNonce(deps);
      expect(nonce).toMatch(/^[0-9a-f]{64}$/);
      expect(nonce).not.toBe("0".repeat(64));
      expect(nonce).not.toBe(sha(name));
      nonces.push(nonce);
    }
    expect(new Set(nonces).size).toBe(1000);
  });
});

describe("runDir#checkBudget", () => {
  const over = { ok: false, reason: "run path budget exceeded: 104 > 103 bytes" };

  it("R-09 sits exactly on the 103-byte boundary", () => {
    expect(SOCKET_PATH_BUDGET).toBe(103);
    expect(checkBudget("/Users/" + "a".repeat(15))).toEqual({ ok: true, total: 103 });
    expect(checkBudget("/Users/" + "a".repeat(16))).toEqual(over);
  });

  it("R-10 measures a multibyte home in bytes", () => {
    expect(checkBudget("/Users/" + "é".repeat(8))).toEqual(over);
  });

  it("R-11 the real user's home fits, and the reason never contains the path", () => {
    expect(checkBudget("/Users/jackcheng")).toEqual({ ok: true, total: 97 });
    const res = checkBudget("/Users/" + "secretname".repeat(3));
    expect(res.ok).toBe(false);
    expect(res.reason).not.toContain("secretname");
  });

  it("R-12 is monotonic over home byte length 1..60 (seed 2026100802)", () => {
    const r = mulberry32(2026100802);
    for (let target = 1; target <= 60; target++) {
      for (let rep = 0; rep < 5; rep++) {
        let home = "/";
        while (Buffer.byteLength(home) < target) {
          const room = target - Buffer.byteLength(home);
          home += room >= 2 && r() < 0.3 ? "é" : pick(r, [..."abcdefghijklmnopqrstuvwxyz"]);
        }
        const len = Buffer.byteLength(home);
        expect(checkBudget(home).ok, `seed 2026100802 home bytes ${len}`).toBe(len <= 22);
      }
    }
  });
});

describe("runDir#layout", () => {
  it("R-13 gives the exact layout for one run", () => {
    const R = "/P/runs/0123456789abcdefghijklmno";
    const AS = `${R}/Library/Application Support/mdpro`;
    expect(layout("/P/runs", "0123456789abcdefghijklmno")).toEqual({
      runDir: R,
      launchJson: `${R}/launch.json`,
      instanceJson: `${R}/instance.json`,
      ownerJson: `${R}/owner.json`,
      stderrLog: `${R}/launcher-stderr.log`,
      launcherLog: `${R}/launcher.jsonl`,
      prefsDir: `${R}/.mdpro`,
      prefs: `${R}/.mdpro/config.json`,
      appLog: `${R}/.mdpro/mdpro.log`,
      appSupport: AS,
      serverPort: `${AS}/server.port`,
      drafts: `${AS}/drafts`,
      ctlSocket: `${R}/ctl.sock`,
      lock: "/P/runs/.lock",
      siSock: "/tmp/com_mdpro_app_verify_si.sock",
    });
  });

  it("R-14 keeps every guard-read path inside the run dir (seed 2026100803)", () => {
    const r = mulberry32(2026100803);
    for (let i = 0; i < 200; i++) {
      const segs = Array.from({ length: int(r, 1, 5) }, () => str(r, "abcdefghijklmnopqrstuvwxyz", 1, 10));
      const parent = "/" + segs.join("/");
      const L = layout(parent, runName(bytes(r, 16))) as Layout;
      const msg = `seed 2026100803 index ${i}`;
      for (const [key, p] of Object.entries(L)) {
        if (key === "lock" || key === "siSock" || key === "runDir") continue;
        const rel = path.relative(L.runDir, p);
        expect(rel, `${msg} ${key}`).not.toBe("");
        expect(rel.startsWith(".."), `${msg} ${key}`).toBe(false);
        expect(path.isAbsolute(rel), `${msg} ${key}`).toBe(false);
      }
      expect(L.lock).toBe(parent + "/.lock");
      expect(Object.isFrozen(L)).toBe(true);
    }
  });

  it("R-15 no launcher module writes instance.json", () => {
    const re = /runDir|launch|quit|clean|doctor|lock|procFacts|ownership|launcherFormat/;
    const files = fs.readdirSync(CONTROL_DIR).filter((f) => f.endsWith(".mjs") && re.test(f));
    expect(files).toContain("runDir.mjs");
    const offending: string[] = [];
    for (const f of files) {
      fs.readFileSync(path.join(CONTROL_DIR, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/write\w*\([^)]*instanceJson/.test(line) || /open\w*\([^)]*instanceJson[^)]*["'](w|wx|a)/.test(line)) {
            offending.push(`${f}:${i + 1}: ${line}`);
          }
        });
    }
    expect(offending).toEqual([]);
  });

  it("refuses a run name outside [0-9a-z]{25} (added)", () => {
    for (const bad of ["../x", "", "0123456789ABCDEFGHIJKLMNO", "0".repeat(24), "0".repeat(26)]) {
      expect(() => layout("/P/runs", bad)).toThrow(/^invalid run name$/);
    }
  });
});

describe("runDir#launchJsonBody", () => {
  const A = { nonce: "a".repeat(64), buildId: "b1", mainBinary: "/x/tauri-app" };
  const B = { nonce: "f0".repeat(32), buildId: "zz", mainBinary: "/y/tauri-app" };

  it("R-16 has exactly the three keys with the given values", () => {
    for (const input of [A, B]) {
      const body = launchJsonBody(input);
      expect(Object.keys(body).sort()).toEqual(["buildId", "mainBinary", "nonce"]);
      expect(body).toStrictEqual({ ...input });
    }
  });

  it("R-17 refuses a missing or non-string field, naming it", () => {
    for (const field of ["nonce", "buildId", "mainBinary"] as const) {
      for (const bad of ["", undefined, 42]) {
        let msg = "";
        try {
          launchJsonBody({ ...A, [field]: bad });
        } catch (e) {
          msg = e instanceof Error ? e.message : String(e);
        }
        expect(msg, `${field}=${String(bad)}`).toBe(`launch.json field ${field} must be a non-empty string`);
        expect(msg).not.toContain(A.nonce);
      }
    }
  });
});

describe("runDir#childEnv", () => {
  const R = "/private/var/folders/xy/T/lh-1/r";
  const nonce = "c".repeat(64);

  it("R-18 sets the four keys exactly and leaves a frozen baseEnv unchanged", () => {
    const raw = { PATH: "/usr/bin", HOME: "/Users/old", MDPRO_VERIFY_RUN: "/stale", LANG: "en_US.UTF-8" };
    const before = structuredClone(raw);
    const baseEnv = deepFreeze(raw);
    const out = childEnv({ baseEnv, runDirReal: R, nonce });
    expect(out).toStrictEqual({
      PATH: "/usr/bin",
      LANG: "en_US.UTF-8",
      HOME: R,
      CFFIXED_USER_HOME: R,
      MDPRO_VERIFY_RUN: R,
      MDPRO_VERIFY_NONCE: nonce,
    });
    expect(out).not.toBe(baseEnv);
    expect(baseEnv).toStrictEqual(before);
  });

  it("R-19 overrides only the four keys and mutates nothing (seed 2026100804)", () => {
    const r = mulberry32(2026100804);
    const procBefore = structuredClone({ ...process.env });
    for (let i = 0; i < 300; i++) {
      const baseEnv: Env = {};
      for (let k = int(r, 0, 20); k > 0; k--) {
        const key = r() < 0.2 ? pick(r, RESERVED) : str(r, "ABCDEFGHIJKLMNOPQRSTUVWXYZ_", 1, 8);
        baseEnv[key] = str(r, "abc/:.= ", 0, 12);
      }
      const snapshot = structuredClone(baseEnv);
      const out = childEnv({ baseEnv: Object.freeze(baseEnv), runDirReal: R, nonce }) as Env;
      const msg = `seed 2026100804 index ${i}`;
      for (const k of Object.keys(baseEnv)) {
        if (!RESERVED.includes(k)) expect(out[k], `${msg} ${k}`).toBe(baseEnv[k]);
      }
      expect(out.HOME).toBe(R);
      expect(out.CFFIXED_USER_HOME).toBe(R);
      expect(out.MDPRO_VERIFY_RUN).toBe(R);
      expect(out.MDPRO_VERIFY_NONCE).toBe(nonce);
      expect(new Set(Object.keys(out)), msg).toEqual(new Set([...Object.keys(baseEnv), ...RESERVED]));
      expect(baseEnv, msg).toStrictEqual(snapshot);
    }
    expect(structuredClone({ ...process.env })).toEqual(procBefore);
  });

  it("R-20 refuses a runDirReal that canonicalize() would rewrite", () => {
    const call = (runDirReal: string) => () => childEnv({ baseEnv: {}, runDirReal, nonce });
    expect(call("rel/r")).toThrow(/^runDirReal must be absolute$/);
    for (const p of ["/a/b/", "/a//b", "/a/./b", "/a/x/../b"]) {
      expect(call(p), p).toThrow(/^runDirReal must be canonical$/);
    }
  });

  it("R-21 no control script assigns the four variables in process.env", () => {
    const patterns = [
      /process\.env(\.|\[["'])(HOME|CFFIXED_USER_HOME|MDPRO_VERIFY_RUN|MDPRO_VERIFY_NONCE)["']?\]?\s*=(?!=)/,
      /process\.env\s*\[[^\]"']+\]\s*=(?!=)/,
      /Object\.assign\(\s*process\.env/,
      /process\.env\s*=(?!=)/,
      /delete\s+process\.env/,
    ];
    const files = fs.readdirSync(CONTROL_DIR).filter((f) => f.endsWith(".mjs"));
    expect(files).toEqual(expect.arrayContaining(["runDir.mjs", "launchDeps.mjs"]));
    const offending: string[] = [];
    for (const f of files) {
      fs.readFileSync(path.join(CONTROL_DIR, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (patterns.some((p) => p.test(line))) offending.push(`${f}:${i + 1}: ${line}`);
        });
    }
    expect(offending).toEqual([]);
  });
});
