// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { fixture, python } from "../support/loadGuardFix";

it.skipIf(process.platform !== "darwin")("requires verified test ancestry for support tools and rejects standalone builds", async () => {
  const h = fixture("guard-support-policy-");
  try {
    const xctest = { pid: 102, ppid: 101, pgid: 101, uid: process.getuid!(), cwd: h.dir,
      executable: "/Applications/Xcode.app/Contents/Developer/usr/bin/xctest",
      command: `/Applications/Xcode.app/Contents/Developer/usr/bin/xctest ${h.dir}/PicseeKitPackageTests.xctest` };
    const swiftBase = "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/";
    const parents = [
      { ...xctest, pid: 101, ppid: 1, executable: swiftBase + "swift-test", command: `${swiftBase}swift-test --package-path ${h.dir}` },
      { ...xctest, pid: 101, ppid: 1, executable: swiftBase + "swift-build", command: `${swiftBase}swift-build --build-tests` },
      { ...xctest, pid: 101, ppid: 1, executable: process.execPath, command: `${process.execPath} ${h.dir}/scripts/tdd/app-lane.mjs` },
    ];
    const forbidden = ["/usr/bin/xcodebuild build-for-testing", "/usr/bin/codesign --sign identity", "/usr/bin/swift build", "node scripts/device/build.sh", `${h.dir}/Picsee.app/Contents/MacOS/Picsee`, "/bin/codex exec", "/Applications/Editor.app/Contents/MacOS/editor"];
    const groups = [
      ...parents.map((parent) => [parent, xctest]),
      ...parents.map((parent) => [parent]),
      ...forbidden.map((command) => [{ ...xctest, pid: 101, ppid: 1, command, executable: command.split(" ")[0] }, xctest]),
    ];
    const result = await python(`groups=json.loads(${JSON.stringify(JSON.stringify(groups))});print(json.dumps([101 in backstop.candidate_groups(g) for g in groups]))`, h.env);
    expect(result).toEqual([true, true, true, false, false, false, ...forbidden.map(() => false)]);
    // An esbuild service needs the verified Vitest ancestor and its installed
    // executable; the same argv with a fake executable cannot grant authority.
    const packageName = fs.readdirSync("node_modules/.pnpm").find((name) => name.startsWith("@esbuild+darwin-arm64@"));
    if (packageName) {
      const executable = fs.realpathSync(path.resolve("node_modules/.pnpm", packageName, "node_modules/@esbuild/darwin-arm64/bin/esbuild"));
      const main = { ...xctest, pid: 101, ppid: 1, cwd: process.cwd(), executable: process.execPath, command: "node (vitest)" };
      const service = { ...xctest, cwd: process.cwd(), executable, command: `${executable} --service=0.27.2 --ping` };
      const inputs = [[main, service], [{ ...main, command: "node unrelated.js" }, service], [main, { ...service, executable: "/tmp/esbuild" }]];
      expect(await python(`groups=json.loads(${JSON.stringify(JSON.stringify(inputs))});print(json.dumps([101 in backstop.candidate_groups(g) for g in groups]))`, h.env)).toEqual([true, false, false]);
    }
  } finally { fs.rmSync(h.dir, { recursive: true, force: true }); }
});
