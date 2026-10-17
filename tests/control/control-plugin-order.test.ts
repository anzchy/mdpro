// @vitest-environment node
/**
 * ADR-0047 WI-009 plan item 11: registering the control channel keeps
 * `single_instance` the first plugin and does not take `RunEvent::Opened`
 * away from main.rs. Structural on purpose: plugin order is not observable
 * from a unit test binary. Sources are read with comments blanked.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codeLines, readBlankedRust, rustFiles, SRC_TAURI } from "../support/rustSource";

const main = codeLines(readBlankedRust("src/main.rs"));
const pluginAt = (re: RegExp) => main.findIndex((l) => re.test(l));
const pluginLines = main.flatMap((l, i) => (/\.plugin\(/.test(l) ? [i] : []));

describe("item 11: plugin order", () => {
  it("registers single_instance before any other plugin", () => {
    const si = pluginAt(/\.plugin\(tauri_plugin_single_instance::init\(/);
    expect(si, "main.rs registers single_instance").toBeGreaterThanOrEqual(0);
    expect(pluginLines[0]).toBe(si);
  });

  it("registers the control channel last, directly under its cfg", () => {
    const ctl = pluginAt(/^let app = app\.plugin\(control_plugin\);$/);
    expect(ctl, "main.rs registers control_plugin").toBeGreaterThan(0);
    expect(main[ctl - 1]).toBe('#[cfg(feature = "control-channel")]');
    expect(pluginLines.at(-1)).toBe(ctl);
  });
});

describe("item 11: RunEvent::Opened stays with main.rs", () => {
  it("main.rs's run loop still matches RunEvent::Opened", () => {
    expect(main.some((l) => l.includes("if let RunEvent::Opened"))).toBe(true);
  });

  it("no control_channel source names RunEvent::Opened", () => {
    const dir = path.join(SRC_TAURI, "src", "services", "control_channel");
    const files = rustFiles(dir);
    expect(files.length, "control_channel has sources").toBeGreaterThan(0);
    for (const f of files) {
      const rel = path.relative(SRC_TAURI, f);
      expect(readBlankedRust(rel), rel).not.toMatch(/\bOpened\b/);
    }
  });
});
