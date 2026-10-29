// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { fixture, python } from "../support/loadGuardFix";

it.skipIf(process.platform !== "darwin")("requires verified bare xcrun to run the xctest subcommand", async () => {
  const h = fixture("guard-xcrun-bare-");
  h.env.MDPRO_LOAD_GUARD_TEST_ROOT = path.resolve(h.dir);
  try {
    const row = { cwd: h.dir, executable: fs.realpathSync("/usr/bin/xcrun"), command: `xcrun xctest ${h.dir}/PicseeAppTests.xctest` };
    const inputs = [row, { ...row, executable: "/tmp/xcrun" }, { ...row, command: `xcrun codesign --sign identity ${h.dir}/PicseeAppTests.xctest` }, { ...row, command: `xcrun swift build ${h.dir}/PicseeAppTests.xctest` }];
    expect(await python(`rows=json.loads(${JSON.stringify(JSON.stringify(inputs))});print(json.dumps([backstop.allowlisted(r) for r in rows]))`, h.env)).toEqual([true, false, false, false]);
  } finally { fs.rmSync(h.dir, { recursive: true, force: true }); }
});
