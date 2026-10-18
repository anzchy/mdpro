// @vitest-environment node
/**
 * ADR-0047 WI-009 round-4 fixes (PR #500; the user ruled 「One more fix
 * round (Recommended)」 on H1 and H2 after round 3):
 * - H1: the script never unlinks the global single-instance socket. The
 *   preflight asks lsof who holds it (it never connects, so a live mdpro
 *   sees nothing); a socket our app leaves behind is a note, not a finding,
 *   since the plugin cleans a stale one up on the next launch.
 * - H2: signals go only through the ChildProcess handle, which Node clears
 *   when it reaps the child, so a reused pid cannot be reached.
 * - Fable M2: the stop retry and the run-dir removal never hide a finding.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { releaseClean } from "../../scripts/control/releaseClean.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { leftoverNote, SI_SOCK_RELEASE, siSockHeld } from "../../scripts/control/releaseCleanChecks.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { handleKill } from "../../scripts/control/releaseCleanStop.mjs";

const CONTROL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/control");
const CLEAN_TREE = 'tauri-app v0.3.5 (/repo/src-tauri)\ntauri-app feature "default"';

function deps(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const d = {
    cargoTree: () => CLEAN_TREE,
    distFiles: () => [{ path: "index.html", text: "<html>" }],
    binaryBytes: () => Buffer.from("app.launch"),
    mdproRunning: () => false,
    siSockExists: () => false,
    makeRun: () => "/t/run",
    placeOptin: () => {},
    launch: () => 501,
    waitReady: async () => {},
    lsof: () => ({ tcp: "", unix: `p501\nf20\nn${SI_SOCK_RELEASE}` }),
    stop: async () => (calls.push("stop"), { left: null }),
    listRun: () => ["control-optin.json"],
    removeRun: () => calls.push("removeRun"),
    ...over,
  };
  return { d, calls };
}

describe("H1: who holds the single-instance socket, from lsof alone", () => {
  it("sees a holder in a system-wide lsof -U listing", () => {
    expect(siSockHeld(`p77\nf5\nn${SI_SOCK_RELEASE}\np80\nf3\nn->0x1`)).toBe(true);
  });

  it("sees a holder under /private/tmp", () => {
    expect(siSockHeld(`p77\nf5\nn/private${SI_SOCK_RELEASE}`)).toBe(true);
  });

  it("sees no holder when nobody lists the path (a stale file)", () => {
    expect(siSockHeld("p80\nf3\nn->0x1\nf4\nn/tmp/other.sock")).toBe(false);
  });
});

describe("H1: a socket left after the run is a note, never a finding", () => {
  it("says plainly that our leftover is not a finding and the next launch cleans it up", () => {
    const note = leftoverNote("ours");
    expect(note).toContain(SI_SOCK_RELEASE);
    expect(note).toContain("not a finding");
    expect(note).toContain("the next mdpro launch cleans it up");
  });

  it("names a socket another process now holds, and leaves it", () => {
    const note = leftoverNote("other");
    expect(note).toContain("not a finding");
    expect(note).toContain("left untouched");
  });

  it("has no note when nothing was left", () => {
    expect(leftoverNote(null)).toBeNull();
  });

  it("prints the note without changing exit 0 or any layer's status", async () => {
    const { d } = deps({ stop: async () => ({ left: "ours" }) });
    const r = await releaseClean(d, { launch: true });
    expect(r.exit).toBe(0);
    expect(r.lines).toContain(leftoverNote("ours"));
    expect(r.layers.every((l: { status: string }) => l.status === "clean")).toBe(true);
    expect(r.lines.at(-1)).toBe("release-clean: all four layers clean");
  });

  it.each(["releaseCleanDeps.mjs", "releaseCleanStop.mjs", "releaseClean.mjs"])(
    "%s never unlinks or removes the socket",
    (file) => {
      const src = fs.readFileSync(path.join(CONTROL, file), "utf8");
      expect(src).not.toMatch(/unlink(Sync)?\(/);
      expect(src).not.toMatch(/rmSync\(SI_SOCK/);
    },
  );
});

describe("H2: signals only through the ChildProcess handle", () => {
  it("signals its own child", () => {
    const sent: string[] = [];
    const kill = handleKill({ pid: 501, kill: (sig: string) => (sent.push(sig), true) });
    expect(kill(501, "SIGTERM")).toBe(true);
    expect(sent).toEqual(["SIGTERM"]);
  });

  it("sends nothing to a pid that is not its child's", () => {
    const sent: string[] = [];
    const kill = handleKill({ pid: 501, kill: (sig: string) => (sent.push(sig), true) });
    expect(kill(777, "SIGKILL")).toBe(false);
    expect(sent).toEqual([]);
  });

  it("sends nothing when there is no child", () => {
    expect(handleKill(null)(501, "SIGTERM")).toBe(false);
  });

  it("cannot reach the pid once Node has reaped the child (real process)", async () => {
    const child = spawn("/usr/bin/true", [], { stdio: "ignore" });
    await new Promise((r) => child.on("exit", r));
    expect(handleKill(child)(child.pid as number, "SIGKILL")).toBe(false);
  });
});

describe("Fable M2: the stop retry and run-dir removal never hide a finding", () => {
  it("keeps the read's finding when the retried stop also throws, and still removes the run dir", async () => {
    const { d, calls } = deps({
      lsof: () => {
        throw new Error("lsof exited 2");
      },
      stop: async () => {
        calls.push("stop");
        throw new Error("pid 501: identity unknown, not signalled");
      },
    });
    const r = await releaseClean(d, { launch: true });
    expect(r.exit).toBe(1);
    expect(r.lines).toContain("layer 4: could not read: lsof exited 2");
    expect(r.lines).toContain("layer 4: could not stop the app: pid 501: identity unknown, not signalled");
    expect(calls.at(-1)).toBe("removeRun");
  });

  it("reports a run dir it could not remove", async () => {
    const { d } = deps({
      removeRun: () => {
        throw new Error("EACCES");
      },
    });
    const r = await releaseClean(d, { launch: true });
    expect(r.exit).toBe(1);
    expect(r.lines).toContain("layer 4: could not remove /t/run: EACCES");
  });
});
