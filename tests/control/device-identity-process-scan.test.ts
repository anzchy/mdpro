// @vitest-environment node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no declaration file
import * as identity from "../../scripts/device/identity.mjs";
const { parseMainPids } = identity;

function runWithProcesses(processLines: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "d326-process-scan-"));
  try {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    const bundle = path.join(root, "mdpro.app");
    fs.mkdirSync(bundle);
    const marker = path.join(root, "open-was-called");
    fs.writeFileSync(path.join(bin, "ps"), '#!/bin/sh\nprintf "%s\\n" "$D326_PS_LIST"\n');
    fs.writeFileSync(path.join(bin, "lsof"), '#!/bin/sh\nprintf "%s\\n" "$D326_LSOF_LIST"\n');
    fs.writeFileSync(path.join(bin, "open"), '#!/bin/sh\ntouch "$D326_OPEN_MARKER"\nexit 1\n');
    fs.chmodSync(path.join(bin, "ps"), 0o755);
    fs.chmodSync(path.join(bin, "lsof"), 0o755);
    fs.chmodSync(path.join(bin, "open"), 0o755);
    const expected = `0.3.5-dev@${"a".repeat(40)}`;
    const result = spawnSync(process.execPath, [path.resolve("scripts/device/identity.mjs"),
      "--bundle", bundle, "--expected-release-id", expected], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, D326_PS_LIST: processLines,
        D326_LSOF_LIST: processLines.split("\n").map((line) => {
          const match = /^(\d+) (.+)$/.exec(line);
          return match ? `p${match[1]}\nftxt\nn${match[2]}` : "";
        }).join("\n"), D326_OPEN_MARKER: marker },
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

it("selects every main from executable records regardless of argv0", () => {
  const table = [
    "p17", "ftxt", "n/tmp/mdpro.app/Contents/MacOS/tauri-app",
    "ftxt", "n/usr/lib/dyld",
    "p18", "ftxt", "n/tmp/mdpro.app/Contents/MacOS/mdpro_mcp",
    "p19", "ftxt", "n/tmp/示例 space/mdpro.app/Contents/MacOS/tauri-app",
  ].join("\n");
  expect(typeof identity.parseExecutableTable).toBe("function");
  expect(identity.parseExecutableTable(table)).toEqual([17, 19]);
  expect(identity.parseExecutableTable("p17\nftxt\n")).toBeNull();
  expect(identity.parseExecutableTable("p17\nn/tmp/mdpro.app/Contents/MacOS/tauri-app\n")).toBeNull();
});

it("fails closed when executable enumeration cannot be read", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "d326-lsof-fail-"));
  try {
    const bin = path.join(root, "bin");
    const bundle = path.join(root, "mdpro.app");
    const marker = path.join(root, "opened");
    fs.mkdirSync(bin);
    fs.mkdirSync(bundle);
    fs.writeFileSync(path.join(bin, "lsof"), "#!/bin/sh\nexit 1\n");
    fs.writeFileSync(path.join(bin, "open"), `#!/bin/sh\ntouch "${marker}"\n`);
    fs.chmodSync(path.join(bin, "lsof"), 0o755);
    fs.chmodSync(path.join(bin, "open"), 0o755);
    const run = spawnSync(process.execPath, [path.resolve("scripts/device/identity.mjs"),
      "--bundle", bundle, "--expected-release-id", `0.3.5-dev@${"a".repeat(40)}`], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("[FAIL] process");
    expect(fs.existsSync(marker)).toBe(false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform !== "darwin")("real executable scan", () => {
  it("finds two live main executables when one has a spoofed argv0", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "d326-real-scan-"));
    const source = path.join(root, "sleep.c");
    const compiled = path.join(root, "sleep-probe");
    fs.writeFileSync(source, "#include <unistd.h>\nint main(void) { sleep(30); return 0; }\n");
    const cc = spawnSync("cc", [source, "-o", compiled], { encoding: "utf8" });
    expect(cc.status).toBe(0);
    const binaries = ["first", "second"].map((name) => {
      const bundle = path.join(root, name, "mdpro.app");
      const binary = path.join(bundle, "Contents", "MacOS", "tauri-app");
      fs.mkdirSync(path.dirname(binary), { recursive: true });
      fs.copyFileSync(compiled, binary);
      fs.chmodSync(binary, 0o755);
      return { bundle, binary };
    });
    const children = binaries.map(({ binary }, index) => spawn(binary, ["30"], {
      argv0: index === 0 ? binary : "x", stdio: "ignore",
    }));
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const pids = children.map((child) => child.pid);
      expect(pids.every((pid) => typeof pid === "number")).toBe(true);
      expect(typeof identity.scanProcesses).toBe("function");
      const observed = await identity.scanProcesses();
      expect(observed.map((item: { pid: number }) => item.pid)).toEqual(expect.arrayContaining(pids));
      const run = await identity.runIdentity([
        "--bundle", binaries[0].bundle,
        "--expected-release-id", `0.3.5-dev@${"a".repeat(40)}`,
        "--check-only",
      ]);
      expect(run.lines).toContain("[FAIL] process");
      expect(run.lines).toContain("[SKIPPED] window");
      expect(run.exit).toBe(1);
    } finally {
      const exits = children.map((child) => child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise<void>((resolve) => child.once("exit", () => resolve())));
      for (const child of children) child.kill("SIGKILL");
      await Promise.all(exits);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
});
