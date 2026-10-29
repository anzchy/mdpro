// @vitest-environment node
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild, waitForExit } from "../support/loadGuardChild";
import { delay, fixture, python, until, wrapper } from "../support/loadGuardFix";

it("omits own argv from owner and registration while preserving job and keeper lifecycles", async () => {
  const h = fixture("fix2-registration-");
  const secret = "AUDIT_SENTINEL_CREDENTIAL_7f3a";
  let child: ReturnType<typeof spawn> | undefined;
  let keeper = 0;
  try {
    const marker = path.join(h.dir, "complete");
    const argumentsDomain = [secret, ...Array.from({ length: 5 }, (_, i) => createHash("sha256").update(`${i}中文`).digest("hex")), "spaced 中文", "x".repeat(400) + secret];
    argumentsDomain.push("quoted 'balanced' 中文", "line1\nline2 " + secret);
    const args = ["/bin/sh", "-c", `while [ ! -e '${marker}' ]; do sleep .02; done; exit 7`, "runner", ...argumentsDomain];
    child = spawn(wrapper, args, { env: h.env, stdio: "ignore" });
    await until(() => fs.existsSync(h.env.MDPRO_LOAD_GUARD_ACTIVE!) && fs.readdirSync(h.env.MDPRO_LOAD_GUARD_ACTIVE!).some((name) => name.endsWith(".json")));
    const owner = fs.readFileSync(path.join(h.env.MDPRO_HEAVY_LOCK!, "owner"), "utf8");
    const registration = fs.readFileSync(path.join(h.env.MDPRO_LOAD_GUARD_ACTIVE!, fs.readdirSync(h.env.MDPRO_LOAD_GUARD_ACTIVE!).find((name) => name.endsWith(".json"))!), "utf8");
    const expected = createHash("sha256").update(args.join(" ")).digest("hex").slice(0, 16);
    expect(owner).toContain(`cmd=sh sha256:${expected}\n`);
    expect(owner).not.toContain(secret);
    expect(registration).not.toContain(secret);
    const info = JSON.parse(registration);
    expect(info).toMatchObject({ pid: expect.any(Number), pgid: expect.any(Number), start: expect.any(String), uid: process.getuid!() });
    expect(info.cmd === undefined || /^[\w.()+-]+ sha256:[a-f0-9]{16}$/.test(info.cmd)).toBe(true);
    const log = fs.readFileSync(h.env.MDPRO_LOAD_GUARD_LOG!, "utf8");
    expect(log).not.toContain(secret);
    fs.writeFileSync(marker, "done");
    expect(await waitForExit(child)).toBe(7);
    expect(fs.existsSync(h.env.MDPRO_HEAVY_LOCK!)).toBe(false);
    expect(fs.readdirSync(h.env.MDPRO_LOAD_GUARD_ACTIVE!)).toEqual([]);
    const id = randomUUID();
    const ready = path.join(h.dir, secret);
    child = spawn(wrapper, ["--keeper", id, ready], { env: h.env, stdio: "ignore" });
    keeper = child.pid!;
    await until(() => fs.existsSync(ready));
    const keeperOwner = fs.readFileSync(path.join(h.env.MDPRO_HEAVY_LOCK!, "owner"), "utf8");
    expect(keeperOwner).toMatch(new RegExp(`^cmd=--keeper ${id} sha256:[a-f0-9]{16}$`, "m"));
    expect(keeperOwner).not.toContain(secret);
    await delay(50);
    const descendants: number[] = await python(`print(json.dumps([int(r.split()[0]) for r in guard.run('ps','-axo','pid=,ppid=').splitlines() if r.split()[-1]==str(${keeper})]))`, h.env);
    expect(descendants.length).toBeGreaterThan(0);
    expect((await runChild(wrapper, ["--release", randomUUID()], { env: h.env })).status).toBe(1);
    expect(fs.readFileSync(path.join(h.env.MDPRO_HEAVY_LOCK!, "owner"), "utf8")).toBe(keeperOwner);
    expect((await runChild(wrapper, ["--release", id], { env: h.env })).status).toBe(0);
    await waitForExit(child);
    expect(fs.existsSync(h.env.MDPRO_HEAVY_LOCK!)).toBe(false);
    for (const pid of descendants) expect(() => process.kill(pid, 0)).toThrow();
    const completion = await runChild(wrapper, ["/bin/sh", "-c", "exit 7", "runner", secret], { env: h.env });
    expect(completion.status).toBe(7);
    expect(completion.stderr).not.toContain(secret);
    expect(fs.readFileSync(h.env.MDPRO_LOAD_GUARD_LOG!, "utf8")).not.toContain(secret);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await waitForExit(child); }
    if (keeper) try { process.kill(keeper, "SIGTERM"); } catch { /* already drained */ }
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
}, 20000);
