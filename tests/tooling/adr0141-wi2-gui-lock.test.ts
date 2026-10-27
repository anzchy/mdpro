// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.setConfig({ testTimeout: 10000 });

const script = path.resolve(".agents/skills/mdpro-delegator/scripts/gui-lock.sh");
const homes: string[] = [];
const uuid = "123e4567-e89b-42d3-a456-426614174000";

type Result = { code: number; stdout: string; stderr: string };

function start(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(script, args, { env });
  let stdout = "", stderr = "";
  child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
  child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
  const done = new Promise<Result>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
  return { child, done };
}

async function waitFor(file: string) {
  const deadline = Date.now() + 3000;
  while (!fs.existsSync(file) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  const additionalDeadline = Date.now() + 5000;
  while (!fs.existsSync(file) && Date.now() < additionalDeadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(fs.existsSync(file), `expected checkpoint ${file}`).toBe(true);
}

function harness() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "adr0141-gui-lock-"));
  homes.push(home);
  const cache = path.join(home, ".cache"), lock = path.join(cache, "desktop-gui.lock"), bin = path.join(home, "bin");
  fs.mkdirSync(cache); fs.mkdirSync(lock); fs.mkdirSync(bin);
  const owner = path.join(lock, "owner"), ready = path.join(home, "pause-ready"), gate = path.join(home, "pause-gate");
  fs.writeFileSync(gate, "hold\n");
  const original = `project=picsee\nsession=picsee-dtrack\nbatch=their-batch\nstart=2026-10-27T00:00:00+0000\npid=123\nexpected_minutes=90\npurpose=device run\nacquisition_id=${uuid}\n`;
  fs.writeFileSync(owner, original);
  // The imported script renames with `mv`. Force its bad interleaving; the fixed script uses its test-only barrier.
  const mv = path.join(bin, "mv");
  fs.writeFileSync(mv, "#!/bin/sh\n/bin/mv \"$@\" || exit $?\nprintf ready > \"$MDPRO_GUI_LOCK_PAUSE_READY\"\nwhile [ -e \"$MDPRO_GUI_LOCK_PAUSE_GATE\" ]; do /bin/sleep 0.01; done\n");
  fs.chmodSync(mv, 0o755);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ""}`, MDPRO_GUARD_TEST: "1", MDPRO_GUI_LOCK_PAUSE_READY: ready, MDPRO_GUI_LOCK_PAUSE_GATE: gate };
  return { home, lock, owner, ready, gate, original, env };
}

afterEach(() => { for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "darwin")("ADR0141 WI2 GUI lock (requires macos zsh)", () => {
  it("keeps a foreign lock continuously present during a refused release", async () => {
    const h = harness();
    const release = start(["release", "their-batch", "--acquisition-id", uuid], h.env);
    await waitFor(h.ready);
    let acquired = false;
    let remained = true;
    for (let i = 0; i < 100; i++) {
      remained &&= fs.existsSync(h.lock);
      try { fs.mkdirSync(h.lock); acquired = true; break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    fs.unlinkSync(h.gate);
    const result = await release.done;
    expect(result.code).not.toBe(0);
    expect(acquired).toBe(false);
    expect(remained).toBe(true);
    expect(fs.readFileSync(h.owner, "utf8")).toBe(h.original);
  });
});

function emptyHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "adr0141-gui-empty-"));
  homes.push(home);
  const cache = path.join(home, ".cache");
  fs.mkdirSync(cache);
  const lock = path.join(cache, "desktop-gui.lock");
  const env = { ...process.env, HOME: home, MDPRO_GUARD_TEST: "1", MDPRO_GUI_LOCK_WAIT_SECONDS: "0.05" };
  return { home, cache, lock, env };
}

async function run(args: string[], env: NodeJS.ProcessEnv): Promise<Result> {
  return start(args, env).done;
}

function acquisitionId(stdout: string) {
  expect(stdout).toMatch(/^acquisition_id=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\n$/);
  return stdout.trim().slice("acquisition_id=".length);
}

describe.skipIf(process.platform !== "darwin")("ADR0141 WI2 GUI lock identity and mutex (requires macos zsh)", () => {
  it.each(["wrong batch", "wrong acquisition id"])("keeps the lock path continuously present for a %s releaser", async (variant) => {
    const h = harness();
    const owner = h.original.replace("project=picsee", "project=mdpro");
    fs.writeFileSync(h.owner, owner);
    const batch = variant === "wrong batch" ? "other-batch" : "their-batch";
    const id = variant === "wrong acquisition id" ? "123e4567-e89b-42d3-a456-426614174001" : uuid;
    const release = start(["release", batch, "--acquisition-id", id], { ...h.env, MDPRO_GUI_LOCK_PAUSE_ACTIVE: "1" });
    await waitFor(h.ready);
    let acquired = false;
    for (let i = 0; i < 100; i++) {
      expect(fs.existsSync(h.lock)).toBe(true);
      try { fs.mkdirSync(h.lock); acquired = true; break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    fs.unlinkSync(h.gate);
    const result = await release.done;
    expect(result.code).not.toBe(0);
    expect(acquired).toBe(false);
    expect(fs.readFileSync(h.owner, "utf8")).toBe(owner);
  });

  it("returns fresh UUIDv4 acquisitions and refuses a stale same-batch release", async () => {
    const h = emptyHome();
    const a = await run(["acquire", "batch"], h.env);
    expect(a.code, a.stderr).toBe(0);
    const idA = acquisitionId(a.stdout);
    const ownerA = fs.readFileSync(path.join(h.lock, "owner"), "utf8");
    for (const key of ["project", "session", "batch", "start", "pid", "expected_minutes", "purpose", "acquisition_id"]) {
      expect(ownerA).toMatch(new RegExp(`^${key}=.+$`, "m"));
    }
    const mutex = path.join(h.cache, "desktop-gui.mutex");
    const inode = fs.statSync(mutex).ino;
    expect((await run(["release", "batch", "--acquisition-id", idA], h.env)).stdout).toContain("RELEASED");
    const b = await run(["acquire", "batch"], h.env);
    expect(b.code, b.stderr).toBe(0);
    const idB = acquisitionId(b.stdout);
    expect(idB).not.toBe(idA);
    const ownerB = fs.readFileSync(path.join(h.lock, "owner"), "utf8");
    const stale = await run(["release", "batch", "--acquisition-id", idA], h.env);
    expect(stale.code).not.toBe(0);
    expect(fs.readFileSync(path.join(h.lock, "owner"), "utf8")).toBe(ownerB);
    expect(fs.statSync(mutex).ino).toBe(inode);
    expect((await run(["release", "batch", "--acquisition-id", idB], h.env)).stdout).toContain("RELEASED");
    expect(fs.existsSync(h.lock)).toBe(false);
    expect(fs.statSync(mutex).ino).toBe(inode);
  });

  it.each(["missing owner", "missing id", "duplicate id", "malformed id", "uppercase id", "non-v4 id", "duplicate project", "duplicate batch", "different valid id"])("refuses %s without changing the lock", async (variant) => {
    const h = harness();
    let content = h.original.replace("project=picsee", "project=mdpro").replace("batch=their-batch", "batch=batch");
    if (variant === "missing owner") fs.unlinkSync(h.owner);
    if (variant === "missing id") content = content.replace(/^acquisition_id=.*\n/m, "");
    if (variant === "duplicate id") content += `acquisition_id=${uuid}\n`;
    if (variant === "malformed id") content = content.replace(uuid, "not-a-uuid");
    if (variant === "uppercase id") content = content.replace(uuid, uuid.toUpperCase());
    if (variant === "non-v4 id") content = content.replace(uuid, "123e4567-e89b-12d3-a456-426614174000");
    if (variant === "duplicate project") content += "project=mdpro\n";
    if (variant === "duplicate batch") content += "batch=batch\n";
    if (variant !== "missing owner") fs.writeFileSync(h.owner, content);
    const before = variant === "missing owner" ? null : fs.readFileSync(h.owner, "utf8");
    const supplied = variant === "different valid id" ? "123e4567-e89b-42d3-a456-426614174001" : uuid;
    const result = await run(["release", "batch", "--acquisition-id", supplied], h.env);
    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain("RELEASED");
    expect(fs.existsSync(h.lock)).toBe(true);
    expect(fs.existsSync(h.owner) ? fs.readFileSync(h.owner, "utf8") : null).toBe(before);
  });

  it("only one concurrent release succeeds and a later acquisition survives", async () => {
    const h = emptyHome();
    const id = acquisitionId((await run(["acquire", "batch"], h.env)).stdout);
    const firstReady = path.join(h.home, "first-ready"), firstGate = path.join(h.home, "first-gate");
    fs.writeFileSync(firstGate, "hold\n");
    const first = start(["release", "batch", "--acquisition-id", id], {
      ...h.env, MDPRO_GUI_LOCK_PAUSE_ACTIVE: "1", MDPRO_GUI_LOCK_PAUSE_READY: firstReady, MDPRO_GUI_LOCK_PAUSE_GATE: firstGate,
    });
    await waitFor(firstReady);
    const ready = path.join(h.home, "stale-ready"), gate = path.join(h.home, "stale-gate");
    fs.writeFileSync(gate, "hold\n");
    const second = start(["release", "batch", "--acquisition-id", id], {
      ...h.env, MDPRO_GUI_LOCK_PRE_MUTEX_READY: ready, MDPRO_GUI_LOCK_PRE_MUTEX_GATE: gate,
    });
    await waitFor(ready);
    fs.unlinkSync(firstGate);
    const firstResult = await first.done;
    expect(firstResult.stdout).toContain("RELEASED");
    const later = await run(["acquire", "batch"], h.env);
    const laterId = acquisitionId(later.stdout);
    const owner = fs.readFileSync(path.join(h.lock, "owner"), "utf8");
    fs.unlinkSync(gate);
    const secondResult = await second.done;
    expect([firstResult, secondResult].filter((r) => r.stdout.includes("RELEASED"))).toHaveLength(1);
    expect(secondResult.code).not.toBe(0);
    expect(laterId).not.toBe(id);
    expect(fs.readFileSync(path.join(h.lock, "owner"), "utf8")).toBe(owner);
  });

  it("wait prints the exact ID of the acquisition it eventually wins", async () => {
    const h = emptyHome();
    const firstId = acquisitionId((await run(["acquire", "first"], h.env)).stdout);
    const waiting = start(["wait", "second", "45", "device batch", "tester", "30"], h.env);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect((await run(["release", "first", "--acquisition-id", firstId], h.env)).stdout).toContain("RELEASED");
    const result = await waiting.done;
    expect(result.code, result.stderr).toBe(0);
    const id = acquisitionId(result.stdout);
    expect(fs.readFileSync(path.join(h.lock, "owner"), "utf8")).toContain(`acquisition_id=${id}\n`);
    expect((await run(["release", "second", "--acquisition-id", id], h.env)).stdout).toContain("RELEASED");
  });

  it("restores the owner if lock-directory removal fails", async () => {
    const h = emptyHome();
    const id = acquisitionId((await run(["acquire", "batch"], h.env)).stdout);
    const ownerPath = path.join(h.lock, "owner");
    const owner = fs.readFileSync(ownerPath, "utf8");
    const extra = path.join(h.lock, "extra");
    fs.writeFileSync(extra, "force rmdir failure\n");
    const failed = await run(["release", "batch", "--acquisition-id", id], h.env);
    expect(failed.code).not.toBe(0);
    expect(fs.readFileSync(ownerPath, "utf8")).toBe(owner);
    fs.unlinkSync(extra);
    expect((await run(["release", "batch", "--acquisition-id", id], h.env)).stdout).toContain("RELEASED");
  });

  it("a BSD flock holder blocks each mutation on the persistent shared mutex", async () => {
    const h = emptyHome();
    const mutex = path.join(h.cache, "desktop-gui.mutex");
    fs.writeFileSync(mutex, "");
    const ready = path.join(h.home, "holder-ready"), gate = path.join(h.home, "holder-gate");
    fs.writeFileSync(gate, "hold\n");
    const holderCode = "import fcntl,os,sys,time;f=open(sys.argv[1],'a+');fcntl.flock(f,fcntl.LOCK_EX);open(sys.argv[2],'w').close();\nwhile os.path.exists(sys.argv[3]): time.sleep(.01)";
    const hold = spawn("/usr/bin/python3", ["-c", holderCode, mutex, ready, gate]);
    const holdDone = new Promise<void>((resolve) => hold.on("close", () => resolve()));
    await waitFor(ready);
    const started = start(["acquire", "batch"], h.env);
    let settled = false;
    started.done.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(settled).toBe(false);
    expect(fs.existsSync(h.lock)).toBe(false);
    fs.unlinkSync(gate); await holdDone;
    const acquired = await started.done;
    expect(acquired.code, acquired.stderr).toBe(0);
    const id = acquisitionId(acquired.stdout);
    expect(fs.existsSync(mutex)).toBe(true);
    const inode = fs.statSync(mutex).ino;
    fs.writeFileSync(gate, "hold\n");
    fs.unlinkSync(ready);
    const secondHold = spawn("/usr/bin/python3", ["-c", holderCode, mutex, ready, gate]);
    const secondDone = new Promise<void>((resolve) => secondHold.on("close", () => resolve()));
    await waitFor(ready);
    const release = start(["release", "batch", "--acquisition-id", id], h.env);
    let released = false;
    release.done.then(() => { released = true; });
    const owner = fs.readFileSync(path.join(h.lock, "owner"), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(released).toBe(false);
    expect(fs.readFileSync(path.join(h.lock, "owner"), "utf8")).toBe(owner);
    fs.unlinkSync(gate); await secondDone;
    expect((await release.done).stdout).toContain("RELEASED");
    expect(fs.statSync(mutex).ino).toBe(inode);
    fs.writeFileSync(gate, "hold\n");
    fs.unlinkSync(ready);
    const thirdHold = spawn("/usr/bin/python3", ["-c", holderCode, mutex, ready, gate]);
    const thirdDone = new Promise<void>((resolve) => thirdHold.on("close", () => resolve()));
    await waitFor(ready);
    const waiting = start(["wait", "third", "45", "device batch", "tester", "1"], h.env);
    let waited = false;
    waiting.done.then(() => { waited = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(waited).toBe(false);
    expect(fs.existsSync(h.lock)).toBe(false);
    fs.unlinkSync(gate); await thirdDone;
    expect((await waiting.done).code).toBe(0);
    expect(fs.statSync(mutex).ino).toBe(inode);
  });

  it("uses BSD flock rather than POSIX lockf and documents ID-aware callers", () => {
    // Do not infer mutex compatibility from lockf: an isolated probe on this Mac found it can conflict with flock.
    // The independent BSD-flock holder case above is the shared-protocol proof.
    const source = fs.readFileSync(script, "utf8");
    expect(source).toContain("/usr/bin/python3");
    expect(source).toContain("fcntl.flock");
    expect(source).toContain("fcntl.LOCK_EX");
    expect(source).not.toContain("fcntl.lockf(");
    expect(source).not.toContain("fcntl.fcntl(");
    expect(source).not.toMatch(/\bmv\s+"?\$L|os\.rename\(/);
    for (const file of ["references/guide.md", "references/templates/device-brief-template.md"]) {
      const doc = fs.readFileSync(path.resolve(".agents/skills/mdpro-delegator", file), "utf8");
      expect(doc).toContain("acquisition_id=");
      expect(doc).toContain("--acquisition-id");
      expect(doc).toContain("aborted");
    }
  });

  it("reports a symlinked lock path as held rather than free", async () => {
    const h = emptyHome();
    fs.symlinkSync(h.home, h.lock);
    const status = await run(["status"], h.env);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("HELD:");
    expect(status.stdout).not.toContain("FREE");
  });
});
