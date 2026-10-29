// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { fixture, python } from "../support/loadGuardFix";

it("creates JSONL mode0600 under umask022 while preserving existing mode and records", async () => {
  const h = fixture("fix2-log-mode-");
  try {
    for (const mode of [null, 0o600, 0o640, 0o644]) {
      const file = path.join(h.dir, `log-${mode}`);
      if (mode !== null) { fs.writeFileSync(file, '{"first":"中文"}\n'); fs.chmodSync(file, mode); }
      await python("os.umask(0o022);guard.log('note','test',1,0,'runner --token=private',os.getcwd(),top_rss=[]);guard.log('note','test2',1,0,'runner',os.getcwd(),top_rss=[]);print('true')",
        { ...h.env, MDPRO_LOAD_GUARD_LOG: file });
      expect(fs.statSync(file).mode & 0o777).toBe(mode ?? 0o600);
      const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(lines).toHaveLength(mode === null ? 2 : 3);
      if (mode !== null) expect(lines[0]).toEqual({ first: "中文" });
      expect(lines.at(-2).reason).toBe("test");
      expect(lines.at(-1).reason).toBe("test2");
    }
  } finally { fs.rmSync(h.dir, { recursive: true, force: true }); }
});
