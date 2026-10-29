import fs from "node:fs";
import { spawn } from "node:child_process";
import { it } from "vitest";

it("holds a real one-worker runner tree for backstop inspection", async () => {
  if (process.env.MDPRO_FIX_PROTECTED === "1") {
    const child = spawn(process.execPath, ["-e", "process.title='codex';process.stdout.write('ready');setInterval(()=>{},1000)"], { stdio: ["ignore", "pipe", "ignore"] });
    await new Promise((resolve) => child.stdout!.once("data", resolve));
  }
  fs.writeFileSync(process.env.MDPRO_FIX_RUNNER_READY!, String(process.pid));
  await new Promise((resolve) => setTimeout(resolve, 20000));
}, 25000);
