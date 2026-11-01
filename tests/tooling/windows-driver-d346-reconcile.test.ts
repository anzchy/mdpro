// @vitest-environment node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { alive, canary, complete, exited, exists, legacy, OTHER, reconcileFixture, RUN, unresolved, type Fixture, type Result } from "./windows-driver-d346-reconcile-harness";

// D346 matrix R1–R8; all OS doubles are paired with tester-owned integration case I1.
async function preserved(f: Fixture) {
  expect(await readFile(f.latch, "utf8")).toBe(f.latchBytes);
  expect(await readFile(f.manifest, "utf8")).toBe(f.manifestBytes);
  expect(await exists(path.join(f.runDir, "reconciled.json"))).toBe(false);
  expect(await readFile(path.join(f.dir, "unrelated"), "utf8")).toBe("unrelated-task-and-job-must-remain");
}
async function refused(f: Fixture, r: Result, reason?: string) {
  expect(r.status, r.stdout + r.stderr).toBe(1);
  expect(r.value).toMatchObject({ status: "refused" });
  expect(r.value.reason).toMatch(/^NATIVE_/);
  if (reason) expect(r.value.reason).toBe(reason);
  await preserved(f);
}
async function reconciled(f: Fixture, r: Result, members: number) {
  expect(r.status, r.stdout + r.stderr).toBe(0);
  expect(r.value).toMatchObject({ runId: RUN, status: "reconciled", checks: { owned: "none-alive", members } });
  expect(await exists(f.latch)).toBe(false);
  expect(await readFile(path.join(f.runDir, "reconciled.json"), "utf8")).toBe(f.latchBytes);
  expect(await readFile(f.manifest, "utf8")).toBe(f.manifestBytes);
  const proof = JSON.parse(await readFile(path.join(f.runDir, "reconcile-checks.json"), "utf8"));
  expect(proof).toMatchObject({ runId: RUN, checks: { owned: "none-alive" } });
  expect(await f.trace()).toContain("latch-move-proof=True");
}

describe("D346 reconcile unreadable member proofs", () => {
  it("R1 named: reconciles the exact b2985c57 singleton with positive absence and confirmation", async () => {
    const f = await reconcileFixture();
    const r = await f.run();
    await reconciled(f, r, 1);
    expect(r.value.checks).toMatchObject({ heldInput: "operator-confirmed" });
    expect(await f.trace()).toContain(`open:Global\\mdpro-driver-${RUN}`);
  }, 15000);

  it.each(["same", "reused", "unreadable"])("R2 enumerate: refuses %s legacy PID and preserves the live canary", async (mode) => {
    const child = canary();
    try {
      const f = await reconcileFixture({ manifest: legacy(child.pid!), process: mode });
      await refused(f, await f.run());
      expect(alive(child.pid!)).toBe(true);
    } finally { child.kill(); }
  }, 15000);

  it.each(["denied", "failure", "null"])("R3 enumerate: %s is not an OS absence proof", async (mode) => {
    const f = await reconcileFixture({ process: mode, message: "进程已退出，因此无法处理请求。 / absent" });
    await refused(f, await f.run());
  }, 15000);

  it.each(["不存在 / not found", "Zugriff verweigert / access denied"])("R3 enumerate: error category decides absence despite message %j", async (message) => {
    const f = await reconcileFixture({ process: "absent", message });
    await reconciled(f, await f.run(), 1);
  }, 15000);

  it.each([
    ["present", "absent"], ["denied", "absent"], ["failure", "absent"],
    ["absent", "present"], ["absent", "denied"], ["absent", "unknown"],
  ])("R4 enumerate: task=%s job=%s cannot establish quiescence", async (task, job) => {
    const f = await reconcileFixture({ task, job });
    await refused(f, await f.run());
    if (job === "present") expect(await f.trace()).toContain("close:41");
  }, 15000);

  it.each([
    ["empty-array", [], 0], ["legacy-array", [legacy()], 1], ["complete", complete(), 1],
    ["mixed", [legacy(), complete()], 2], ["english-unreadable", { pid: 16044, birth: "", exe: "unreadable: access denied" }, 1],
  ])("R5 enumerate: valid manifest %s is judged using positive absence", async (_name, manifest, count) => {
    const f = await reconcileFixture({ manifest });
    await reconciled(f, await f.run(), Number(count));
  }, 15000);

  it("R5 named: whitespace empty manifest preserves the existing empty-run contract", async () => {
    const f = await reconcileFixture({ raw: " \r\n" });
    await reconciled(f, await f.run(), 0);
  }, 15000);

  it.each([
    ["malformed-json", "{"], ["scalar", '"unreadable"'], ["null-member", "[null]"],
    ["missing-pid", JSON.stringify({ birth: "", exe: "unreadable" })],
    ...[0, -1, "abc", 2147483648, "99999999999999999999"].map((pid) => [`pid-${pid}`, JSON.stringify({ ...legacy(), pid })]),
    ["empty-exe", JSON.stringify({ ...legacy(), exe: "" })],
    ["missing-birth", JSON.stringify({ pid: 16044, exe: "unreadable" })],
  ])("R5 enumerate: malformed member %s fails closed", async (_name, raw) => {
    const f = await reconcileFixture({ raw });
    await refused(f, await f.run(), "NATIVE_RECONCILE_MANIFEST_INVALID");
  }, 15000);

  it.each([
    ["absent", true], ["same", false], ["reused", true], ["unreadable", false],
  ])("R6 enumerate: complete identity retains %s lifetime semantics", async (mode, allowed) => {
    const child = canary();
    try {
      const f = await reconcileFixture({ manifest: complete(child.pid!), process: String(mode) });
      const r = await f.run();
      if (allowed) await reconciled(f, r, 1); else await refused(f, r);
      expect(alive(child.pid!)).toBe(true);
    } finally { child.kill(); }
  }, 15000);

  it.each(["same", "denied"])("R7 enumerate: every member order refuses one %s member", async (mode) => {
    const a = legacy(16044), b = complete(16045), c = legacy(16046);
    for (const manifest of [[a, b, c], [c, a, b], [b, c, a]]) {
      const f = await reconcileFixture({ manifest, processes: { "16046": mode } });
      await refused(f, await f.run());
    }
  }, 30000);

  it.each([
    ["released", false, true], ["released", true, true], ["uncertain", false, false], ["uncertain", true, true],
  ])("R7 enumerate: held=%s confirmation=%s gates an otherwise absent run", async (held, confirmed, allowed) => {
    const f = await reconcileFixture({ manifest: [legacy(), complete()], held: String(held) });
    const r = await f.run(["-RunId", RUN, ...(confirmed ? ["-InputReleasedConfirmed"] : [])]);
    if (allowed) await reconciled(f, r, 2);
    else await refused(f, r, "NATIVE_RECONCILE_INPUT_UNCONFIRMED");
  }, 15000);

  it("R8 named: an actual exclusive-lock contender cannot consume the latch", async () => {
    const f = await reconcileFixture();
    const owner = await f.holdLock();
    try { await refused(f, await f.run(), "NATIVE_SESSION_BUSY"); }
    finally { owner.kill(); }
  }, 15000);

  it("R8 named: wrong-run, repeated and old-run retries preserve the current latch", async () => {
    const f = await reconcileFixture();
    await refused(f, await f.run(["-RunId", OTHER, "-InputReleasedConfirmed"]), "NATIVE_RECONCILE_RUN_MISMATCH");
    await reconciled(f, await f.run(), 1);
    const repeated = await f.run();
    expect(repeated.value).toMatchObject({ status: "refused", reason: "NATIVE_RECONCILE_NOT_LATCHED" });
    const otherBytes = JSON.stringify({ runId: OTHER, heldInput: "released" });
    await writeFile(f.latch, otherBytes);
    const oldRun = await f.run();
    expect(oldRun.value).toMatchObject({ status: "refused", reason: "NATIVE_RECONCILE_RUN_MISMATCH" });
    expect(await readFile(f.latch, "utf8")).toBe(otherBytes);
    expect(await readFile(path.join(f.runDir, "reconciled.json"), "utf8")).toBe(f.latchBytes);
  }, 30000);

  it.each(["input", "control"] as const)("R9 enumerate: %s pinned exit proof cannot target a reused PID", async (job) => {
    const child = canary();
    try {
      const f = await reconcileFixture({ manifest: exited(job, child.pid!), process: "reused" });
      await reconciled(f, await f.run(), 1);
      expect(alive(child.pid!)).toBe(true);
      expect(await f.trace()).not.toContain(`process:${child.pid!}`);
    } finally { child.kill(); }
  }, 15000);

  it.each([
    { job: "input", process: "absent" },
    { job: "input", process: "same" },
    { job: "input", process: "reused" },
    { job: "input", process: "unreadable" },
    { job: "input", process: "denied" },
    { job: "input", process: "failure" },
    { job: "input", process: "null" },
    { job: "control", process: "absent" },
    { job: "control", process: "same" },
    { job: "control", process: "reused" },
    { job: "control", process: "unreadable" },
    { job: "control", process: "denied" },
    { job: "control", process: "failure" },
    { job: "control", process: "null" },
  ] as const)(
    "R9 enumerate: tagged unresolved $job/$process never gains an absence proof from its tag", async ({ job, process }) => {
      const child = canary();
      try {
        const f = await reconcileFixture({ manifest: unresolved(job, child.pid!), process });
        const r = await f.run();
        if (process === "absent") await reconciled(f, r, 1); else await refused(f, r);
        expect(alive(child.pid!)).toBe(true);
      } finally { child.kill(); }
    }, 15000);

  it.each([
    ["string-exited", { ...exited("input"), exited: "true" }],
    ["null-exited", { ...exited("input"), exited: null }],
    ["false-exited-without-identity", { ...exited("input"), exited: false }],
    ["unknown-job", { ...exited("input"), job: "other" }],
    ["missing-job", { pid: 16044, exited: true, proof: "pinned-handle-signaled" }],
    ["invalid-pid", { ...exited("input"), pid: 0 }],
    ["contradictory-flags", { ...exited("input"), alive: true }],
    ["missing-proof", { pid: 16044, job: "input", exited: true }],
    ["wrong-proof", { ...exited("input"), proof: "exception-says-exited" }],
    ["unresolved-string-alive", { ...unresolved("control"), alive: "true" }],
    ["unresolved-false-alive", { ...unresolved("control"), alive: false }],
    ["unresolved-missing-job", { ...legacy(), alive: true }],
    ["unresolved-unknown-job", { ...unresolved("control"), job: "other" }],
  ])("R9 enumerate: malformed new proof %s refuses before consuming evidence", async (_name, member) => {
    const f = await reconcileFixture({ manifest: member });
    await refused(f, await f.run(), "NATIVE_RECONCILE_MANIFEST_INVALID");
  }, 15000);

  it.each([0, 1, 2, 3])("R9 enumerate: mixed proof order %s preserves all-member conjunction", async (position) => {
    const ended = exited("control", 16047), absent = unresolved("input", 16048);
    const members = [legacy(), complete(), ended, absent];
    members.splice(position, 0, unresolved("control", 16049));
    const f = await reconcileFixture({ manifest: members, processes: { "16049": "denied" } });
    await refused(f, await f.run());
    const allAbsent = await reconcileFixture({ manifest: members });
    await reconciled(allAbsent, await allAbsent.run(), members.length);
  }, 30000);
});
