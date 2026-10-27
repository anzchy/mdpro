// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

function runChild(command: string, args: string[], cwd: string): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout }));
  });
}

it("uses the clean checkout id despite device CLI flags", async () => {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), "d326-default-id-"));
  try {
    fs.writeFileSync(path.join(checkout, "package.json"), '{"version":"0.3.5"}\n');
    const bundle = path.join(checkout, "mdpro.app");
    fs.mkdirSync(bundle);
    for (const args of [["init", "-q"], ["add", "package.json"],
      ["-c", "user.name=D326", "-c", "user.email=d326@example.test", "commit", "-qm", "fixture"]]) {
      const git = await runChild("git", args, checkout);
      expect(git.status).toBe(0);
    }
    const moduleUrl = pathToFileURL(path.resolve("scripts/device/identity.mjs")).href;
    const child = await runChild(process.execPath, ["--input-type=module", "-e", `
      import { runIdentity } from ${JSON.stringify(moduleUrl)};
      process.argv = [process.execPath, ${JSON.stringify(path.resolve("scripts/device/identity.mjs"))}, "--bundle", ${JSON.stringify(bundle)}];
      const result = await runIdentity(["--bundle", ${JSON.stringify(bundle)}], {
        scanProcesses: async () => [{ pid: 9, exe: "/Applications/mdpro.app/Contents/MacOS/mdpro", birthMs: 1 }],
        launch: async () => { throw new Error("must not launch with a preexisting process"); },
      });
      process.stdout.write(JSON.stringify(result));
    `], checkout);
    expect(child.status).toBe(0);
    const result = JSON.parse(child.stdout);
    expect(result.lines).toEqual(["[PASS] bundle", "[FAIL] process", "[FAIL] releaseId", "[SKIPPED] window"]);
    expect(result.exit).toBe(1);
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});
