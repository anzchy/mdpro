// @vitest-environment node
/**
 * ADR0164-WI1 AC-1: `release.yml` declares a `windows` boolean dispatch input, default `true`
 * (ADR-0164 decision 2). Matrix cases I1, I2, I3′.
 *
 * `scalar()` unquotes (workflowBlocks.cleanScalar), so `default: 'true'` would read as `true`;
 * I3′ therefore checks the raw source lines of the input block, and the synthetic cases prove the
 * raw check rejects the quoted spellings that `scalar()` accepts.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { at, keys, scalar } from "../support/workflowBlocks";

const FILE = path.resolve(__dirname, "..", "..", ".github", "workflows", "release.yml");
const TEXT = fs.readFileSync(FILE, "utf8");

const inputsOf = (text: string) => at(text, ["on", "workflow_dispatch", "inputs"]);

/** The raw lines of one input's block (the `<name>:` line excluded), as written in the file. */
function rawInputLines(text: string, name: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^ {6}${name}:\\s*$`).test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() !== "" && !/^ {8,}/.test(l)) break;
    out.push(l);
  }
  return out;
}

const RAW_DEFAULT_TRUE = /^\s+default:\s+true\s*(#.*)?$/;
const RAW_TYPE_BOOLEAN = /^\s+type:\s+boolean\s*(#.*)?$/;
const rawOk = (text: string) => {
  const raw = rawInputLines(text, "windows");
  return raw.some((l) => RAW_DEFAULT_TRUE.test(l)) && raw.some((l) => RAW_TYPE_BOOLEAN.test(l));
};

const synthetic = (typeLine: string, defaultLine: string) =>
  [
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      windows:",
    "        description: 'x'",
    `        ${typeLine}`,
    `        ${defaultLine}`,
    "jobs: {}",
    "",
  ].join("\n");

describe("ADR0164-WI1 AC-1: the windows dispatch input", () => {
  it("I1 the inputs are exactly ref, version, mode and windows", () => {
    expect(new Set(keys(inputsOf(TEXT) ?? ""))).toEqual(new Set(["ref", "version", "mode", "windows"]));
  });

  it("I2 windows is a boolean defaulting to true, not required, described with ADR-0164", () => {
    const w = at(TEXT, ["on", "workflow_dispatch", "inputs", "windows"]);
    expect(w).not.toBeNull();
    expect(scalar(w, "type")).toBe("boolean");
    expect(scalar(w, "default")).toBe("true");
    expect(scalar(w, "required")).not.toBe("true");
    expect(scalar(w, "description") ?? "").toContain("ADR-0164");
  });

  it("I3′ the raw lines are the unquoted literals `type: boolean` and `default: true`", () => {
    expect(rawOk(TEXT)).toBe(true);
  });

  it("I3′ synthetic: the raw check rejects quoted spellings that scalar() unquotes", () => {
    for (const bad of ["default: 'true'", 'default: "true"']) {
      const text = synthetic("type: boolean", bad);
      expect(scalar(at(text, ["on", "workflow_dispatch", "inputs", "windows"]), "default"), bad).toBe("true");
      expect(rawOk(text), bad).toBe(false);
    }
    expect(rawOk(synthetic('type: "boolean"', "default: true"))).toBe(false);
    expect(rawOk(synthetic("type: string", "default: true"))).toBe(false);
    expect(rawOk(synthetic("type: boolean", "default: false"))).toBe(false);
    expect(rawOk(synthetic("type: boolean", "default: true # ADR-0164"))).toBe(true);
  });
});
