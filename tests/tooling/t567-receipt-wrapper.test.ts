// @vitest-environment node
/**
 * T-01 r5 (#569): jack-tdd-workflow's receipt wrapper, run for real from a stub repository
 * (t567-receipt-wrapper-harness.ts). Each mode must reach exactly its spec § Receipts command, refuse anything else
 * without calling the entry, resolve the repository from its cwd, pass its environment on untouched and pass an
 * interrupt on to the receipt command. Matrix: opus-imple-1/T-01-fix-r5-test-matrix.md.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { calls, CLAUDE_WRAPPER_REL, cleanEnv, ROOT, runWrapper, stubRepo, until, WRAPPER_REL } from "./t567-receipt-wrapper-harness";

const made: string[] = [];
/** G3: this worktree's own receipt store, hashed before any case runs. */
// RC5: the store is one file per id under receipts/ and receipt-evidence/; the legacy files are hashed while they exist.
const STORE = [".claude/tdd-guardian/receipts", ".claude/tdd-guardian/receipt-evidence", ".claude/tdd-guardian/receipts.json", ".claude/tdd-guardian/evidence.json"];
const storeHash = () => STORE.map((f) => {
  const full = path.join(ROOT, f), hash = createHash("sha256");
  if (!fs.existsSync(full)) return "absent";
  if (fs.statSync(full).isDirectory()) for (const name of fs.readdirSync(full).sort()) hash.update(`${name}\0`).update(fs.readFileSync(path.join(full, name))).update("\0");
  else hash.update(fs.readFileSync(full));
  return hash.digest("hex");
});
const STORE_BEFORE = storeHash();
afterAll(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

const ENTRY = "scripts/tdd/red-receipt.mjs";
const RECORD_W1 = ["frontend-record", "--id", "T-W", "--test", "tests/a.test.ts"];
const W1_CALLS = [
  `guard --guard-only node ${ENTRY} record --id T-W --test tests/a.test.ts`, `node ${ENTRY} record --id T-W --test tests/a.test.ts`,
  "entry record --id T-W --test tests/a.test.ts",
];
const ALL_MODES: string[][] = [RECORD_W1, ["frontend-verify", "--id", "T-W"], ["rust-record", "--id", "T-W", "--test", "src-tauri/src/a.rs"], ["rust-verify", "--id", "T-W"]];

describe("T567 r5 receipt wrapper: each mode runs its command", () => {
  it("W1 frontend-record reaches the entry through the guard", async () => {
    const repo = stubRepo(made);
    const run = await runWrapper(["frontend-record", "--id", "T-W", "--test", "tests/a.test.ts"], { cwd: repo.top, env: repo.env() });
    expect(calls(repo.records())).toEqual([
      `guard --guard-only node ${ENTRY} record --id T-W --test tests/a.test.ts`,
      `node ${ENTRY} record --id T-W --test tests/a.test.ts`,
      "entry record --id T-W --test tests/a.test.ts",
    ]);
    expect(run.status).toBe(0);
  }, 30000);

  it("W2 frontend-verify reaches the entry through the guard with the id only", async () => {
    const repo = stubRepo(made);
    const run = await runWrapper(["frontend-verify", "--id", "T-W"], { cwd: repo.top, env: repo.env() });
    expect(calls(repo.records())).toEqual([`guard --guard-only node ${ENTRY} verify --id T-W`, `node ${ENTRY} verify --id T-W`, "entry verify --id T-W"]);
    expect(run.status).toBe(0);
  }, 30000);

  it("W3 rust-record reaches the entry directly, with the rust lane, never through the guard", async () => {
    const repo = stubRepo(made);
    const run = await runWrapper(["rust-record", "--id", "T-W", "--test", "src-tauri/src/a.rs"], { cwd: repo.top, env: repo.env() });
    expect(calls(repo.records())).toEqual([
      `node ${ENTRY} record --id T-W --lane rust --test src-tauri/src/a.rs`, "entry record --id T-W --lane rust --test src-tauri/src/a.rs",
    ]);
    expect(run.status).toBe(0);
  });

  it("W4 rust-verify reaches the entry directly with the id only", async () => {
    const repo = stubRepo(made);
    const run = await runWrapper(["rust-verify", "--id", "T-W"], { cwd: repo.top, env: repo.env() });
    expect(calls(repo.records())).toEqual([`node ${ENTRY} verify --id T-W`, "entry verify --id T-W"]);
    expect(run.status).toBe(0);
  });

  it("W5 reaches no cargo and no other script in any mode, and the wrapper names neither", async () => {
    for (const args of ALL_MODES) {
      const repo = stubRepo(made);
      await runWrapper(args, { cwd: repo.top, env: repo.env() });
      const who = repo.records().map((r) => r.who);
      expect(who.filter((w) => w === "cargo" || w === "escape")).toEqual([]);
      expect(who.filter((w) => w === "node")).toHaveLength(1);
    }
    expect(fs.readFileSync(path.join(ROOT, WRAPPER_REL), "utf8")).not.toMatch(/cargo|receipt\.js/);
  }, 30000);

  it("W6 the entry runs as the repository's own script, in its top directory", async () => {
    const repo = stubRepo(made);
    await runWrapper(RECORD_W1, { cwd: repo.top, env: repo.env() });
    const entry = repo.records().find((r) => r.who === "entry")!;
    expect({ script: entry.script, cwd: entry.cwd }).toEqual({ script: path.join(repo.top, ENTRY), cwd: repo.top });
  }, 30000);

  it("W7 exits with the entry's status, through the guard and directly", async () => {
    for (const args of [RECORD_W1, ["rust-verify", "--id", "T-W"]]) {
      const repo = stubRepo(made);
      expect((await runWrapper(args, { cwd: repo.top, env: repo.env({ T567_ENTRY_EXIT: "7" }) })).status).toBe(7);
    }
  }, 30000);

  it("W8 exits 76 when the load guard stops before running anything", async () => {
    const repo = stubRepo(made);
    const run = await runWrapper(RECORD_W1, { cwd: repo.top, env: repo.env({ T567_GUARD_EXIT: "76" }) });
    expect({ status: run.status, who: repo.records().map((r) => r.who) }).toEqual({ status: 76, who: ["guard"] });
  });

  it("W9 passes the receipt command's stdout and stderr through", async () => {
    const repo = stubRepo(made);
    const run = await runWrapper(RECORD_W1, { cwd: repo.top, env: repo.env({ T567_ENTRY_OUT: "ENTRY-OUT 测", T567_ENTRY_ERR: "ENTRY-ERR" }) });
    expect(run.stdout).toContain("ENTRY-OUT 测");
    expect(run.stderr).toContain("ENTRY-ERR");
  });

  it("W10 keeps a CJK, spaced test path and a suffixed id as single arguments", async () => {
    const repo = stubRepo(made);
    await runWrapper(["frontend-record", "--id", "T567-S99b", "--test", "tests/测试 a b.test.ts"], { cwd: repo.top, env: repo.env() });
    expect(repo.records().find((r) => r.who === "entry")!.argv).toEqual(["record", "--id", "T567-S99b", "--test", "tests/测试 a b.test.ts"]);
  }, 30000);

  it("W11 takes --test before --id the same way", async () => {
    const repo = stubRepo(made);
    await runWrapper(["frontend-record", "--test", "tests/a.test.ts", "--id", "T-W"], { cwd: repo.top, env: repo.env() });
    expect(calls(repo.records())).toEqual(W1_CALLS);
  }, 30000);

  it("W12 runs no shell: metacharacters in the id and the path arrive as bytes and run nothing", async () => {
    const id = "T-$(touch pwned)";
    const test = "tests/a\"b`c$HOME;x.test.ts";
    for (const [mode, lane] of [["frontend-record", []], ["rust-record", ["--lane", "rust"]]] as const) {
      const repo = stubRepo(made);
      await runWrapper([mode, "--id", id, "--test", test], { cwd: repo.top, env: repo.env() });
      const entries = repo.records().filter((r) => r.who === "entry");
      expect(entries.map((r) => r.argv)).toEqual([["record", "--id", id, ...lane, "--test", test]]);
      expect(fs.existsSync(path.join(repo.top, "pwned"))).toBe(false);
    }
  }, 30000);

  it("W13 never exits 0 when the receipt command is killed by a signal", async () => {
    const direct = stubRepo(made);
    expect((await runWrapper(["rust-verify", "--id", "T-W"], { cwd: direct.top, env: direct.env({ T567_ENTRY_SIGKILL: "1" }) })).status).toBe(1);
    const guarded = stubRepo(made);
    const run = await runWrapper(RECORD_W1, { cwd: guarded.top, env: guarded.env({ T567_ENTRY_SIGKILL: "1" }) });
    expect(run.status === null || run.status === 0).toBe(false);
  }, 30000);

  it("W14 passes a 2 MiB stdout through whole and keeps the status", async () => {
    const repo = stubRepo(made);
    const run = await runWrapper(["rust-verify", "--id", "T-W"], { cwd: repo.top, env: repo.env({ T567_ENTRY_BIG: String(2 * 1024 * 1024), T567_ENTRY_EXIT: "7" }) });
    expect({ bytes: run.stdout.length, status: run.status }).toEqual({ bytes: 2 * 1024 * 1024, status: 7 });
  });
});

describe("T567 r5 receipt wrapper: refusals call nothing", () => {
  const refused = async (args: string[]) => {
    const repo = stubRepo(made);
    const run = await runWrapper(args, { cwd: repo.top, env: repo.env() });
    return { status: run.status, log: calls(repo.records()), stderr: run.stderr };
  };

  it("R1 refuses an unknown or missing mode with exit 2 and names the four modes", async () => {
    for (const args of [["record", "--id", "X"], ["frontend", "--id", "X"], ["FRONTEND-RECORD", "--id", "X", "--test", "t"], ["", "--id", "X"], []]) {
      const r = await refused(args);
      expect({ args, status: r.status, log: r.log }).toEqual({ args, status: 2, log: [] });
      for (const mode of ["frontend-record", "frontend-verify", "rust-record", "rust-verify"]) expect(r.stderr).toContain(mode);
    }
  });

  it("R2 refuses a missing, valueless or empty id in every mode", async () => {
    const cases = [
      ...["frontend-record", "rust-record"].flatMap((m) => [[m, "--test", "t"], [m, "--test", "t", "--id"], [m, "--id", "", "--test", "t"], [m, "--id", "--test", "t"]]),
      ...["frontend-verify", "rust-verify"].flatMap((m) => [[m], [m, "--id"], [m, "--id", ""]]),
    ];
    for (const args of cases) expect({ args, ...(await refused(args)), stderr: "" }).toEqual({ args, status: 2, log: [], stderr: "" });
  });

  it("R3 refuses a record mode with no test path, a valueless one or an empty one", async () => {
    for (const m of ["frontend-record", "rust-record"]) {
      for (const args of [[m, "--id", "X"], [m, "--id", "X", "--test"], [m, "--id", "X", "--test", ""]]) {
        expect({ args, ...(await refused(args)), stderr: "" }).toEqual({ args, status: 2, log: [], stderr: "" });
      }
    }
  });

  it("R4 refuses a test path on a verify mode", async () => {
    for (const args of [["frontend-verify", "--id", "X", "--test", "t"], ["rust-verify", "--id", "X", "--test", "t"]]) {
      expect({ args, ...(await refused(args)), stderr: "" }).toEqual({ args, status: 2, log: [], stderr: "" });
    }
  });

  it("R5 refuses anything it would have to pass on or invent: an extra option, a repeated id, a stray word, --id=X", async () => {
    const cases = [
      ["rust-record", "--id", "X", "--lane", "rust", "--test", "t"], ["frontend-record", "--id", "X", "--test", "t", "--lane", "rust"],
      ["frontend-verify", "--id", "X", "--id", "Y"], ["rust-verify", "--id", "X", "stray"], ["rust-verify", "stray", "--id", "X"],
      ["frontend-verify", "--id=X"], ["rust-verify", "--id", "X", "__proto__", "y"],
    ];
    for (const args of cases) expect({ args, ...(await refused(args)), stderr: "" }).toEqual({ args, status: 2, log: [], stderr: "" });
  });

  it("R8 refuses a repeated test path", async () => {
    for (const m of ["frontend-record", "rust-record"]) {
      const args = [m, "--id", "X", "--test", "a.test.ts", "--test", "b.test.ts"];
      expect({ args, ...(await refused(args)), stderr: "" }).toEqual({ args, status: 2, log: [], stderr: "" });
    }
  });
});

describe("T567 r5 receipt wrapper: the repository is its cwd's git top level", () => {
  it("P3 run from a subdirectory, it still runs the top's entry in the top", async () => {
    const repo = stubRepo(made);
    const sub = path.join(repo.top, "sub/dir");
    fs.mkdirSync(sub, { recursive: true });
    await runWrapper(RECORD_W1, { cwd: sub, env: repo.env() });
    const entry = repo.records().find((r) => r.who === "entry");
    expect({ calls: calls(repo.records()), script: entry?.script, cwd: entry?.cwd }).toEqual({ calls: W1_CALLS, script: path.join(repo.top, ENTRY), cwd: repo.top });
  });

  it("P1/P2 by its .agents path and by its .claude/skills symlink path, it reaches the cwd's repository, not the worktree's", async () => {
    for (const rel of [WRAPPER_REL, CLAUDE_WRAPPER_REL]) {
      const repo = stubRepo(made);
      const run = await runWrapper(RECORD_W1, { cwd: repo.top, env: repo.env(), wrapper: path.join(ROOT, rel) });
      const entry = repo.records().find((r) => r.who === "entry");
      expect({ rel, status: run.status, calls: calls(repo.records()), script: entry?.script }).toEqual({ rel, status: 0, calls: W1_CALLS, script: path.join(repo.top, ENTRY) });
    }
  }, 30000);

  it("P4 from inside a linked worktree, it runs that worktree's entry in that worktree's top", async () => {
    const repo = stubRepo(made);
    const git = (...a: string[]) => promisify(execFile)("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo.top, env: cleanEnv() });
    await git("add", "scripts", ".agents", ".claude");
    await git("commit", "-qm", "stubs");
    const linked = path.join(repo.top, "linked");
    await git("worktree", "add", "-q", linked);
    fs.mkdirSync(path.join(linked, "sub"));
    await runWrapper(RECORD_W1, { cwd: path.join(linked, "sub"), env: repo.env() });
    const entry = repo.records().find((r) => r.who === "entry");
    expect({ script: entry?.script, cwd: entry?.cwd }).toEqual({ script: path.join(linked, ENTRY), cwd: linked });
  }, 30000);

  it("P5 ignores look-alike scripts in a non-git subdirectory between the cwd and the top", async () => {
    const repo = stubRepo(made);
    const decoy = `#!${process.execPath}\nrequire("node:fs").appendFileSync(process.env.T567_STUB_LOG, JSON.stringify({ who: "decoy" }) + "\\n");\n`;
    for (const f of ["sub/scripts/heavy-lock.sh", "sub/scripts/tdd/red-receipt.mjs"]) {
      fs.mkdirSync(path.dirname(path.join(repo.top, f)), { recursive: true });
      fs.writeFileSync(path.join(repo.top, f), decoy, { mode: 0o755 });
    }
    fs.mkdirSync(path.join(repo.top, "sub/dir"));
    await runWrapper(RECORD_W1, { cwd: path.join(repo.top, "sub/dir"), env: repo.env() });
    expect(calls(repo.records())).toEqual(W1_CALLS);
  }, 30000);

  it("R6 refuses to run outside a git repository", async () => {
    const repo = stubRepo(made);
    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t567-bare-")));
    made.push(bare);
    const run = await runWrapper(RECORD_W1, { cwd: bare, env: repo.env() });
    expect({ failed: run.status !== 0 && run.status !== null, log: calls(repo.records()) }).toEqual({ failed: true, log: [] });
  });

  it("R7 never exits 0 when the guard is missing", async () => {
    const repo = stubRepo(made);
    fs.rmSync(path.join(repo.top, "scripts/heavy-lock.sh"));
    const run = await runWrapper(RECORD_W1, { cwd: repo.top, env: repo.env() });
    expect({ failed: run.status !== 0 && run.status !== null, log: calls(repo.records()) }).toEqual({ failed: true, log: [] });
  });
});

describe("T567 r5 receipt wrapper: its child's environment is its own", () => {
  // The direct child is the guard in the frontend modes and the node shim in the Rust modes; each records process.env.
  const childEnv = async (env: (repo: ReturnType<typeof stubRepo>) => Record<string, string>) => {
    const out: { mode: string; sent: Record<string, string>; got?: Record<string, string> }[] = [];
    for (const args of ALL_MODES) {
      const repo = stubRepo(made);
      const sent = env(repo);
      await runWrapper(args, { cwd: repo.top, env: sent });
      out.push({ mode: args[0], sent, got: repo.records()[0]?.env });
    }
    return out;
  };

  it("E1/E2 adds, removes and changes no variable: CJK and empty values kept, absent tuning variables stay absent", async () => {
    const without = (e: Record<string, string>) => { const c = { ...e }; for (const k of ["VITEST_MAX_WORKERS", "NODE_OPTIONS", "MDPRO_ROLE"]) delete c[k]; return c; };
    for (const r of await childEnv((repo) => without(repo.env({ T567_MARK: "测 值", T567_EMPTY: "" })))) {
      expect({ mode: r.mode, env: r.got }).toEqual({ mode: r.mode, env: r.sent });
      expect(Object.keys(r.got ?? {}).filter((k) => ["VITEST_MAX_WORKERS", "NODE_OPTIONS", "MDPRO_ROLE"].includes(k))).toEqual([]);
    }
  }, 30000);

  it("E3 passes present tuning variables on byte-equal", async () => {
    const tuning = { VITEST_MAX_WORKERS: "8", NODE_OPTIONS: "--max-old-space-size=4096", MDPRO_ROLE: "implementor" };
    for (const r of await childEnv((repo) => repo.env(tuning))) {
      expect({ mode: r.mode, env: r.got }).toEqual({ mode: r.mode, env: r.sent });
      expect(Object.fromEntries(Object.keys(tuning).map((k) => [k, r.got?.[k]]))).toEqual(tuning);
    }
  }, 30000);
});

describe("T567 r5 receipt wrapper: an interrupt is passed on to the receipt command", () => {
  /** Sends `sent` to the wrapper alone once the entry waits; returns the log at the wrapper's close and its exit. */
  async function interrupt(args: string[], sent: NodeJS.Signals) {
    const repo = stubRepo(made);
    const run = runWrapper(args, { cwd: repo.top, env: repo.env({ T567_ENTRY_WAIT: "1" }), onStart: (pid) => {
      void until(() => repo.records().some((r) => r.who === "waiting"), 5000).then(() => process.kill(pid, sent));
    } });
    const done = await run;
    const atClose = repo.records();
    await new Promise((r) => setTimeout(r, 4500));
    return { status: done.status, atClose, after: repo.records() };
  }
  const names = (records: { who: string; name?: string }[]) => records.map((r) => (r.name ? `${r.who}:${r.name}` : r.who));

  it("W15 on SIGTERM the receipt command drains before the wrapper exits, and nothing runs late", async () => {
    const direct = await interrupt(["rust-verify", "--id", "T-W"], "SIGTERM");
    expect({ status: direct.status, atClose: names(direct.atClose).slice(-2), late: names(direct.after).includes("late") })
      .toEqual({ status: 143, atClose: ["sig:SIGTERM", "term-done"], late: false });
    const guarded = await interrupt(RECORD_W1, "SIGTERM");
    expect({ status: guarded.status, atClose: names(guarded.atClose).slice(-4), late: names(guarded.after).includes("late") })
      .toEqual({ status: 1, atClose: ["guard-sig:SIGTERM", "sig:SIGTERM", "term-done", "guard-exit"], late: false });
  }, 30000);

  it("W16 SIGINT is passed on as itself, through the guard and directly", async () => {
    const direct = await interrupt(["rust-verify", "--id", "T-W"], "SIGINT");
    expect({ status: direct.status, atClose: names(direct.atClose).slice(-2), late: names(direct.after).includes("late") })
      .toEqual({ status: 130, atClose: ["sig:SIGINT", "term-done"], late: false });
    const guarded = await interrupt(RECORD_W1, "SIGINT");
    expect({ status: guarded.status, atClose: names(guarded.atClose).slice(-4), late: names(guarded.after).includes("late") })
      .toEqual({ status: 1, atClose: ["guard-sig:SIGINT", "sig:SIGINT", "term-done", "guard-exit"], late: false });
  }, 30000);

  it("W18 SIGHUP is passed on as SIGTERM, the one the guard traps, so the guard still drains its job", async () => {
    const direct = await interrupt(["rust-verify", "--id", "T-W"], "SIGHUP");
    expect({ status: direct.status, atClose: names(direct.atClose).slice(-2), late: names(direct.after).includes("late") })
      .toEqual({ status: 143, atClose: ["sig:SIGTERM", "term-done"], late: false });
    const guarded = await interrupt(RECORD_W1, "SIGHUP");
    expect({ status: guarded.status, atClose: names(guarded.atClose).slice(-4), late: names(guarded.after).includes("late") })
      .toEqual({ status: 1, atClose: ["guard-sig:SIGTERM", "sig:SIGTERM", "term-done", "guard-exit"], late: false });
  }, 30000);

  it("W17 a signal that arrives before the receipt command starts leaves nothing running and is never success", async () => {
    for (const args of [RECORD_W1, ["rust-record", "--id", "T-W", "--test", "src-tauri/src/a.rs"]]) {
      const repo = stubRepo(made, { slowGit: true });
      const run = await runWrapper(args, { cwd: repo.top, env: repo.env(), onStart: (pid) => { setTimeout(() => process.kill(pid, "SIGTERM"), 500); } });
      await new Promise((r) => setTimeout(r, 4000));
      expect({ args, failed: run.status !== 0, log: calls(repo.records()) }).toEqual({ args, failed: true, log: [] });
    }
  }, 30000);
});

describe("T567 r5 receipt wrapper: rule 10's commands are the ones it runs", () => {
  // The exact rule-10 text each case extracts. A change to either line in .claude/rules/10-tdd.md breaks the named case.
  const RULE10 = fs.readFileSync(path.join(ROOT, ".claude/rules/10-tdd.md"), "utf8");
  const A1_RULE = "scripts/heavy-lock.sh --guard-only node scripts/tdd/red-receipt.mjs record --id <ID> --test tests/<file>.test.ts";
  const A2_RULE = "the same guarded command with `verify --id <ID>`";
  const A3_RULE = "node scripts/tdd/red-receipt.mjs record --id <ID> --lane rust --test src-tauri/<file>.rs";
  const line = async (args: string[], who: string, prefix: string) => {
    const repo = stubRepo(made);
    await runWrapper(args, { cwd: repo.top, env: repo.env() });
    return [prefix, ...repo.records().find((r) => r.who === who)!.argv!].join(" ");
  };

  it("A1 frontend-record is rule 10's frontend RED command, verbatim", async () => {
    expect(RULE10).toContain(A1_RULE);
    expect(await line(["frontend-record", "--id", "<ID>", "--test", "tests/<file>.test.ts"], "guard", "scripts/heavy-lock.sh")).toBe(A1_RULE);
  });

  it("A2 frontend-verify is rule 10's same guarded command with verify --id", async () => {
    expect(RULE10).toContain(A2_RULE);
    expect(await line(["frontend-verify", "--id", "<ID>"], "guard", "scripts/heavy-lock.sh")).toBe(A1_RULE.slice(0, A1_RULE.indexOf(" record")) + " verify --id <ID>");
  });

  it("A3 rust-record is rule 10's Rust RED command, verbatim", async () => {
    expect(RULE10).toContain(A3_RULE);
    expect(await line(["rust-record", "--id", "<ID>", "--test", "src-tauri/<file>.rs"], "node", "node")).toBe(A3_RULE);
  });
});

describe("T567 r5 receipt wrapper: #566's guard and the real receipt store", () => {
  it("G1 is not a plugin-tagged suite", () => {
    const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/ci-inventory.json"), "utf8")) as { tests: { id: string[]; prerequisite?: string }[] };
    expect(inventory.tests.filter((t) => /t567-receipt-wrapper/.test(t.id[0]) && t.prerequisite === "plugin")).toEqual([]);
  });

  it("G2 runs on every platform: no skip predicate", () => {
    expect(fs.readFileSync(__filename, "utf8")).not.toMatch(new RegExp(["skip", "If|run", "If"].join("")));
  });

  it("G3 no mode by either wrapper path escapes the stub repository, and this worktree's receipt store is untouched", async () => {
    for (const rel of [WRAPPER_REL, CLAUDE_WRAPPER_REL]) for (const args of ALL_MODES) {
      const repo = stubRepo(made);
      await runWrapper(args, { cwd: repo.top, env: repo.env(), wrapper: path.join(ROOT, rel) });
      expect({ rel, mode: args[0], escaped: repo.records().filter((r) => r.who === "escape") }).toEqual({ rel, mode: args[0], escaped: [] });
    }
    expect(storeHash()).toEqual(STORE_BEFORE);
  }, 30000);
});

describe("T567 r5 SKILL.md routes receipts through the wrapper", () => {
  const SKILL_MD = path.join(ROOT, ".agents/skills/jack-tdd-workflow/SKILL.md");
  const skill = () => fs.readFileSync(SKILL_MD, "utf8");

  it("K1 names the wrapper by its repository path, and the wrapper is a file of the skill", () => {
    expect(skill()).toContain(WRAPPER_REL);
    expect(fs.statSync(path.join(ROOT, WRAPPER_REL)).isFile()).toBe(true);
  });

  it("K2 gives a wrapper call for each mode", () => {
    const calls = ["frontend-record --id <ID> --test", "frontend-verify --id <ID>", "rust-record --id <ID> --test", "rust-verify --id <ID>"];
    expect(calls.filter((c) => !skill().includes(`${WRAPPER_REL} ${c}`))).toEqual([]);
  });

  it("K3 keeps the cargo fmt step: before a Rust record, never between record and verify, and the wrapper never runs it", () => {
    const tokens = ["`cargo fmt`", "before", "Rust record", "never between record and verify"];
    const held = skill().split(/\n[ \t]*\n/).some((paragraph) => {
      let from = 0;
      return tokens.every((t) => { const at = paragraph.indexOf(t, from); from = at + t.length; return at >= 0; }) && /wrapper never runs it/.test(paragraph);
    });
    expect(held).toBe(true);
  });

  it("K5 each wrapper call in SKILL.md, run as written from the repository top, reaches its mode's command", async () => {
    const spans = [...skill().matchAll(/`(node [^`]*receipt\.mjs [^`]*)`/g)].map((m) => m[1]);
    const expected: Record<string, string[]> = {
      "frontend-record": W1_CALLS,
      "frontend-verify": [`guard --guard-only node ${ENTRY} verify --id T-W`, `node ${ENTRY} verify --id T-W`, "entry verify --id T-W"],
      "rust-record": [`node ${ENTRY} record --id T-W --lane rust --test src-tauri/src/a.rs`, "entry record --id T-W --lane rust --test src-tauri/src/a.rs"],
      "rust-verify": [`node ${ENTRY} verify --id T-W`, "entry verify --id T-W"],
    };
    expect(spans.map((span) => span.split(" ")[2]).sort()).toEqual(Object.keys(expected).sort());
    for (const span of spans) {
      const [node, wrapper, mode] = span.split(" ");
      expect([WRAPPER_REL, CLAUDE_WRAPPER_REL]).toContain(wrapper);
      const file = mode.startsWith("rust") ? "src-tauri/src/a.rs" : "tests/a.test.ts";
      const argv = span.replaceAll("<ID>", "T-W").replaceAll("<file>", file).split(" ");
      const repo = stubRepo(made);
      const run = await runWrapper([], { cwd: repo.top, env: repo.env(), command: argv });
      expect({ node, status: run.status, log: calls(repo.records()) }).toEqual({ node: "node", status: 0, log: [argv.join(" "), ...expected[mode]] });
    }
  }, 30000);

  it("R6b outside a git repository it says so in one line and exits 1, with no stack trace", async () => {
    const repo = stubRepo(made);
    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t567-bare-")));
    made.push(bare);
    const run = await runWrapper(["rust-verify", "--id", "T-W"], { cwd: bare, env: repo.env() });
    expect({ status: run.status, stderr: run.stderr, log: calls(repo.records()) })
      .toEqual({ status: 1, stderr: "receipt.mjs: not inside a git repository; run it from the repository\n", log: [] });
  });
});
