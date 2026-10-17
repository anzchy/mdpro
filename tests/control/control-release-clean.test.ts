// @vitest-environment node
/**
 * ADR-0047 WI-009 WI 5: the release clean check's orchestration (plan item
 * 10). Every read is an injected dep, so these cases pin the order, the
 * fail-closed exits and the layer 4 refusals without a release bundle.
 * Exit 0 only when all four layers ran clean; 1 on any finding; 2 when
 * layers 1–3 are clean and layer 4 did not run (it runs only with --launch,
 * on the Mac mini: delegator relay of the user's choice, 2026-10-17).
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { releaseClean } from "../../scripts/control/releaseClean.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { SI_SOCK_RELEASE } from "../../scripts/control/releaseCleanChecks.mjs";

const CLEAN_TREE = 'tauri-app v0.3.5 (/repo/src-tauri)\ntauri-app feature "default"';
const CLEAN_TCP = "p501\nf12\nn127.0.0.1:51234";
const CLEAN_UNIX = `p501\nf20\nn${SI_SOCK_RELEASE}`;

function deps(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const d = {
    cargoTree: () => CLEAN_TREE,
    distFiles: () => [{ path: "index.html", text: "<html>" }],
    binaryBytes: () => Buffer.from("app.launch"),
    mdproRunning: () => false,
    siSockExists: () => false,
    makeRun: () => (calls.push("makeRun"), "/t/run"),
    placeOptin: (dir: string) => calls.push(`placeOptin ${dir}`),
    launch: (dir: string) => (calls.push(`launch ${dir}`), 501),
    waitReady: async (pid: number) => void calls.push(`waitReady ${pid}`),
    lsof: (pid: number) => (calls.push(`lsof ${pid}`), { tcp: CLEAN_TCP, unix: CLEAN_UNIX }),
    stop: async (pid: number) => void calls.push(`stop ${pid}`),
    listRun: (dir: string) => (calls.push(`listRun ${dir}`), ["control-optin.json"]),
    removeRun: (dir: string) => calls.push(`removeRun ${dir}`),
    ...over,
  };
  return { d, calls };
}

describe("without --launch", () => {
  it("is incomplete (exit 2) when layers 1–3 are clean, and touches no launch dep", async () => {
    const { d, calls } = deps();
    const r = await releaseClean(d, { launch: false });
    expect(r.exit).toBe(2);
    expect(r.lines).toContain("layer 4: not run (pass --launch, on the Mac mini)");
    expect(calls).toEqual([]);
  });

  it("exits 1 when a layer has a finding", async () => {
    const { d } = deps({ binaryBytes: () => Buffer.from("x mdpro-control y") });
    const r = await releaseClean(d, { launch: false });
    expect(r.exit).toBe(1);
    expect(r.lines).toContain("layer 3: the binary contains mdpro-control");
  });

  it("treats a read that throws as a finding, not as clean", async () => {
    const { d } = deps({
      cargoTree: () => {
        throw new Error("cargo exited 101");
      },
    });
    const r = await releaseClean(d, { launch: false });
    expect(r.exit).toBe(1);
    expect(r.lines).toContain("layer 1: could not read: cargo exited 101");
  });
});

describe("with --launch", () => {
  it("runs the release app on a run dir with the opt-in, in order, and exits 0 when all is clean", async () => {
    const { d, calls } = deps();
    const r = await releaseClean(d, { launch: true });
    expect(r.exit).toBe(0);
    expect(calls).toEqual([
      "makeRun",
      "placeOptin /t/run",
      "launch /t/run",
      "waitReady 501",
      "lsof 501",
      "stop 501",
      "listRun /t/run",
      "removeRun /t/run",
    ]);
  });

  it.each([
    ["mdproRunning", "layer 4: refused: an mdpro process is running"],
    ["siSockExists", `layer 4: refused: ${SI_SOCK_RELEASE} exists`],
  ])("refuses when %s, before making a run dir", async (dep, line) => {
    const { d, calls } = deps({ [dep]: () => true });
    const r = await releaseClean(d, { launch: true });
    expect(r.exit).toBe(1);
    expect(r.lines).toContain(line);
    expect(calls).toEqual([]);
  });

  it("still stops the app and removes the run dir when a listener is unexpected", async () => {
    const { d, calls } = deps({ lsof: () => ({ tcp: CLEAN_TCP, unix: `${CLEAN_UNIX}\nf21\nn/t/run/ctl.sock` }) });
    const r = await releaseClean(d, { launch: true });
    expect(r.exit).toBe(1);
    expect(r.lines).toContain("layer 4: unexpected socket /t/run/ctl.sock");
    expect(calls).toContain("stop 501");
    expect(calls.at(-1)).toBe("removeRun /t/run");
  });

  it("names a handoff file the app left in the run dir", async () => {
    const { d } = deps({ listRun: () => ["control-optin.json", "control.json"] });
    const r = await releaseClean(d, { launch: true });
    expect(r.exit).toBe(1);
    expect(r.lines).toContain("layer 4: the app wrote control.json");
  });

  it("stops the app when it never becomes ready", async () => {
    const { d, calls } = deps({
      waitReady: async () => {
        throw new Error("no single-instance socket after 30 s");
      },
    });
    const r = await releaseClean(d, { launch: true });
    expect(r.exit).toBe(1);
    expect(r.lines).toContain("layer 4: could not read: no single-instance socket after 30 s");
    expect(calls).toContain("stop 501");
    expect(calls).not.toContain("lsof 501");
  });

  it("removes the run dir and stops nothing when the launch itself fails", async () => {
    const { d, calls } = deps({
      launch: () => {
        throw new Error("spawn ENOENT");
      },
    });
    const r = await releaseClean(d, { launch: true });
    expect(r.exit).toBe(1);
    expect(r.lines).toContain("layer 4: could not read: spawn ENOENT");
    expect(calls.some((c) => c.startsWith("stop"))).toBe(false);
    expect(calls.at(-1)).toBe("removeRun /t/run");
  });

  it("reports layers 1–3 findings alongside a clean layer 4", async () => {
    const { d } = deps({ distFiles: () => [] });
    const r = await releaseClean(d, { launch: true });
    expect(r.exit).toBe(1);
    expect(r.lines).toContain("layer 2: dist has no files");
    expect(r.lines).toContain("layer 4: clean");
  });
});
