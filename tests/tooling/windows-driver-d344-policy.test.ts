// @vitest-environment node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ast, unsupportedExe, windows } from "./windows-driver-d344-harness";

describe("D344 unsupported EXE Add-Type guard", () => {
  it("scans every Windows PowerShell script, including variable paths", async () => {
    const offenders: string[] = [];
    const names = (await readdir(windows)).filter((file) => file.endsWith(".ps1"));
    expect(names).toContain("native-job.ps1");
    for (const name of names) {
      const parsed = await ast(await readFile(path.join(windows, name), "utf8"));
      expect(parsed.errors, name).toEqual([]);
      offenders.push(...unsupportedExe(parsed).map((site) => name + ": " + site));
    }
    expect(offenders).toEqual([]);
  }, 15000);

  it.each([
    ["Add-Type -Path 'other.EXE'", 1],
    ['$renamed = Join-Path $PSScriptRoot "other.exe"; Add-Type -Path $renamed', 1],
    ["$renamed='other.exe'; Add-Type -Path $renamed", 1],
    ["aDd-tYpE `\n -pAtH 'other.ExE'", 1],
    ["Add-Type -Path 'source.cs'", 0],
    ["Add-Type -Path 'assembly.dll'", 0],
    ["Add-Type -AssemblyName System.Drawing", 0],
    ["Add-Type 'public class Example {}'", 0],
  ])("classifies %s", async (source, count) => {
    const parsed = await ast(source as string);
    expect(parsed.errors).toEqual([]);
    expect(unsupportedExe(parsed)).toHaveLength(count as number);
  });
});
