import fs from "node:fs";
import { it } from "vitest";

it("holds a real one-worker runner tree for backstop inspection", async () => {
  fs.writeFileSync(process.env.MDPRO_FIX_RUNNER_READY!, String(process.pid));
  await new Promise((resolve) => setTimeout(resolve, 20000));
}, 25000);
