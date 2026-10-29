// @vitest-environment node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";

it("redacts bearer authorization and quoted token values completely", async () => {
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn("python3", ["-c", `import sys,json; sys.path.insert(0,sys.argv[1]); import guard; print(json.dumps([guard.safe_command(value) for value in sys.argv[2:]]))`,
      path.resolve("scripts/load-guard"), "node --authorization Bearer secret-token", 'node --token "multi word secret" tail', "node --password='two words' tail"], { stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.on("data", (part) => { output += part.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`redaction fixture exited ${code}`)));
  });
  expect(JSON.parse(result)).toEqual([
    "node --authorization Bearer secret-token", 'node --token "multi word secret" tail', "node --password='two words' tail",
  ].map((command) => `node sha256:${createHash("sha256").update(command).digest("hex").slice(0, 16)}`));
});
