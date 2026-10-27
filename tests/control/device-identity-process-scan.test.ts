// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no declaration file
import { parseMainPids } from "../../scripts/device/identity.mjs";

function runWithProcesses(processLines: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "d326-process-scan-"));
  try {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    const bundle = path.join(root, "mdpro.app");
    fs.mkdirSync(bundle);
    const marker = path.join(root, "open-was-called");
    fs.writeFileSync(path.join(bin, "ps"), '#!/bin/sh\nprintf "%s\\n" "$D326_PS_LIST"\n');
    fs.writeFileSync(path.join(bin, "open"), '#!/bin/sh\ntouch "$D326_OPEN_MARKER"\nexit 1\n');
    fs.chmodSync(path.join(bin, "ps"), 0o755);
    fs.chmodSync(path.join(bin, "open"), 0o755);
    const expected = `0.3.5-dev@${"a".repeat(40)}`;
    const result = spawnSync(process.execPath, [path.resolve("scripts/device/identity.mjs"),
      "--bundle", bundle, "--expected-release-id", expected], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, D326_PS_LIST: processLines, D326_OPEN_MARKER: marker },
    });
    return { result, launched: fs.existsSync(marker) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

it("refuses to launch while a dev mdpro main process runs", () => {
  const { result, launched } = runWithProcesses("123 /repo/src-tauri/target/debug/tauri-app");
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("[FAIL] process");
  expect(launched).toBe(false);
});

it("does not count a bundled mdpro_mcp sidecar as a main process", () => {
  const { result, launched } = runWithProcesses("124 /Applications/mdpro.app/Contents/MacOS/mdpro_mcp");
  expect(result.status).toBe(1);
  expect(launched).toBe(true);
});

it("selects the main binary when its sidecar shares the process table", () => {
  expect(parseMainPids([
    " 17 /tmp/mdpro.app/Contents/MacOS/tauri-app",
    " 18 /tmp/mdpro.app/Contents/MacOS/mdpro_mcp",
  ].join("\n"))).toEqual([17]);
});

it("keeps both bundled and development main processes", () => {
  expect(parseMainPids([
    " 17 /tmp/mdpro.app/Contents/MacOS/tauri-app",
    " 19 /repo/src-tauri/target/debug/tauri-app",
  ].join("\n"))).toEqual([17, 19]);
});
