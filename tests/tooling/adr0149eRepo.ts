/**
 * Purpose: A throwaway git repository for the ADR0149E receipt-evidence tests: `master`
 * plus a `feature` branch, the real tdd-guardian plugin, the repo's `unit-red` lane, a
 * `rust` lane whose cargo is `fixtures/adr0149e/fake-cargo.mjs`, and helpers to drive
 * `scripts/tdd/red-receipt.mjs` against it.
 * @coordinates-with tests/tooling/d302Child.ts
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createOwnerChildRunner } from "./d302Child";

export const repo = resolve(import.meta.dirname, "../..");
export const entryScript = join(repo, "scripts/tdd/red-receipt.mjs");
const cache = join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian");
export const pluginVersion = existsSync(cache)
  ? readdirSync(cache).filter((name) => existsSync(join(cache, name, "scripts/tdd-guardian/receipt.js"))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] ?? null
  : null;

export interface Receipt { id: string; lane: string; recorded_at: string; verdict: string | null; red: { kind: string }; test_files: Record<string, unknown> }
export type ReceiptRepo = Awaited<ReturnType<typeof createReceiptRepo>>;

export async function createReceiptRepo(signal: AbortSignal) {
  const owner = createOwnerChildRunner(signal);
  const root = mkdtempSync(join(tmpdir(), "mdpro-adr0149e-"));
  const run = async (command: string, args: string[], env: Record<string, string> = {}) => {
    const result = await owner.run(command, args, { cwd: root, env: { ...process.env, VITEST_MAX_WORKERS: "1", ...env }, timeout: 120_000 });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, output: `${result.stdout}\n${result.stderr}` };
  };
  const write = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const git = (...args: string[]) => run("git", args);
  const entry = (...args: string[]) => run(process.execPath, [entryScript, ...args, "--cwd", root]);
  const commit = async (message: string) => { await git("add", "."); return git("commit", "-qm", message); };
  const store = () => JSON.parse(read(".claude/tdd-guardian/receipts.json")).receipts as Receipt[];
  const evidence = () => (existsSync(join(root, ".claude/tdd-guardian/evidence.json")) ? JSON.parse(read(".claude/tdd-guardian/evidence.json")) : null);
  /** Lines the fake cargo prints on its next run, and its exit code. */
  const cargoOutput = (stdout: string, stderr: string, code: number) => { write("fake-cargo/stdout.txt", stdout); write("fake-cargo/stderr.txt", stderr); write("fake-cargo/code", String(code)); };

  mkdirSync(join(root, "tests"));
  mkdirSync(join(root, ".claude/tdd-guardian"), { recursive: true });
  mkdirSync(join(root, "scripts/tdd"), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  symlinkSync(join(repo, "scripts/tdd/unit-red-lane.mjs"), join(root, "scripts/tdd/unit-red-lane.mjs"));
  symlinkSync(join(repo, "scripts/cargo-test-lane.mjs"), join(root, "scripts/cargo-test-lane.mjs"));
  copyFileSync(join(repo, "tests/tooling/fixtures/adr0149e/fake-cargo.mjs"), join(root, "scripts/fake-cargo.mjs"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", scripts: {} }));
  writeFileSync(join(root, "vitest.config.mjs"), 'export default { test: { include: ["tests/**/*.test.ts"], maxWorkers: 1 } };\n');
  writeFileSync(join(root, ".gitignore"), "ignored/\ntests/**/ignored-*\n.claude/tdd-guardian/.*\n");
  const config = JSON.parse(readFileSync(join(repo, ".claude/tdd-guardian/config.json"), "utf8"));
  const named = new Set(["unit", "unit-red", "rust", "rust-verify-run"]);
  config.lanes = config.lanes.filter((lane: { name: string }) => !named.has(lane.name));
  config.lanes.push(
    { name: "unit", command: "pnpm exec vitest run", gateOn: ["manual"], coverage: "none", timeoutMs: 60000 },
    { name: "unit-red", command: "node scripts/tdd/unit-red-lane.mjs", gateOn: ["manual"], coverage: "none", timeoutMs: 60000 },
    { name: "rust", command: "node scripts/cargo-test-lane.mjs node scripts/fake-cargo.mjs", gateOn: ["manual"], coverage: "none", timeoutMs: 60000 },
  );
  writeFileSync(join(root, ".claude/tdd-guardian/config.json"), JSON.stringify(config));
  writeFileSync(join(root, ".claude/tdd-guardian/receipts.json"), JSON.stringify({ schemaVersion: 2, receipts: [] }));
  cargoOutput("", "", 0);
  await git("init", "-q", "-b", "master");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await commit("fixture");
  await git("switch", "-qc", "feature");

  const close = async () => { await owner.close(); rmSync(root, { recursive: true, force: true }); };
  return { root, run, write, read, git, entry, commit, store, evidence, cargoOutput, close };
}
