// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { files, fixture, load, loadExpression, powershell, quote, tamper } from "./windows-driver-d344-harness";

describe("D344 hash-bound precompiled assembly loader", () => {
  it("loads the actual EXE silently and exposes its public type in a fresh session", async () => {
    const dir = await fixture();
    const before = await files(dir);
    const result = await load(dir);
    expect(result.error).toBeNull();
    expect(result.count).toBe(0);
    expect(result.loaded).toBe(true);
    expect(result.location).toBe(path.join(dir, "native-job.exe"));
    expect(result.members).toEqual(expect.arrayContaining(["Main", "Snapshot", "Stop", "StartOwned"]));
    expect(await files(dir)).toEqual(before);
  });

  it.each(["missing-binary", "missing-manifest", "missing-both"])("keeps exact missing contract for %s without loading", async (kind) => {
    const dir = await fixture();
    await tamper(dir, kind);
    const before = await files(dir);
    const result = await load(dir);
    expect(result).toMatchObject({ error: "NATIVE_BOOTSTRAP_MISSING: run native-build.ps1 before input", count: 0, loaded: false, location: null });
    expect(await files(dir)).toEqual(before);
  });

  it.each(["source", "binary", "manifest-binary"])("refuses %s mismatch before loading and preserves all bytes", async (kind) => {
    const dir = await fixture();
    await tamper(dir, kind);
    const before = await files(dir);
    const result = await load(dir);
    expect(result).toMatchObject({ error: "NATIVE_BOOTSTRAP_STALE", count: 0, loaded: false, location: null });
    expect(await files(dir)).toEqual(before);
  });

  it("preserves a real assembly failure when the corrupt binary matches its manifest", async () => {
    const dir = await fixture();
    await tamper(dir, "corrupt");
    const before = await files(dir);
    const result = await load(dir);
    expect(result.loaded).toBe(false);
    expect(result.error).toMatch(/LoadFrom/);
    expect(result.error).not.toMatch(/NATIVE_BOOTSTRAP_STALE|UI_STEPS_INVALID/);
    expect(await files(dir)).toEqual(before);
  });

  it.each(["source", "binary"])("revalidates actual %s bytes after repeated successful loads", async (kind) => {
    const dir = await fixture();
    const before = await files(dir);
    const target = path.join(dir, kind === "source" ? "native-job.cs" : "native-job.exe");
    const mutation = kind === "source" ? `${quote(target)},'changed source'` : `${quote(target)},[byte[]]@(1,2,3)`;
    const operation = kind === "source" ? "WriteAllText" : "WriteAllBytes";
    const script = `$ErrorActionPreference='Stop'; $root=${quote(dir)}; $rows=@();
      $rows += & { ${loadExpression} }; $rows += & { ${loadExpression} };
      [IO.File]::${operation}(${mutation});
      $rows += & { ${loadExpression} }; $rows | ConvertTo-Json -Compress -Depth 5`;
    const rows = JSON.parse(await powershell(script));
    expect(rows.map((row: { error: string | null }) => row.error)).toEqual([null, null, "NATIVE_BOOTSTRAP_STALE"]);
    expect(rows.map((row: { count: number }) => row.count)).toEqual([0, 0, 0]);
    expect(rows.map((row: { location: string }) => row.location)).toEqual(Array(3).fill(path.join(dir, "native-job.exe")));
    const after = await files(dir);
    expect(after["native-job-build.json"]).toBe(before["native-job-build.json"]);
    expect(after[kind === "source" ? "native-job.exe" : "native-job.cs"]).toBe(before[kind === "source" ? "native-job.exe" : "native-job.cs"]);
    expect(after[path.basename(target)]).not.toBe(before[path.basename(target)]);
  });

  it.each(["source", "binary"])("does not bypass changed manifest %s hash after a successful load", async (kind) => {
    const dir = await fixture();
    const value = JSON.parse(await readFile(path.join(dir, "native-job-build.json"), "utf8"));
    value[kind] = "0".repeat(64);
    const changed = Buffer.from(JSON.stringify(value)).toString("base64");
    const rows = JSON.parse(await powershell(`$ErrorActionPreference='Stop'; $root=${quote(dir)}; $rows=@();
      $rows += & { ${loadExpression} }; $rows += & { ${loadExpression} };
      [IO.File]::WriteAllBytes((Join-Path $root 'native-job-build.json'),[Convert]::FromBase64String('${changed}'));
      $rows += & { ${loadExpression} }; $rows | ConvertTo-Json -Compress -Depth 5`));
    expect(rows.map((row: { error: string | null }) => row.error)).toEqual([null, null, "NATIVE_BOOTSTRAP_STALE"]);
    expect(JSON.parse(await readFile(path.join(dir, "native-job-build.json"), "utf8"))).toEqual(value);
  });
});
