// @vitest-environment node
/**
 * D338 K2, the KLID argument and its availability: a KLID that is not a string of exactly eight
 * hex digits is refused before any load, request, binding or input, and the run aborts even under
 * `onError: "continue"`. Hex case is not significant. A KLID that loads nothing, loads a
 * substituted layout of another language, or loads a layout that was not installed before the
 * request, fails with LAYOUT_UNAVAILABLE and sends no request and no key; a layout the driver
 * itself loaded for that check is unloaded again. Production ui.ps1 under pwsh with Win32 doubles.
 */
import { describe, expect, it, vi } from "vitest";
import { CN, DE, US, finalHkl, hex, identity, layoutScene, requests, runLayout, scans } from "./windows-driver-native-layout-harness";

vi.setConfig({ testTimeout: 60_000 });

const FR = 0x040c040c;
const RU = 0x04190419;
const chord = { op: "physicalChord", window: "A", keys: ["AltRight", "KeyQ"], hkl: hex(DE), nofocus: true, _identity: identity };
const setLayout = (klid: unknown, extra: object = {}) =>
  ({ op: "setLayout", window: "A", _identity: identity, ...(klid === undefined ? {} : { klid }), ...extra });

describe("D338 K2 setLayout validates the KLID before anything native happens", () => {
  it.each([
    ["missing", undefined], ["null", null], ["a number", 407], ["seven digits", "0000407"], ["nine digits", "000000407"],
    ["a non-hex digit", "0000040G"], ["a 0x prefix", "0x000407"], ["empty", ""], ["padded", " 00000407"],
  ])("%s KLID: LAYOUT_KLID_INVALID, no load, no request, no key, and the run stops", async (_name, klid) => {
    const layout = layoutScene();
    const result = await runLayout([setLayout(klid, { onError: "continue" }), chord], layout);
    expect(result.status, result.log.join("\n")).toBe(1);
    expect(result.log.join("\n")).toMatch(/LAYOUT_KLID_INVALID[\s\S]*ABORTED at step 1/);
    expect(result.trace.filter((line) => /^layout-(load|list|request)/.test(line))).toEqual([]);
    expect(scans(result.trace)).toEqual([]);
    expect(finalHkl(result.trace, layout, 9)).toBe(CN);
  });

  it("accepts lower-case hex and reports the KLID upper-cased", async () => {
    const layout = layoutScene({ load: { "0000040C": FR }, list: [CN, US, DE, FR] });
    const result = await runLayout([setLayout("0000040c")], layout);
    expect(result.status, result.log.join("\n")).toBe(0);
    expect(result.log.join("\n")).toContain(`setLayout requested=0000040C loaded=${hex(FR)} before=${hex(CN)} observed=${hex(FR)}`);
    expect(result.trace).toContain(`layout-state:9:${FR}`);
    expect(finalHkl(result.trace, layout, 9)).toBe(CN);
  });
});

describe("D338 K2 an unavailable layout is an error, never a substitute", () => {
  it.each([
    ["loads nothing", layoutScene(), undefined],
    ["loads another language's layout (a substitution)", layoutScene({ load: { "00000419": US } }), undefined],
    ["loads a layout that was not installed", layoutScene({ load: { "00000419": RU } }), RU],
  ])("a KLID that %s: LAYOUT_UNAVAILABLE, no request and no key", async (_name, layout, unloaded) => {
    const result = await runLayout([setLayout("00000419"), chord], layout);
    expect(result.status, result.log.join("\n")).toBe(1);
    expect(result.log.join("\n")).toMatch(/LAYOUT_UNAVAILABLE requested=00000419[\s\S]*ABORTED at step 1/);
    expect(result.log.join("\n")).not.toContain("setLayout requested=");
    expect(requests(result.trace)).toEqual([]);
    expect(scans(result.trace)).toEqual([]);
    expect(finalHkl(result.trace, layout, 9)).toBe(CN);
    const unloads = result.trace.filter((line) => line.startsWith("layout-unload:"));
    expect(unloads).toEqual(unloaded === undefined ? [] : [`layout-unload:${unloaded}`]);
  });
});
