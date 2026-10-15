// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-9: redaction and the launcher log.
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, "Unit:
 * launcherFormat#redact" (RX-01..RX-03) and "Unit: launcherLog#append"
 * (RX-04, RX-05). RX-08 / RX-09 live in `control-launcher-secrets.test.ts`.
 *
 * Laws pinned here: no known secret survives any formatter; `redact` is
 * idempotent; every `launcher.jsonl` line is a `launcher.*` JSON event with
 * no nonce; a full launch → quit → clean cycle writes nothing into the
 * everyday app's state paths. The marker `<redacted>` is pinned as a literal.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { launchFixture, logLines, LSTART, MAIN, NONCE, walk, type Fixture } from "../support/launchHarness";
import { fakeProcFacts, scriptedProcFacts, timedKill } from "../support/launcherFakes";
import { bytes, int, mulberry32, pick, str, type Rng } from "../support/seededRandom";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import * as fmt from "../../scripts/control/launcherFormat.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as launchRun } from "../../scripts/control/launch.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as quitRun } from "../../scripts/control/quit.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { run as cleanRun } from "../../scripts/control/clean.mjs";

const MARK = "<redacted>";
const HEX = "0123456789abcdef";
const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const count = (s: string, sub: string) => s.split(sub).length - 1;
const nonceOf = (r: Rng) => Buffer.from(bytes(r, 32)).toString("hex");
const tokenOf = (r: Rng) => str(r, TOKEN_CHARS, 32, 64);
type Opts = { secrets: string[]; repoRoot?: string; homeDir?: string };
type Format = (...a: unknown[]) => string | string[];

let fixtures: Fixture[] = [];
afterEach(() => {
  for (const fx of fixtures) fx.cleanup();
  fixtures = [];
});

describe("WI-9 launcherFormat formatters", () => {
  const NAMES = [
    "formatVerdict",
    "formatReady",
    "formatDriverFailure",
    "formatOpenArgvError",
    "formatQuitRefusal",
    "formatCleanRefusal",
    "formatDoctorLines",
    "formatError",
  ];
  it.each(NAMES)("%s is exported", (name) => {
    expect(fmt[name]).toBeTypeOf("function");
  });

  it("RX-01 secrets never survive any verb's formatter (200 pairs, seed 2026100808)", () => {
    for (const name of NAMES) expect(fmt[name], name).toBeTypeOf("function");
    const f = fmt as Record<string, Format>;
    const r = mulberry32(2026100808);
    for (let i = 0; i < 200; i++) {
      const nonce = nonceOf(r);
      const token = tokenOf(r);
      const opts: Opts = { secrets: [nonce, token] };
      const argv = ["-n", "--env", `MDPRO_VERIFY_NONCE=${nonce}`, "--env", `X_TOKEN=${token}`, "-a", "/b.app", "/f.md"];
      const sites: [string, string | string[], number][] = [
        ["ready", f.formatReady({ run: `run-${nonce}`, pid: token }, opts), 2],
        ["driver failure", f.formatDriverFailure(`launch.json ${JSON.stringify({ nonce, token })}`, opts), 2],
        ["open argv", f.formatOpenArgvError(argv, opts), 2],
        ["quit refusal", f.formatQuitRefusal([`nonce ${nonce}`, `token ${token}`], opts), 2],
        ["clean refusal", f.formatCleanRefusal([`launchJson ${nonce}`, `owner ${token}`], opts), 2],
        ["doctor", f.formatDoctorLines([`[FAIL] manifest readable: token ${token}`, `  next: ${nonce}`], opts), 2],
        ["error", f.formatError(new Error(`boom ${token} at ${nonce}`), opts), 2],
        ["verdict", f.formatVerdict("fail", `nonce ${nonce}`, opts), 1],
      ];
      for (const [site, raw, n] of sites) {
        const text = Array.isArray(raw) ? raw.join("\n") : raw;
        expect(typeof text, site).toBe("string");
        expect(text, site).not.toContain(nonce);
        expect(text, site).not.toContain(token);
        expect(count(text, MARK), site).toBe(n);
      }
    }
  });

  it("formatters keep their pinned shapes", () => {
    for (const name of NAMES) expect(fmt[name], name).toBeTypeOf("function");
    const f = fmt as Record<string, Format>;
    const o: Opts = { secrets: [] };
    expect(f.formatVerdict("pass", undefined, o)).toBe("verdict: pass");
    expect(f.formatVerdict("NOT VERIFIED", undefined, o)).toBe("verdict: NOT VERIFIED");
    expect(f.formatVerdict("fail", "x", o)).toBe("verdict: fail — x");
    expect(f.formatVerdict("bogus", "x", o)).toBe("verdict: driver failure — bad verdict kind");
    expect(f.formatDriverFailure("handshake timeout", o)).toBe("verdict: driver failure — handshake timeout");
    expect(f.formatReady({ run: "r".repeat(25), pid: 4242 }, o)).toBe(`ready: L1 run ${"r".repeat(25)} pid 4242`);
    expect(f.formatOpenArgvError(["-n", "-a", "/b.app"], o)).toBe("open failed: open -n -a /b.app");
    expect(f.formatQuitRefusal(["nonce", "pid"], o)).toBe("verdict: fail — ownership: nonce, pid");
    expect(f.formatCleanRefusal(["lock"], o)).toBe("verdict: fail — ownership: lock");
    expect(f.formatDoctorLines(["[pass] a", "verdict: pass"], o)).toEqual(["[pass] a", "verdict: pass"]);
    expect(f.formatError(new Error("e1"), o)).toBe("verdict: driver failure — e1");
    expect(f.formatError("plain", o)).toBe("verdict: driver failure — plain");
    const paths = { secrets: [], repoRoot: "/Users/u/r", homeDir: "/Users/u" };
    expect(f.formatDriverFailure("missing /Users/u/r/x and /Users/u/y", paths)).toBe("verdict: driver failure — missing ./x and ~/y");
  });
});

describe("WI-9 launcherFormat#redact", () => {
  it("RX-02 overlap, empty and path cases", () => {
    expect(fmt.redact("x abcdef y abc", { secrets: ["abc", "abcdef"] })).toBe("x <redacted> y <redacted>");
    expect(fmt.redact("hello", { secrets: [""] })).toBe("hello");
    expect(fmt.redact("/Users/jackcheng/r/src", { repoRoot: "/Users/jackcheng/r", homeDir: "/Users/jackcheng", secrets: [] })).toBe("./src");
  });

  it("RX-03 idempotence property (300 texts, seed 2026100809)", () => {
    const r = mulberry32(2026100809);
    for (let i = 0; i < 300; i++) {
      const homeDir = `/Users/${str(r, "abcdefghij", 3, 8)}`;
      const repoRoot = `${homeDir}/${str(r, "abcdefghij", 1, 6)}`;
      const secrets = [nonceOf(r), tokenOf(r), str(r, HEX, 32, 64)];
      const parts = [...secrets, `${homeDir}/x`, `${repoRoot}/src`, MARK, "~", ".", " ", "verdict: fail — ", homeDir, repoRoot];
      const text = Array.from({ length: int(r, 1, 12) }, () => pick(r, parts)).join(pick(r, ["", " ", "/"]));
      const opts = { secrets, repoRoot, homeDir };
      const once = fmt.redact(text, opts);
      expect(fmt.redact(once, opts), text).toBe(once);
      for (const s of secrets) expect(once).not.toContain(s);
    }
  });
});

/** A launched run R (LA-01) plus quit deps whose pid 4242 dies on SIGTERM (QU-03). */
async function launched() {
  const fx = launchFixture();
  fixtures.push(fx);
  const r = await launchRun({ file: "/tmp/f.md" }, fx.deps);
  expect(r.exit).toBe(0);
  const kill = timedKill(fx.clock.now);
  const procFacts = scriptedProcFacts((pid) =>
    pid === 4242 ? { alive: !kill.signalsTo(pid).includes("SIGTERM"), lstart: LSTART, exe: MAIN } : undefined,
  );
  const quitDeps = { passwdHome: fx.home, procFacts, kill, now: fx.clock.now, sleep: fx.clock.sleep, out: fx.deps.out, err: fx.deps.err };
  const cleanDeps = {
    passwdHome: fx.home,
    uid: process.getuid?.(),
    siSockPath: `/tmp/lsi-${process.pid}-absent.sock`,
    procFacts: fakeProcFacts({ scan: [] }),
    out: fx.deps.out,
    err: fx.deps.err,
  };
  return { fx, quit: () => quitRun({ run: fx.name }, quitDeps), clean: () => cleanRun({ run: fx.name }, cleanDeps) };
}

describe("WI-9 launcherLog#append", () => {
  it("RX-04 launcher.jsonl lines after a full fake launch (LA-01 then QU-03)", async () => {
    const { fx, quit } = await launched();
    const q = await quit();
    expect(q.exit).toBe(0);
    const lines = logLines(fx.lay.runDir);
    for (const e of lines) {
      expect(typeof e.event).toBe("string");
      expect(e.event.startsWith("launcher.")).toBe(true);
    }
    const events = lines.map((e) => e.event);
    expect(events).toContain("launcher.launch");
    expect(events).toContain("launcher.quit");
    expect(fs.readFileSync(fx.lay.launcherLog, "utf8")).not.toContain(NONCE);
  });

  it("RX-05 a full cycle under a fixture passwd home writes nothing into app-state paths", async () => {
    const { fx, quit, clean } = await launched();
    expect((await quit()).exit).toBe(0);
    expect((await clean()).exit).toBe(0);
    expect(fs.existsSync(path.join(fx.home, ".mdpro"))).toBe(false);
    expect(fs.existsSync(path.join(fx.home, "Library", "Application Support", "mdpro"))).toBe(false);
    const root = path.join("Library", "Application Support", "mdpro-verify");
    const ancestors = ["Library", path.join("Library", "Application Support"), root];
    for (const rel of walk(fx.real)) {
      expect(ancestors.includes(rel) || rel.startsWith(root + path.sep), rel).toBe(true);
    }
  });
});
