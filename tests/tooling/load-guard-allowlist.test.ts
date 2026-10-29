// @vitest-environment node
import { runChild, waitForExit } from "../support/loadGuardChild";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const backstop = path.resolve("scripts/load-guard/backstop.py");

it("stops a verified test runner while preserving a build group", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-allowlist-"));
  const runner = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  const build = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  try {
    const processes = path.join(dir, "processes");
    fs.writeFileSync(processes, JSON.stringify([
      { pid: runner.pid, ppid: process.pid, pgid: runner.pid, uid: process.getuid!(), cwd: dir,
        command: "/Applications/Xcode.app/Contents/Developer/usr/bin/xctest " + path.join(dir, "PicseeKitPackageTests.xctest") + " --nocapture" },
      { pid: build.pid, ppid: process.pid, pgid: build.pid, uid: process.getuid!(), cwd: dir,
        command: "/usr/bin/xcodebuild build-for-testing" },
    ]));
    const sampler = path.join(dir, "sampler");
    fs.writeFileSync(sampler, "#!/bin/sh\necho '4 0 16'\n", { mode: 0o700 });
    const env = { ...process.env, MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_ROOT: dir,
      MDPRO_LOAD_GUARD_PROCESSES: processes, MDPRO_LOAD_GUARD_SAMPLER: sampler,
      MDPRO_LOAD_GUARD_LOG: path.join(dir, "log"), MDPRO_LOAD_GUARD_ACTIVE: path.join(dir, "active"),
      MDPRO_LOAD_GUARD_STATE: path.join(dir, "state") };
    expect((await runChild("python3", [backstop, "--once"], { env })).status).toBe(0);
    expect((await runChild("python3", [backstop, "--once"], { env })).status).toBe(0);
    const log = fs.readFileSync(path.join(dir, "log"), "utf8");
    expect(log).toContain('"event": "stop"');
    await waitForExit(runner);
    expect(() => process.kill(runner.pid!, 0)).toThrow();
    expect(() => process.kill(build.pid!, 0)).not.toThrow();
  } finally {
    for (const pid of [runner.pid, build.pid]) try { process.kill(-pid!, "SIGKILL"); } catch { /* gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 5000);

it("classifies picsee runner argv without admitting build, app, or agent argv", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-shapes-"));
  try {
    const commands = [
      "/Applications/Xcode.app/Contents/Developer/usr/bin/xctest " + path.join(dir, "Packages/PicseeKit/.build/arm64-apple-macosx/debug/PicseeKitPackageTests.xctest"),
      "/usr/bin/xcrun xctest " + path.join(dir, ".build/dd-ci/Build/Products/Debug/PicseeAppTests.xctest"),
      "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/libexec/swift/pm/swiftpm-testing-helper --test-bundle-path " + path.join(dir, "Packages/PicseeKit/.build/debug/PicseeKitPackageTests.xctest/Contents/MacOS/PicseeKitPackageTests"),
      "/usr/bin/xcodebuild build-for-testing",
      "/usr/bin/swift build",
      "/usr/local/bin/xcodegen generate",
      "/usr/bin/codesign --verify Picsee.app",
      "node scripts/device/build.sh",
      path.join(dir, "Picsee.app/Contents/MacOS/Picsee"),
      "/usr/local/bin/codex exec",
      "/usr/local/bin/claude --resume",
      "/usr/local/bin/kimi-code",
      "node scripts/tdd/app-lane.mjs",
    ];
    const program = `import json,sys;sys.path.insert(0,${JSON.stringify(path.dirname(backstop))});import backstop;print(json.dumps([backstop.allowlisted({'command':c,'cwd':${JSON.stringify(dir)}}) for c in ${JSON.stringify(commands)}]))`;
    const result = (await runChild("python3", ["-c", program], { env: { ...process.env, MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_ROOT: dir }, encoding: "utf8" }));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([true, true, true, false, false, false, false, false, false, false, false, false, false]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects executable-path lookalikes and runner paths outside the project roots", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-lookalikes-"));
  try {
    const commands = [
      "/tmp/fake/swiftpm-testing-helper --test-bundle-path " + path.join(dir, "Packages/PicseeKit/.build/debug/PicseeKitPackageTests.xctest"),
      "/tmp/fake/node " + path.join(dir, "node_modules/vitest/dist/forks.js"),
      "/tmp/foreign/target/debug/deps/test-1234 --nocapture",
    ];
    const program = `import json,sys;sys.path.insert(0,${JSON.stringify(path.dirname(backstop))});import backstop;print(json.dumps([backstop.allowlisted({'command':c,'cwd':${JSON.stringify(dir)}}) for c in ${JSON.stringify(commands)}]))`;
    const result = (await runChild("python3", ["-c", program], { env: { ...process.env, MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_ROOT: dir }, encoding: "utf8" }));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([false, false, false]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
