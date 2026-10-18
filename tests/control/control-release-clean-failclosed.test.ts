// @vitest-environment node
/**
 * ADR-0047 WI-009 round-1 audit fixes (Codex M1, M2 on PR #500): the release
 * clean check fails closed on what the first version let through.
 * - M1: the verdict comes from each layer's status, never from its text, so
 *   a read that throws a message ending in ": clean" is still a finding.
 * - M2: layer 4 must see the single-instance socket it waited for, so a
 *   header-only lsof listing is a finding; and an lsof that exits 1 with
 *   anything on stderr is a failure, not an empty listing.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { releaseClean } from "../../scripts/control/releaseClean.mjs";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { listenerFinding, lsofOutput, SI_SOCK_RELEASE } from "../../scripts/control/releaseCleanChecks.mjs";

const CLEAN_TREE = 'tauri-app v0.3.5 (/repo/src-tauri)\ntauri-app feature "default"';

function deps(over: Record<string, unknown> = {}) {
  return {
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
    stop: async () => {},
    listRun: () => ["control-optin.json"],
    removeRun: () => {},
    ...over,
  };
}

describe("M1: the verdict reads statuses, not text", () => {
  it.each([
    ["cargoTree", 1],
    ["distFiles", 2],
    ["binaryBytes", 3],
  ])("a %s that throws 'probe: clean' is a finding", async (dep, n) => {
    const r = await releaseClean(
      deps({
        [dep]: () => {
          throw new Error("probe: clean");
        },
      }),
      { launch: true },
    );
    expect(r.exit).toBe(1);
    expect(r.layers.find((l: { layer: number }) => l.layer === n).status).toBe("finding");
  });

  it("a layer 4 read that throws 'probe: clean' is a finding", async () => {
    const r = await releaseClean(
      deps({
        lsof: () => {
          throw new Error("probe: clean");
        },
      }),
      { launch: true },
    );
    expect(r.exit).toBe(1);
    expect(r.layers.find((l: { layer: number }) => l.layer === 4).status).toBe("finding");
  });

  it("reports one status per layer: clean, or not-run for layer 4 without --launch", async () => {
    const r = await releaseClean(deps(), { launch: false });
    expect(r.layers.map((l: { layer: number; status: string }) => [l.layer, l.status])).toEqual([
      [1, "clean"],
      [2, "clean"],
      [3, "clean"],
      [4, "not-run"],
    ]);
    expect(r.exit).toBe(2);
  });
});

describe("M2: layer 4 must observe what it waited for", () => {
  it("names a header-only Unix listing (the audit's probe) as a finding", () => {
    expect(listenerFinding("", "p501\n")).toBe(`layer 4: lsof did not list ${SI_SOCK_RELEASE}`);
  });

  it("accepts the single-instance socket under /private/tmp", () => {
    expect(listenerFinding("", `p501\nf20\nn/private${SI_SOCK_RELEASE}`)).toBeNull();
  });

  it("fails the whole check on the audit's probe input", async () => {
    const r = await releaseClean(deps({ lsof: () => ({ tcp: "", unix: "p501\n" }) }), { launch: true });
    expect(r.exit).toBe(1);
    expect(r.lines).toContain(`layer 4: lsof did not list ${SI_SOCK_RELEASE}`);
  });

  it("takes stdout from an lsof that exited 0", () => {
    expect(lsofOutput({ status: 0, stdout: "p501\n", stderr: "" })).toBe("p501\n");
  });

  it("takes an exit 1 with nothing on stderr as an empty listing", () => {
    expect(lsofOutput({ status: 1, stdout: "", stderr: "" })).toBe("");
  });

  it.each([
    [{ status: 1, stdout: "", stderr: "lsof: WARNING: can't stat() ..." }, "lsof exited 1: lsof: WARNING: can't stat() ..."],
    [{ status: 2, stdout: "", stderr: "" }, "lsof exited 2"],
    [{ status: null, stdout: "", stderr: "" }, "lsof exited null"],
  ])("throws on %j", (result, message) => {
    expect(() => lsofOutput(result)).toThrow(message);
  });
});
