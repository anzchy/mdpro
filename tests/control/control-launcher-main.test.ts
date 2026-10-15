// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-9: `launcherCli.main` — the parse → run → exit mapping
 * every verb shim goes through. Added during green (after the RX-07 red) to
 * cover the branches the one real-process run in `control-launcher-cli.test.ts`
 * cannot reach in-process: usage → 2, run's exit passed through, a thrown
 * error → 1 with a redacted `verdict: driver failure` line. Also the
 * `launcherLog#append` refusals: a non-`launcher.` event and a missing run dir
 * both return false and create nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { appendLog } from "../../scripts/control/launcherLog.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { main, processIo, runIfMain, SYNOPSIS, UsageError } from "../../scripts/control/launcherCli.mjs";

const io = (run: (a: unknown, d: unknown) => Promise<{ exit: number }>) => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { run, out: (l: string) => out.push(l), err: (l: string) => err.push(l), repoRoot: "/Users/u/r", homeDir: "/Users/u" } };
};

describe("WI-9 launcherCli#main", () => {
  it("a usage error: exit 2, reason on stderr, usage line last on stdout, run never called", async () => {
    let called = false;
    const h = io(async () => ((called = true), { exit: 0 }));
    expect(await main("clean", [], h.io)).toBe(2);
    expect(called).toBe(false);
    expect(h.err).toEqual(["clean: needs exactly one run"]);
    expect(h.out.at(-1)).toBe(`usage: ${SYNOPSIS.clean}`);
  });

  it("passes parsed args to run and returns its exit; stdout is path-redacted", async () => {
    let seen: unknown;
    const h = io(async (a, d) => {
      seen = a;
      (d as { out: (l: string) => void }).out("at /Users/u/r/x and /Users/u/y");
      return { exit: 1 };
    });
    expect(await main("quit", ["--", "r".repeat(25)], h.io)).toBe(1);
    expect(seen).toEqual({ run: "r".repeat(25) });
    expect(h.out).toEqual(["at ./x and ~/y"]);
  });

  it("a thrown error: exit 1, a driver-failure verdict with paths redacted", async () => {
    const h = io(async () => {
      throw new Error("ENOENT /Users/u/r/missing");
    });
    expect(await main("doctor", [], h.io)).toBe(1);
    expect(h.out.at(-1)).toBe("verdict: driver failure — ENOENT ./missing");
  });

  it("UsageError carries the synopsis and the reason", () => {
    const e = new UsageError("quit", "why");
    expect(e.message).toBe(`usage: ${SYNOPSIS.quit}`);
    expect(e.reason).toBe("why");
    expect(e.name).toBe("UsageError");
  });

  it("processIo: the repo root and home, two writers", () => {
    const p = processIo();
    expect(p.repoRoot).toMatch(/feat-adr0047|mdpro/);
    expect(typeof p.homeDir).toBe("string");
    expect(p.out).toBeTypeOf("function");
    expect(p.err).toBeTypeOf("function");
  });

  it("runIfMain is false when the module is not the entry", () => {
    expect(runIfMain("file:///not/the/entry.mjs", "doctor", async () => ({ exit: 0 }))).toBe(false);
  });
});

describe("WI-9 launcherLog#append refusals", () => {
  it("a non-launcher event, a missing event and a missing run dir write nothing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llog-"));
    try {
      const file = path.join(dir, "launcher.jsonl");
      expect(appendLog(file, { event: "app.launch" })).toBe(false);
      expect(appendLog(file, {} as { event: string })).toBe(false);
      expect(fs.existsSync(file)).toBe(false);
      const gone = path.join(dir, "no-run", "launcher.jsonl");
      expect(appendLog(gone, { event: "launcher.x" })).toBe(false);
      expect(fs.existsSync(path.dirname(gone))).toBe(false);
      expect(appendLog(file, { event: "launcher.x", n: "s3cret" }, { secrets: ["s3cret"], now: () => 7 })).toBe(true);
      expect(fs.readFileSync(file, "utf8")).toBe('{"t":7,"event":"launcher.x","n":"<redacted>"}\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
