// @vitest-environment node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild } from "../support/loadGuardChild";
import { fixture, guardDir, python, records, wrapper } from "../support/loadGuardFix";

it("omits all argv and hashes the full command in every log sink", async () => {
  const h = fixture("guard-safe-logs-");
  const secret = "0123456789abcdef0123456789abcdef01234567";
  const args = `-H 'Authorization: Bearer ${secret}' --token=${secret} --key ${secret} --password ${secret} --secret ${secret} --auth ${secret} --header 'X-MDPRO-Token: ${secret}' MDPRO_MCP_TOKEN=${secret} https://user:pass@host --cookie=sessionid=${secret}`;
  try {
    const commands = [`/usr/bin/curl ${args}`, `node /known/vitest.mjs run ${args}`, "", "node 'unclosed " + secret,
      ...Array.from({ length: 20 }, (_, i) => `node '${createHash("sha256").update(`argv-${i}`).digest("hex")}中文\t${i}'`),
      "node " + "x".repeat(300) + "tail-A", "node " + "x".repeat(300) + "tail-B"];
    const values = await python(`print(json.dumps([guard.safe_command(c) for c in json.loads(${JSON.stringify(JSON.stringify(commands))})]))`, h.env);
    for (let index = 0; index < commands.length; index++) {
      const digest = createHash("sha256").update(commands[index]).digest("hex").slice(0, 16);
      expect(values[index]).toMatch(/^[\w.()+-]+ sha256:[a-f0-9]{16}$/);
      expect(values[index]).toContain(`sha256:${digest}`);
      expect(values[index]).not.toContain(secret);
      expect(values[index].split(" ")).toHaveLength(2);
    }
    expect(values.at(-1)).not.toBe(values.at(-2));
    expect(await python(`print(json.dumps(guard.safe_command(${JSON.stringify(commands[0])})))`, h.env)).toBe(values[0]);
    const pidFile = path.join(h.dir, "pid");
    fs.writeFileSync(h.sampler, `#!/bin/sh\nif [ -e '${pidFile}' ]; then echo '4 0 16'; else echo '1 0 16'; fi\n`, { mode: 0o700 });
    fs.writeFileSync(path.join(h.dir, "ps"), `#!/bin/sh\nif [ "$*" = '-axo pid,ppid,rss,etime,command' ]; then\necho 'PID PPID RSS ELAPSED COMMAND'\necho '999 1 2097152 00:01 curl ${args.replaceAll("'", "")}'\nelse exec /bin/ps "$@"; fi\n`, { mode: 0o700 });
    const env = { ...h.env, PATH: `${h.dir}:${process.env.PATH}` };
    expect((await runChild(wrapper, ["/bin/sh", "-c", `echo $$ > '${pidFile}'; exec /bin/sleep 8`, "sh", ...args.split(" ")], { env, timeout: 12000 })).status).toBe(76);
    expect((await runChild("python3", [path.join(guardDir, "backstop.py"), "--once"], { env })).status).toBe(0);
    // Warning and supplied pre-TERM RSS snapshots must use the same safe path.
    await python(`guard.log('warn','cpu',1,99,${JSON.stringify(commands[0])},os.getcwd(),top_rss=guard.snapshot());print('true')`, env);
    const bytes = fs.readFileSync(path.join(h.dir, "log"), "utf8");
    expect(bytes).not.toContain(secret);
    expect(bytes).not.toContain("user:pass");
    expect(bytes).not.toContain("Authorization:");
    expect(bytes).not.toContain("MDPRO_MCP_TOKEN=");
    expect(new Set(records(h.dir).map((r) => r.event))).toEqual(new Set(["admission", "stop", "snapshot", "warn"]));
    for (const record of records(h.dir)) {
      expect(record.cmd).toMatch(/^[\w.()+-]+ sha256:[a-f0-9]{16}$/);
      expect(record.topRss).toHaveLength(1);
      expect(record.topRss[0].command).toMatch(/^curl sha256:[a-f0-9]{16}$/);
    }
  } finally { fs.rmSync(h.dir, { recursive: true, force: true }); }
}, 20000);
