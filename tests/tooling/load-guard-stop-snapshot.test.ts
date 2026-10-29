// @vitest-environment node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("captures the stopped job in the RSS snapshot before terminating it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-stop-snapshot-"));
  const pidFile = path.join(dir, "pid");
  const sampler = path.join(dir, "sampler");
  fs.writeFileSync(sampler, `#!/bin/sh\nif [ -e '${pidFile}' ]; then echo '4 0 16'; else echo '1 0 16'; fi\n`, { mode: 0o700 });
  fs.writeFileSync(path.join(dir, "ps"), `#!/bin/sh\nif [ "$*" = '-axo pid,ppid,rss,etime,command' ]; then\n echo 'PID PPID RSS ELAPSED COMMAND'\n if [ -e '${pidFile}' ] && /bin/kill -0 "$(cat '${pidFile}')" 2>/dev/null; then echo "$(cat '${pidFile}') 1 2097152 00:01 node --token secret"; fi\nelse exec /bin/ps "$@"; fi\n`, { mode: 0o700 });
  try {
    const result = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(path.resolve("scripts/heavy-lock.sh"), ["/bin/sh", "-c", `echo $$ > '${pidFile}'; exec /bin/sleep 5`], {
        env: { ...process.env, MDPRO_HEAVY_LOCK_HELD: undefined, PATH: `${dir}:${process.env.PATH}`,
          MDPRO_HEAVY_LOCK: path.join(dir, "lock"), MDPRO_LOAD_GUARD_ACTIVE: path.join(dir, "active"),
          MDPRO_LOAD_GUARD_LOG: path.join(dir, "log"), MDPRO_LOAD_GUARD_SAMPLER: sampler,
          MDPRO_LOAD_GUARD_INTERVAL_SECS: "0.05" }, stdio: "ignore",
      });
      child.on("error", reject);
      child.on("close", resolve);
    });
    expect(result).toBe(76);
    const records = fs.readFileSync(path.join(dir, "log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const stop = records.find((r) => r.event === "stop");
    expect(stop.topRss).toEqual([{ pid: Number(fs.readFileSync(pidFile, "utf8")), ppid: 1, rssMiB: 2048, elapsed: "00:01", command: `node sha256:${createHash("sha256").update("node --token secret").digest("hex").slice(0, 16)}` }]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
