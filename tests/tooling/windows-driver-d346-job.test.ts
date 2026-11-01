// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUN, runD346Job } from "./windows-driver-d346-job-harness";

function bootstrap(setup = "", directory = "$runDir") {
  return runD346Job(`
    ${setup}
    $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($arguments))
    $rc=[NativeJobScope]::Main([string[]]@($scope.Name,$node,$encoded,${directory}))
    $pidValue=[NativeJobScope]::LastPid; $alive=$false
    if($pidValue -gt 0){try{$alive=-not [Diagnostics.Process]::GetProcessById($pidValue).HasExited}catch{}}
    @{rc=$rc;pid=$pidValue;alive=$alive;descriptor=[NativeJobScope]::Descriptor;access=[NativeJobScope]::ObservedAccess} | ConvertTo-Json -Compress
  `);
}
function records(log: string) {
  return log.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

describe("D346 explicit user security and bootstrap evidence", () => {
  it.each([true, false])("A1 enumerate: same user keeps child containment when admin enabled=%s", async (admin) => {
    const r = await bootstrap(`[NativeJobScope]::AdminEnabled=$${admin}`);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.value.rc, r.stderr).toBe(3);
    expect(r.value.access).toBe(5);
    expect(r.value.descriptor).toContain(";;;S-1-5-21-1003)");
    expect(r.value.descriptor).toContain(";;;SY)");
    expect(r.value.descriptor).toContain(";;;BA)");
    expect(r.value.descriptor).not.toMatch(/;;;WD\)|;;;AN\)|O:/);
    expect(await readFile(path.join(r.dir, `effect-${r.value.pid}`), "utf8")).toBe("owned");
    expect(r.trace.indexOf("assign:self")).toBeLessThan(r.trace.findIndex((s) => s.startsWith("create:")));
  }, 15000);

  it("A1 named: unrelated filtered user is denied before creating a descendant", async () => {
    const r = await bootstrap('[NativeJobScope]::AdminEnabled=$false; [NativeJobScope]::TokenSid="S-1-5-21-9999"');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.value).toMatchObject({ rc: 65, pid: 0 });
    expect(r.trace.some((s) => s.startsWith("create:"))).toBe(false);
    expect(records(r.log).at(-1)).toMatchObject({ runId: RUN, job: `Global\\mdpro-driver-${RUN}`, childCreated: false, childResumed: false, code: 65 });
  }, 15000);

  it.each([
    { flag: "FailOpen", code: 65, stage: "open", created: false },
    { flag: "FailAssign", code: 65, stage: "assign", created: false },
    { flag: "FailLaunch", code: 66, stage: "launch", created: false },
    { flag: "FailMembership", code: 66, stage: "launch", created: true },
    { flag: "FailResume", code: 66, stage: "launch", created: true },
    { flag: "FailWait", code: 67, stage: "wait", created: true },
    { flag: "FailExitCode", code: 67, stage: "wait", created: true },
  ])("A2 enumerate: $flag preserves stage/launch truth and drains the exact child", async (c) => {
    const r = await bootstrap(`[NativeJobScope]::${c.flag}=$true`);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.value.rc, r.stderr).toBe(c.code);
    expect(r.value.alive).toBe(false);
    expect(records(r.log).at(-1)).toMatchObject({ runId: RUN, job: `Global\\mdpro-driver-${RUN}`, stage: c.stage, childCreated: c.created, code: c.code });
    if (!c.created) expect(r.value.pid).toBe(0);
  }, 15000);

  it.each([0, 3, 65, 66, 67, 2147483648, 3221225477, 3221225794, 4294967295])(
    "A2 enumerate: worker exit DWORD %s passes through with launched evidence", async (code) => {
      const r = await bootstrap(`[NativeJobScope]::OverrideCode=$true; [NativeJobScope]::ExitCode=[uint32]${code}`);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(Number(r.value.rc) >>> 0, r.stderr).toBe(code);
      expect(records(r.log).at(-1)).toMatchObject({ runId: RUN, stage: "exited", childCreated: true, childResumed: true, code });
      expect(await readFile(path.join(r.dir, `effect-${r.value.pid}`), "utf8")).toBe("owned");
    }, 15000);

  it("A3 named: spaces/CJK in the run root preserve log identity", async () => {
    const r = await bootstrap(`
      $runDir=Join-Path (Join-Path (Join-Path $PSScriptRoot 'quoted root 中文') 'runs') ('a' * 32)
      [void][IO.Directory]::CreateDirectory($runDir)
    `);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.value.rc, r.stderr).toBe(3);
    const log = await readFile(path.join(r.dir, "quoted root 中文", "runs", RUN, "bootstrap.log"), "utf8");
    expect(records(log).at(-1)).toMatchObject({ runId: RUN, job: `Global\\mdpro-driver-${RUN}`, childCreated: true, childResumed: true, code: 3 });
  }, 15000);

  it.each(["other-run", "traversal", "log-unwritable"])("A3 enumerate: %s fails specifically before launching", async (mode) => {
    const setup = mode === "log-unwritable"
      ? "[void][IO.Directory]::CreateDirectory((Join-Path $runDir 'bootstrap.log'))"
      : mode === "other-run" ? "$runDir=Join-Path (Join-Path $PSScriptRoot 'runs') ('b' * 32)"
        : "$runDir=Join-Path $runDir '../outside'";
    const r = await bootstrap(setup);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.value).toMatchObject({ rc: 68, pid: 0 });
    expect(r.stderr).toContain("NATIVE_BOOTSTRAP_FAILED");
    expect(r.stderr).toContain("stage=setup");
    expect(r.trace.some((s) => s.startsWith("create:"))).toBe(false);
    expect(await readFile(path.join(r.dir, "runs", "b".repeat(32), "bootstrap.log"), "utf8").catch(() => "absent")).toBe("absent");
    expect(await readFile(path.join(r.dir, "runs", "outside", "bootstrap.log"), "utf8").catch(() => "absent")).toBe("absent");
  }, 15000);

  it("A3 named: legacy three-argument failure has no run-bound release proof", async () => {
    const r = await runD346Job(`
      [NativeJobScope]::FailOpen=$true
      $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($arguments))
      $rc=[NativeJobScope]::Main([string[]]@($scope.Name,$node,$encoded))
      @{rc=$rc;pid=[NativeJobScope]::LastPid}|ConvertTo-Json -Compress
    `);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.value).toMatchObject({ rc: 1, pid: 0 });
    expect(r.log).toBe("");
  }, 15000);
});

describe("D346 pinned member exit observation", () => {
  it.each([
    { exit: true, wait: 0, omitted: true },
    { exit: false, wait: 258, omitted: false },
    { exit: false, wait: 4294967295, omitted: false },
  ])("C1/C2 enumerate: identity race exit=$exit wait=$wait retains unresolved lifetimes", async (c) => {
    const r = await runD346Job(`
      $a=$scope.StartOwned($node,'-e "setInterval(()=>{},1000)"')
      $b=$scope.StartOwned($node,'-e "setInterval(()=>{},1000)"')
      [NativeJobScope]::ThrowIdentity=$true; [NativeJobScope]::ExitAtIdentity=$${c.exit}
      [NativeJobScope]::ZeroWaitOutcome=[long]${c.wait}
      $members=@($scope.Snapshot())
      @{a=$a.Id;b=$b.Id;members=$members;identityHandle=[NativeJobScope]::IdentityHandle;waitHandle=[NativeJobScope]::LastZeroWaitHandle;bAlive=(-not $b.HasExited)}|ConvertTo-Json -Compress -Depth 8
    `);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const members = r.value.members as Array<{ pid: number; birth?: string; alive?: boolean; exited?: boolean; proof?: string }>;
    expect(r.value.bAlive).toBe(true);
    expect(members.some((m) => m.pid === r.value.b)).toBe(true);
    const raced = members.find((m) => m.pid === r.value.a);
    if (c.omitted) {
      if (raced) expect(raced).toMatchObject({ exited: true, proof: "pinned-handle-signaled" });
      expect(r.value.waitHandle).toBe(r.value.identityHandle);
      expect(Number(r.value.waitHandle)).not.toBe(0);
    } else {
      expect(raced).toMatchObject({ birth: "", alive: true });
      expect(raced?.exited).not.toBe(true);
    }
  }, 15000);

  it("C2 named: membership-query failure remains explicit instead of hiding a live member", async () => {
    const r = await runD346Job(`
      $a=$scope.StartOwned($node,'-e "setInterval(()=>{},1000)"')
      [NativeJobScope]::FailMembership=$true
      $members=@($scope.Snapshot())
      @{members=$members;alive=(-not $a.HasExited);pid=$a.Id}|ConvertTo-Json -Compress -Depth 8
    `);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.value.alive).toBe(true);
    expect(r.value.members).toEqual([expect.objectContaining({ pid: r.value.pid, birth: "", alive: true })]);
  }, 15000);
});
