// @vitest-environment node
/**
 * Purpose: Pin where a `#### Windows 差异` table may stand (after its area's
 * inventory table, inside Part 1, with the exact `| 能力 | Windows | 说明 |`
 * header), and that `node scripts/ledger/check.mjs` — the command behind
 * `pnpm ledger:check` — actually runs the D191 gates (ADR-0089, D191-WI-1).
 *
 * `check.mjs` takes no ledger path: it reads `docs/feature-ledger.md` relative
 * to its own location. The end-to-end cases therefore copy `scripts/ledger/`
 * into a temp root next to a fixture `docs/feature-ledger.md` and run the copy,
 * so the real script, not a recomposition of its rules, is what is tested.
 *
 * @module tests/feature-ledger-windows-diff-gate.test
 * @coordinates-with scripts/ledger/windowsDiff.mjs, scripts/ledger/check.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script, no .d.ts by design
import { checkWindowsDiffs } from "../../scripts/ledger/windowsDiff.mjs";
import { DIFF_HEAD, VALID_TWO_AREAS, diff, inventory, ledger, lineOf } from "../support/ledgerWindowsDiff";

interface Finding {
  rule: string;
  message: string;
  lineNumber?: number;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const findings = (md: string): Finding[] => checkWindowsDiffs(md);

/** Exactly one structure finding, at the given line, and nothing else. */
function expectOneStructureFinding(md: string, atLine: string) {
  const f = findings(md);
  expect(f, JSON.stringify(f)).toHaveLength(1);
  expect(f[0].rule).toBe("windows-diff-structure");
  expect(f[0].lineNumber).toBe(lineOf(md, atLine));
}

describe("structure of a difference table", () => {
  it("a heading followed by a table with the wrong header is a finding, not silently ignored", () => {
    const md = ledger([
      {
        area: "文件",
        body: [...inventory("保存"), "", "#### Windows 差异", "", "| 能力 | 状态 | 说明 |", "| --- | --- | --- |", "| 不存在 | bogus | |"],
      },
    ]);
    expectOneStructureFinding(md, "#### Windows 差异");
  });

  it("a heading followed by no table at all is a finding", () => {
    const md = ledger([{ area: "文件", body: [...inventory("保存"), "", "#### Windows 差异", "", "都一样。"] }]);
    expectOneStructureFinding(md, "#### Windows 差异");
  });

  it("a difference header with no separator row is a finding (it renders as prose)", () => {
    const md = ledger([
      { area: "文件", body: [...inventory("保存"), "", "#### Windows 差异", "", "| 能力 | Windows | 说明 |", "| 保存 | Unknown | |"] },
    ]);
    expectOneStructureFinding(md, "#### Windows 差异");
  });

  it("a difference table before its area's inventory table is a finding", () => {
    const md = ledger([{ area: "文件", body: [...diff(["保存", "Unknown", ""]), "", ...inventory("保存")] }]);
    expectOneStructureFinding(md, "#### Windows 差异");
  });

  it("a difference table in an area with no inventory does not borrow the previous area's", () => {
    const md = ledger([
      { area: "文件", body: inventory("保存") },
      { area: "平台", body: ["说明文字。", "", ...diff(["保存", "Unknown", ""])] },
    ]);
    expectOneStructureFinding(md, "#### Windows 差异");
  });

  it("a difference table directly under the Part 1 heading, before any area, is a finding", () => {
    const md = ledger([{ area: "文件", body: inventory("保存") }]).replace(
      "## Part 1 — mdpro 现在有什么\n",
      ["## Part 1 — mdpro 现在有什么", "", ...diff(["保存", "Unknown", ""]), ""].join("\n"),
    );
    expectOneStructureFinding(md, "#### Windows 差异");
  });

  it("a difference table outside Part 1 is a finding", () => {
    const md = ledger([{ area: "文件", body: inventory("保存") }], {
      afterPart1: ["### 某个对照", "", ...inventory("保存"), "", ...diff(["保存", "Unknown", ""]), ""],
    });
    expectOneStructureFinding(md, "#### Windows 差异");
  });

  it("a second difference table in the same area is a finding at its heading", () => {
    const md = ledger([
      { area: "文件", body: [...inventory("保存", "打开文件"), "", ...diff(["保存", "Unknown", ""]), "", ...diff(["打开文件", "Unknown", ""])] },
    ]);
    const headings = md.split("\n").flatMap((l, i) => (l === "#### Windows 差异" ? [i + 1] : []));
    const f = findings(md);
    expect(f).toHaveLength(1);
    expect(f[0].rule).toBe("windows-diff-structure");
    expect(f[0].lineNumber).toBe(headings[1]);
  });

  it("a difference header without its `#### Windows 差异` heading is a finding", () => {
    const md = ledger([
      { area: "文件", body: [...inventory("保存"), "", ...DIFF_HEAD.slice(2), "| 保存 | Unknown | |"] },
    ]);
    expectOneStructureFinding(md, "| 能力 | Windows | 说明 |");
  });
});

describe("`node scripts/ledger/check.mjs` runs the D191 gates (end to end)", () => {
  const tempRoots: string[] = [];
  afterAll(() => {
    for (const dir of tempRoots) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A temp repo root holding a copy of scripts/ledger/ and the fixture as the ledger. */
  function runGateOn(markdown: string) {
    const source = path.join(REPO_ROOT, "scripts/ledger");
    expect(fs.existsSync(path.join(source, "check.mjs")), "scripts/ledger/check.mjs is missing").toBe(true);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdpro-d191-ledger-"));
    tempRoots.push(root);
    fs.cpSync(source, path.join(root, "scripts/ledger"), { recursive: true });
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "docs/feature-ledger.md"), markdown);
    expect(fs.existsSync(path.join(root, "scripts/ledger/check.mjs"))).toBe(true);
    const run = spawnSync("node", ["scripts/ledger/check.mjs", "--require"], { cwd: root, encoding: "utf8" });
    expect(run.error, `could not run the ledger gate: ${run.error?.message}`).toBeUndefined();
    return run;
  }

  it("control: a valid fixture with difference tables exits 0 with 0 findings", () => {
    const run = runGateOn(VALID_TWO_AREAS);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("0 findings");
  });

  it("one violation of each gate exits non-zero and prints every finding", () => {
    const md = ledger([
      {
        area: "文件",
        body: [...inventory("保存", "打开文件"), "", ...diff(["导出 PDF", "Unknown", ""], ["保存", "Yes", ""], ["打开文件", "Partial", ""])],
      },
      { area: "平台", body: ["#### Windows 差异", "", "都一样。"] },
    ]);
    const run = runGateOn(md);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
    expect(run.stdout).toContain("4 findings");
    expect(run.stdout).toContain(`docs/feature-ledger.md:${lineOf(md, "| 导出 PDF | Unknown |  |")}  [windows-diff-match]`);
    expect(run.stdout).toMatch(/\[windows-diff-enum\] .*"Yes"/);
    expect(run.stdout).toMatch(/\[windows-diff-partial-note\] .*打开文件/);
    expect(run.stdout).toContain("[windows-diff-structure]");
  });
});

describe("the live ledger stays valid under the D191 gates", () => {
  const ledgerPath = path.join(REPO_ROOT, "docs/feature-ledger.md");

  it("docs/feature-ledger.md as it is today has no Windows-difference findings", () => {
    expect(fs.existsSync(ledgerPath), "docs/feature-ledger.md is missing").toBe(true);
    expect(findings(fs.readFileSync(ledgerPath, "utf8"))).toEqual([]);
  });

  it("`node scripts/ledger/check.mjs --require` on the real repo still reports 0 findings", () => {
    const run = spawnSync("node", ["scripts/ledger/check.mjs", "--require"], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(run.error, `could not run the ledger gate: ${run.error?.message}`).toBeUndefined();
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("0 findings");
  });
});

// The Windows gates find Part 1 by its `## Part 1` heading (ADR-0089 placement
// rule, delegator ruling 2026-10-13). Renaming that heading would hide every
// difference table from the gate, so the live ledger must keep it.
describe("the live ledger keeps the heading the Windows gates rely on", () => {
  it("docs/feature-ledger.md has exactly one `## Part 1` heading", () => {
    const file = path.join(REPO_ROOT, "docs/feature-ledger.md");
    expect(fs.existsSync(file), "docs/feature-ledger.md is missing").toBe(true);
    const headings = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith("## Part 1"));
    expect(headings).toHaveLength(1);
  });
});
