// @vitest-environment node
/**
 * D338 K1, activation on the verified input context: `setLayout` with `klid:"00000407"` loads
 * the layout without activating it, posts the request to A's focused input child (111, thread 9),
 * and succeeds only after an independent read of thread 9 equals the loaded HKL. It reports the
 * requested KLID and the loaded, before and observed HKLs with the owner, input and thread. A
 * second request for an active layout sends nothing. `layout` reads the same input thread, and
 * every physical scan is preceded by a thread-9 read of that exact HKL. The owner's outer thread
 * and the driver's thread are never changed. Production ui.ps1 under pwsh with Win32 doubles.
 */
import { describe, expect, it, vi } from "vitest";
import { runNative } from "./windows-driver-native-harness";
import { CN, DE, US, finalHkl, hex, identity, layoutScene, requests, runLayout, scans } from "./windows-driver-native-layout-harness";

vi.setConfig({ testTimeout: 60_000 });

const ACTIVATED = `setLayout requested=00000407 loaded=${hex(DE)} before=${hex(CN)} observed=${hex(DE)} owner=101 input=111 thread=9`;
const ALREADY = `setLayout requested=00000407 loaded=${hex(DE)} before=${hex(DE)} observed=${hex(DE)} owner=101 input=111 thread=9`;

function expectScansOnInputThread(trace: string[]) {
  expect(scans(trace).length).toBe(4);
  for (const [index, line] of trace.entries()) {
    if (!line.startsWith("scan:")) continue;
    const read = trace.slice(0, index).filter((entry) => entry.startsWith("observe:hkl:")).at(-1);
    expect(read, `HKL read before ${line}`).toMatch(new RegExp(`:9:${DE}$`));
  }
}

describe("D338 K1 setLayout activates the layout on the verified input thread", () => {
  it("labelled A: requested, loaded, before and observed values, an idempotent repeat and a physical chord on thread 9", async () => {
    const layout = layoutScene();
    const result = await runLayout([
      { op: "setLayout", window: "A", klid: "00000407", _identity: identity },
      { op: "layout", window: "A", _identity: identity },
      { op: "setLayout", window: "A", klid: "00000407", _identity: identity },
      { op: "physicalChord", window: "A", keys: ["AltRight", "KeyQ"], hkl: hex(DE), nofocus: true, _identity: identity },
    ], layout);
    expect(result.status, result.log.join("\n") + result.stderr).toBe(0);
    expect(result.log).toContain(ACTIVATED);
    expect(result.log).toContain(`layout hwnd=101 input=111 thread=9 hkl=${hex(DE)}`);
    expect(result.log).toContain(ALREADY);
    expect(result.log.join("\n")).toContain("physicalChord success");
    expect(requests(result.trace)).toEqual([`111:${DE}`, `111:${CN}`]);
    const loads = result.trace.filter((line) => line.startsWith("layout-load:"));
    expect(loads.length).toBeGreaterThan(0);
    expect(loads.every((line) => line === "layout-load:00000407:0")).toBe(true);
    expect([finalHkl(result.trace, layout, 7), finalHkl(result.trace, layout, 99), finalHkl(result.trace, layout, 19)]).toEqual([US, US, US]);
    expectScansOnInputThread(result.trace);
  });

  it("sole window: the same activation and readback without a label", async () => {
    const layout = layoutScene();
    const result = await runNative([
      { op: "setLayout", klid: "00000407" },
      { op: "physicalChord", keys: ["AltRight", "KeyQ"], hkl: hex(DE), nofocus: true },
    ], { layout } as never);
    expect(result.status, result.log.join("\n") + result.stderr).toBe(0);
    expect(result.log).toContain(ACTIVATED);
    expect(requests(result.trace)).toEqual([`111:${DE}`, `111:${CN}`]);
    expectScansOnInputThread(result.trace);
  });
});
