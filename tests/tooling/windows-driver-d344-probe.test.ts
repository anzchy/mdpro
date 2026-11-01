// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ast, files, fixture, probe, readonlyViolations, tamper, windows } from "./windows-driver-d344-harness";

const success = ["OK bootstrap-load", "OK type-resolution", "OK steps-json"];

describe("D344 read-only setup probe", () => {
  it("loads, resolves and validates the fixed smoke steps without file changes on repeat", async () => {
    const dir = await fixture();
    const before = await files(dir);
    expect(await probe(dir)).toEqual(success);
    expect(await files(dir)).toEqual(before);
    expect(await probe(dir)).toEqual(success);
    expect(await files(dir)).toEqual(before);
  });

  it.each(["missing-binary", "missing-manifest", "source", "binary"])("reports %s without false dependent success or repair", async (kind) => {
    const dir = await fixture();
    await tamper(dir, kind);
    const before = await files(dir);
    const expected = kind.startsWith("missing") ? "NATIVE_BOOTSTRAP_MISSING: run native-build.ps1 before input" : "NATIVE_BOOTSTRAP_STALE";
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await probe(dir);
      expect(result[0]).toBe("FAIL bootstrap-load " + expected);
      expect(result).not.toContain("OK type-resolution");
      expect(result).not.toContain("OK bootstrap-load");
      expect(result.at(-1)).toBe("OK steps-json");
      expect(await files(dir)).toEqual(before);
    }
  });

  it("keeps a matching-hash assembly error distinct from hash and JSON refusal", async () => {
    const dir = await fixture();
    await tamper(dir, "corrupt");
    const before = await files(dir);
    const result = await probe(dir);
    expect(result[0]).toMatch(/^FAIL bootstrap-load .*LoadFrom/);
    expect(result.join("\n")).not.toMatch(/NATIVE_BOOTSTRAP_STALE|UI_STEPS_INVALID|OK type-resolution/);
    expect(result.at(-1)).toBe("OK steps-json");
    expect(await files(dir)).toEqual(before);
  });

  it("allows only setup reads and metadata operations in the complete transitive probe source", async () => {
    let source = "";
    try { source = await readFile(path.join(windows, "native-setup-probe.ps1"), "utf8"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    expect(source).not.toBe("");
    const parsed = await ast(source);
    expect(parsed.commands.filter((c) => c.name?.toLowerCase() === "read-nativesteps")).toHaveLength(1);
    expect(source).toContain('[{"op":"max"},{"op":"wait","ms":500},{"op":"windows"}]');
    for (const file of ["native-setup-probe.ps1", "native-job.ps1", "native-validation.ps1"]) {
      expect(readonlyViolations(await ast(await readFile(path.join(windows, file), "utf8"))), file).toEqual([]);
    }
  });

  it.each([
    "Start-ScheduledTask -TaskName anything", "New-Object NativeJobScope 'anything'",
    "[NativeJobScope]::Main(@())", "[W32]::SendScan(1,$false,$false)",
    "Start-Process notepad.exe", "Invoke-Expression 'anything'", "& $dynamic",
    '[IO.File]::WriteAllText("x","y")', '. "$PSScriptRoot/native-supervisor.ps1"',
    "'anything' > output.txt",
  ])("rejects the activity audit control %s without executing it", async (source) => {
    expect(readonlyViolations(await ast(source)).length).toBeGreaterThan(0);
  });
});
