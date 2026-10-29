// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { fixture, python } from "../support/loadGuardFix";

it.skipIf(process.platform !== "darwin")("matches the live Swift Testing helper by canonical path and rejects impersonators", async()=>{
  const h=fixture("guard-helper-resolved-");
  try{
    const tool="/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/libexec/swift/pm/swiftpm-testing-helper";
    const alias=path.join(h.dir,"helper-alias");fs.symlinkSync(tool,alias);
    const row={cwd:h.dir,executable:fs.realpathSync(tool),command:`${tool} --test-bundle-path ${h.dir}/PicseeKitPackageTests.xctest/Contents/MacOS/PicseeKitPackageTests`};
    const rows=[row,{...row,executable:alias},{...row,executable:"/tmp/swiftpm-testing-helper"},{...row,executable:tool.replace("swiftpm-testing-helper","swiftpm-xctest-helper")}];
    expect(await python(`rows=json.loads(${JSON.stringify(JSON.stringify(rows))});print(json.dumps([backstop.allowlisted(r) for r in rows]))`,h.env)).toEqual([true,true,false,false]);
  }finally{fs.rmSync(h.dir,{recursive:true,force:true});}
});
