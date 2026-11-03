// @vitest-environment node
// D355 fix 5 (receipt D355-S21): no D355 test reads git history, as a file-level, fail-closed rule. A scanned file
// whose import closure runs a child process and holds a git history verb token is flagged; only a calibrated
// allowlist entry clears it. Every probe below is assembled from pieces, so this file names no child-process module
// and no relative import of its own (attack gap 1).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { D355_TEST_FILES } from "./d355-fix4-lib";
import { type AllowEntry, allowProblems, closure, flagged, fsRead, HISTORY_ALLOWLIST, historyOffenders, type Read } from "./d355-fix5-lib";

const root = path.resolve(__dirname, "../..");
const disk = fsRead(root);
const scanned = () => [...new Set([...D355_TEST_FILES, ...fs.readdirSync(path.join(root, "tests/tooling"))
  .filter((f) => f.startsWith("d355-")).map((f) => `tests/tooling/${f}`)])].sort();

const CP = ["child", "process"].join("_");
const IMP = ["im", "port"].join("");
const REQ = ["req", "uire"].join("");
const FROM = ["fr", "om"].join("");
const imp = (what: string, spec: string) => `${IMP} ${what} ${FROM} "${spec}";`;
const CHILD = imp("{ execFile, spawn, exec }", `node:${CP}`);
const tree = (files: Record<string, string>): Read => (rel) => files[rel];
const one = (body: string, head = CHILD) => tree({ "tests/v/t.test.ts": `${head}\n${body}\n` });
const T = "tests/v/t.test.ts";
const names = (lines: string[]) => lines.map((l) => l.split(": ")[0]);

const made: string[] = [];
afterAll(() => { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe("D355 fix 5: the history rule flags every form both auditors probed", () => {
  it("H1: variable verb, variable argv, spread, multiline, GIT constant, quotes, template, command string, ] in an argument", () => {
    const probes = [
      'const verb = "show"; execFile("git", [verb, rev]);',
      'const args = ["show", rev]; spawn("git", args);',
      'const SHOW = ["show"]; execFile("git", [...SHOW, x]);',
      'execFile("git", [\n  "show", rev]);',
      'const GIT = "git"; run(GIT, ["show", x]);',
      "execFile('git', ['show', x]);",
      "execFile(`git`, [`show`, x]);",
      'exec("git show 22ffe5ea:x");',
      'execFile("git", ["--format=[%h]", "show", x]);',
    ];
    for (const p of probes) expect(flagged([T], one(p)), p).toEqual([`${T}: show`]);
  });

  it("H2: each listed history verb in a literal call is flagged and named", () => {
    for (const v of ["ls-tree", "rev-list", "grep", "blame", "log", "cat-file", "rev-parse", "show", "diff", "merge-base", "archive"]) {
      expect(flagged([T], one(`execFile("git", ["${v}", "X"]);`)), v).toEqual([`${T}: ${v}`]);
    }
  });

  it("H2b: hyphenated compounds and the other history-moving verbs are flagged (attack gap 2)", () => {
    for (const v of ["diff-index", "merge-tree", "show-branch", "cherry-pick", "reset", "switch", "clone"]) {
      expect(flagged([T], one(`execFile("git", ["${v}", "22ffe5ea"]);`)), v).toEqual([`${T}: ${v}`]);
    }
  });

  it("H3: a local helper that runs git makes its importer flagged, also through a verb kept in another module", () => {
    const helper = `${CHILD}\nexport const git = (a: string[]) => execFile("git", a);\n`;
    expect(flagged([T], tree({ "tests/v/helper.ts": helper, [T]: `${imp("{ git }", "./helper")}\ngit(["show", x]);\n` })))
      .toEqual([`${T}: show`]);
    const files = { "tests/v/helper.ts": helper, "tests/v/verb.ts": 'export const VERB = "show";\n',
      [T]: `${imp("{ git }", "./helper")}\n${imp("{ VERB }", "./verb")}\ngit([VERB, x]);\n` };
    expect(flagged([T], tree(files))).toEqual([`${T}: show`]);
  });

  it("H3b/H3c: helpers outside tests/ are followed too, through two hops (attack gap 5)", () => {
    const h = `${CHILD}\nexport const showAt = (r: string) => execFile("git", ["show", r]);\n`;
    expect(flagged([T], tree({ "scripts/h.mjs": h, [T]: `${imp("{ showAt }", "../../scripts/h.mjs")}\nshowAt("22ffe5ea");\n` })))
      .toEqual([`${T}: show`]);
    const chain = { "scripts/a.mjs": `${IMP} "./b.mjs";\nexport const run = 1;\n`, "scripts/b.mjs": `${CHILD}\n`,
      [T]: `${imp("{ run }", "../../scripts/a.mjs")}\nconst v = ["log", "22ffe5ea"];\n` };
    expect(flagged([T], tree(chain))).toEqual([`${T}: log`]);
  });

  it("H4: the exec-a package, and a required child-process module", () => {
    const PKG = ["exe", "ca"].join("");
    expect(flagged([T], one(`await ${PKG}("git", ["log"]);`, imp(`{ ${PKG} }`, PKG)))).toEqual([`${T}: log`]);
    expect(flagged([T], one(`${REQ}("node:${CP}").execSync("git log");`, ""))).toEqual([`${T}: log`]);
  });

  it("H4b: importing a git library flags the file outright (attack gap 3)", () => {
    const iso = ["isomorphic", "git"].join("-"), simple = ["simple", "git"].join("-");
    expect(flagged([T], one('await git.readBlob({ dir, oid: "22ffe5ea" });', imp("git", iso)))).toEqual([`${T}: git library`]);
    expect(flagged([T], one('simpleGit(root).revparse(["22ffe5ea"]);', imp("{ simpleGit }", simple)))).toEqual([`${T}: git library`]);
  });

  it("H5: tree-local git, vitest's describe, and prose verbs without a child process are not flagged", () => {
    expect(flagged([T], one('describe("x", () => { it("y", async () => { execFile("git", ["ls-files", "-z"]); execFile("git", ["init", "-q"]); execFile("git", ["add", "--", "a"]); }); });'))).toEqual([]);
    expect(flagged([T], one('expect(text).toContain("git show <rev> and git log");', ""))).toEqual([]);
  });

  it("H6: fail closed: an unresolvable relative import, an unreadable entry file, a computed specifier each throw", () => {
    expect(() => flagged([T], tree({ [T]: `${imp("{ a }", "./missing")}\n` }))).toThrow(/\.\/missing/);
    expect(() => flagged(["tests/v/none.test.ts"], tree({}))).toThrow(/none\.test\.ts/);
    expect(() => flagged([T], tree({ [T]: `const m = await ${IMP}(p);\n` }))).toThrow(/computed/);
    expect(() => flagged([T], tree({ [T]: `const m = await ${IMP}(\`./h\${n}.ts\`);\n` }))).toThrow(/computed/);
    expect(() => flagged([T], tree({ [T]: `const m = ${REQ}(p);\n` }))).toThrow(/computed/);
  });

  it("H6b: a side-effect import is followed (attack gap 4)", () => {
    const files = { "tests/v/setup.ts": `${CHILD}\nexecFile("git", ["show", "22ffe5ea:x"]);\n`, [T]: `${IMP} "./setup";\n` };
    expect(flagged([T], tree(files))).toEqual([`${T}: show`]);
  });
});

const confined = [
  CHILD, imp("fs", "node:fs"), imp("os", "node:os"), imp("path", "node:path"),
  'const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-"));',
  'await run("git", ["init", "-q"], { cwd: dir });',
  'await run("git", ["show", "HEAD:a"], { cwd: dir });',
].join("\n");
const temp = (file = T): AllowEntry => ({ file, reason: "git runs only in its own mkdtemp repository", scope: "temp-repo" });
const HEAD_ARGV = [["ls-tree", "-r", "-z", "--name-only", "HEAD"]];
const headText = [CHILD, 'const committed = await run("git", ["ls-tree", "-r", "-z", "--name-only", "HEAD"], { cwd: root });'].join("\n");
const head = (file = T): AllowEntry => ({ file, reason: "reads only the checked-out HEAD", scope: "head", argv: HEAD_ARGV });

describe("D355 fix 5: an allowlist entry clears a flagged file only when its scope check holds", () => {
  it("H7: temp-repo: a confined file is cleared; each route to the repo root is a problem", () => {
    expect(allowProblems(temp(), [T], one(confined, ""))).toEqual([]);
    expect(historyOffenders([T], one(confined, ""), [temp()])).toEqual([]);
    const variants = [
      confined.replace("cwd: dir });\nawait", 'cwd: root });\nawait').replace("const dir", 'const root = path.resolve(__dirname, "../.."); const dir'),
      confined.replace("{ cwd: dir });\nawait run(\"git\", [\"show\"", "{ cwd: process.cwd() });\nawait run(\"git\", [\"show\""),
      `${confined}\nconst here = import.meta.url;`,
      `${confined}\nawait run("git", ["log"]);`,
      `${confined}\nawait run("git", ["-C", other, "show", "x"], { cwd: dir });`,
      confined.replace("fs.mkdtempSync(path.join(os.tmpdir(), \"x-\"))", "\"/tmp/fixed\""),
      confined.replace("cwd: dir });\nawait run(\"git\", [\"show\"", "cwd: path.resolve(\".\") });\nawait run(\"git\", [\"show\""),
      confined.replace("cwd: dir });\nawait run(\"git\", [\"show\"", "cwd: process.env.PWD });\nawait run(\"git\", [\"show\""),
      confined.replace("cwd: dir });\nawait run(\"git\", [\"show\"", "cwd: path.join(dir, \"..\", \"..\") });\nawait run(\"git\", [\"show\""),
      `${confined}\n// cwd: dir\nawait run("git", ["log"]);`,
    ];
    for (const v of variants) {
      const p = allowProblems(temp(), [T], one(v, ""));
      expect(p.length, v).toBeGreaterThan(0);
      expect(p.every((s) => s.startsWith(`${T} (temp-repo): `)), p.join("\n")).toBe(true);
      expect(historyOffenders([T], one(v, ""), [temp()]).length, v).toBeGreaterThan(0);
    }
  });

  it("H7c: temp-repo is checked over the entry's imports too (attack gap 7)", () => {
    const files = { "tests/v/h.ts": "export const base = process.cwd();\n", [T]: `${imp("{ base }", "./h")}\n${confined}\n` };
    expect(allowProblems(temp(), [T], tree(files))).toEqual([`${T} (temp-repo): reaches the repository root`]);
  });

  it("H8: head: the pinned ls-tree HEAD is cleared; every other revision form or verb is a problem", () => {
    expect(allowProblems(head(), [T], one(headText, ""))).toEqual([]);
    const variants = [
      headText.replace('"HEAD"]', '"HEAD~1"]'),
      `${headText}\nconst sha = "22ffe5ea1da477d51bd22ee9dfedf8be52fee30d";`,
      `${headText}\nconst p = \`\${BASE}:x\`;`,
      `${headText}\nrun("git", ["ls-tree", "master"]);`,
      `${headText}\nrun("git", ["ls-tree", "FETCH_HEAD"]);`,
      `${headText}\nconst env = { GIT_DIR: d };`,
      `${headText}\nrun("git", ["ls-tree", "@~1"]);`,
      `${headText}\nrun("git", ["ls-tree", ":/D355"]);`,
      `${headText}\nrun("git", ["ls-tree", "22ffe"]);`,
      `${headText}\nrun("git", ["ls-tree", "--all"]);`,
      `${headText}\nrun("git", ["log", "HEAD"]);`,
      headText.replace('"--name-only", ', ""),
    ];
    for (const v of variants) {
      const p = allowProblems(head(), [T], one(v, ""));
      expect(p.length, v).toBeGreaterThan(0);
      expect(p.every((s) => s.startsWith(`${T} (head): `)), p.join("\n")).toBe(true);
    }
  });

  it("H8c: head is checked over the entry's imports too (attack gap 7)", () => {
    const files = { "tests/v/h.ts": 'export const old = "git show 22ffe5ea:x";\n', [T]: `${imp("{ old }", "./h")}\n${headText}\n` };
    expect(allowProblems(head(), [T], tree(files)).length).toBeGreaterThan(0);
  });

  it("H9: an empty reason, an unknown scope, an unscanned file and a stale entry are each a problem", () => {
    const r = one(confined, "");
    expect(allowProblems({ ...temp(), reason: " " }, [T], r)).toEqual([`${T} (temp-repo): no reason`]);
    expect(allowProblems({ ...temp(), scope: "trusted" }, [T], r)).toEqual([`${T} (trusted): unknown scope`]);
    expect(allowProblems(temp(), ["tests/v/other.test.ts"], r)).toEqual([`${T} (temp-repo): not a scanned file`]);
    expect(allowProblems(temp(), [T], one("const x = 1;"))).toEqual([`${T} (temp-repo): clears nothing (the file is not flagged)`]);
  });

  it("H10: on disk, the closure walks real imports, and a mkdtemp tree runs through the same entry point F0 uses (attack gap 9)", () => {
    expect(closure("tests/tooling/rules-budget-caps.test.ts", disk)).toEqual([
      "tests/tooling/rule-citations-lib.ts", "tests/tooling/rules-budget-caps.test.ts", "tests/tooling/rules-budget-fixture.ts",
      "tests/tooling/rules-budget-lib.ts", "tests/tooling/rules-lib-core.ts",
    ]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d355-fix5-"));
    made.push(dir);
    fs.writeFileSync(path.join(dir, "helper.ts"), `${CHILD}\nexport const git = (a: string[]) => execFile("git", a);\n`);
    fs.writeFileSync(path.join(dir, "t.test.ts"), `${imp("{ git }", "./helper")}\ngit(["show", x]);\n`);
    expect(historyOffenders(["t.test.ts"], fsRead(dir), [])).toEqual(["t.test.ts: show"]);
  });
});

describe("D355 fix 5: the real D355 tests", () => {
  it("F0-self: the scan includes this rule's own lib and test", () => {
    expect(scanned()).toEqual(expect.arrayContaining(["tests/tooling/d355-fix5-lib.ts", "tests/tooling/d355-fix5-history.test.ts"]));
  });

  it("F0-raw: before clearing, exactly the S7 export test is flagged", () => {
    expect(names(flagged(scanned(), disk))).toEqual(["tests/tooling/codex-land-guard-export.test.ts"]);
  });

  it("F0-list: the allowlist is the S7 export test, scope head, pinned to its one ls-tree", () => {
    expect(HISTORY_ALLOWLIST.map((e) => [e.file, e.scope, e.argv])).toEqual([
      ["tests/tooling/codex-land-guard-export.test.ts", "head", HEAD_ARGV],
    ]);
  });

  it("F0: no scanned file is flagged uncleared, and no allowlist entry has a problem", () => {
    expect(historyOffenders(scanned(), disk)).toEqual([]);
  });
});
