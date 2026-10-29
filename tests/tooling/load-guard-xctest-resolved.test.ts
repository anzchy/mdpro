// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { fixture, python } from "../support/loadGuardFix";

it.skipIf(process.platform !== "darwin")("accepts the observed canonical xctest executable", async () => {
  const h = fixture("guard-xctest-resolved-");
  h.env.MDPRO_LOAD_GUARD_TEST_ROOT = path.resolve(h.dir);
  try {
    const tool = "/Applications/Xcode.app/Contents/Developer/usr/bin/xctest";
    const row = { cwd: h.dir, executable: fs.realpathSync(tool), command: `${tool} ${h.dir}/PicseeKitPackageTests.xctest` };
    const inputs = [row, { ...row, executable: "/tmp/xctest" }];
    expect(await python(`rows=json.loads(${JSON.stringify(JSON.stringify(inputs))});print(json.dumps([backstop.allowlisted(r) for r in rows]))`, h.env)).toEqual([true, false]);
  } finally { fs.rmSync(h.dir, { recursive: true, force: true }); }
});
