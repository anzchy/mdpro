// @vitest-environment node
/**
 * D338 K6, a WebView input child in another process: mdpro's focused input child (111) may belong
 * to a WebView2 renderer process (pid 33), not to the owner's process (11), while its root is still
 * the bound owner A (101). The input context is still that child and its thread 9: setLayout
 * activates on thread 9, every physical scan is preceded by a thread-9 read of the exact HKL, the
 * planner sends its scans then its reverse releases, and cleanup restores thread 9. The owner's
 * identity checks still bind the owner's own process. Production ui.ps1 under pwsh with doubles.
 */
import { describe, expect, it, vi } from "vitest";
import { CN, DE, US, finalHkl, hex, identity, layoutScene, requests, runLayout, scans } from "./windows-driver-native-layout-harness";

vi.setConfig({ testTimeout: 60_000 });

const ACTIVATED = `setLayout requested=00000407 loaded=${hex(DE)} before=${hex(CN)} observed=${hex(DE)} owner=101 input=111 thread=9`;
const RESTORED = `layout-restore input=111 thread=9 prior=${hex(CN)} observed=${hex(CN)} restored`;

describe("D338 K6 an input child owned by another process inside the owner", () => {
  it("activates, sends the physical chord on thread 9's exact HKL and restores thread 9", async () => {
    const layout = layoutScene({ inputPid: { 111: 33 } });
    const result = await runLayout([
      { op: "setLayout", window: "A", klid: "00000407", _identity: identity },
      { op: "physicalChord", window: "A", keys: ["AltRight", "KeyQ"], hkl: hex(DE), nofocus: true, _identity: identity },
    ], layout);
    expect(result.status, result.log.join("\n") + result.stderr).toBe(0);
    expect(result.log).toContain(ACTIVATED);
    expect(result.log.join("\n")).toContain("physicalChord success");
    // AltRight (extended 56) and KeyQ (16) down, then released in reverse.
    expect(scans(result.trace)).toEqual(["scan:56:False:True", "scan:16:False:False", "scan:16:True:False", "scan:56:True:True"]);
    for (const [index, line] of result.trace.entries()) {
      if (!line.startsWith("scan:")) continue;
      const read = result.trace.slice(0, index).filter((entry) => entry.startsWith("observe:hkl:")).at(-1);
      expect(read, `HKL read before ${line}`).toMatch(new RegExp(`:9:${DE}$`));
    }
    expect(requests(result.trace)).toEqual([`111:${DE}`, `111:${CN}`]);
    expect(result.log).toContain(RESTORED);
    expect([finalHkl(result.trace, layout, 9), finalHkl(result.trace, layout, 7)]).toEqual([CN, US]);
  });
});
