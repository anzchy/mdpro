// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { fixture, python } from "../support/loadGuardFix";

it.skipIf(process.platform !== "darwin")("resolves a relative bundle against cwd and refuses root escape", async () => {
  const h = fixture("guard-xctest-relative-");
  try {
    fs.symlinkSync("/tmp", path.join(h.dir, "escape"));
    const row = { cwd: h.dir, executable: fs.realpathSync("/usr/bin/xcrun"), command: "xcrun xctest .build/dd-ci/Build/Products/Debug/PicseeAppTests.xctest" };
    const inputs = [row, { ...row, command: "xcrun xctest ../PicseeAppTests.xctest" }, { ...row, command: "xcrun xctest escape/PicseeAppTests.xctest" }, { ...row, command: "xcrun xctest /tmp/PicseeAppTests.xctest" }];
    expect(await python(`rows=json.loads(${JSON.stringify(JSON.stringify(inputs))});print(json.dumps([backstop.allowlisted(r) for r in rows]))`, h.env)).toEqual([true, false, false, false]);
  } finally { fs.rmSync(h.dir, { recursive: true, force: true }); }
});
