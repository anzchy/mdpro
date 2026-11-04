// @vitest-environment node
/** Spawn-heavy T567 receipt-wrapper cases run in the push/manual slow tier. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { calls, CLAUDE_WRAPPER_REL, ROOT, runWrapper, stubRepo, until, WRAPPER_REL } from "./t567-receipt-wrapper-harness";

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
});

describe("T567 r5 receipt wrapper: the repository is its cwd's git top level", () => {
  it("P1/P2 by its .agents path and by its .claude/skills symlink path, it reaches the cwd's repository, not the worktree's", async () => {
    for (const rel of [WRAPPER_REL, CLAUDE_WRAPPER_REL]) {
      const repo = stubRepo(made);
      const run = await runWrapper(RECORD_W1, { cwd: repo.top, env: repo.env(), wrapper: path.join(ROOT, rel) });
      const entry = repo.records().find((r) => r.who === "entry");
      expect({ rel, status: run.status, calls: calls(repo.records()), script: entry?.script }).toEqual({ rel, status: 0, calls: W1_CALLS, script: path.join(repo.top, ENTRY) });
    }
  }, 30000);
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

describe("T567 r5 SKILL.md routes receipts through the wrapper", () => {
  const SKILL_MD = path.join(ROOT, ".agents/skills/jack-tdd-workflow/SKILL.md");
  const skill = () => fs.readFileSync(SKILL_MD, "utf8");

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
});

describe("T567 r5 receipt wrapper: #566's guard and the real receipt store", () => {
  it("G3 no mode by either wrapper path escapes the stub repository, and this worktree's receipt store is untouched", async () => {
    for (const rel of [WRAPPER_REL, CLAUDE_WRAPPER_REL]) for (const args of ALL_MODES) {
      const repo = stubRepo(made);
      await runWrapper(args, { cwd: repo.top, env: repo.env(), wrapper: path.join(ROOT, rel) });
      expect({ rel, mode: args[0], escaped: repo.records().filter((r) => r.who === "escape") }).toEqual({ rel, mode: args[0], escaped: [] });
    }
    expect(storeHash()).toEqual(STORE_BEFORE);
  }, 30000);
});
