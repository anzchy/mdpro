// @vitest-environment node
/**
 * ADR0149E-2 (AC-2, ADR-0149 d1): `record` pins the working-tree bytes of every test path
 * (all of `tests/`, `src-tauri/tests/`, and every Rust file a `#[cfg(test)] mod` reaches or
 * holds) as one tree under `refs/receipts/<id>/<compact recorded-at>/tests`, without
 * touching the index or the working tree.
 */
import { chmodSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { pinRef } from "../../scripts/tdd/receipt-tree.mjs";

vi.setConfig({ testTimeout: 180_000 });
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

const failing = 'import { expect, it } from "vitest";\nit("fails", () => {\n  expect(1).toBe(2);\n});\n';
const REF = /^refs\/receipts\/A\/(\d{8}T\d{9}Z)\/tests tree ([0-9a-f]{40})$/;

async function layout() {
  repo.write("tests/a.test.ts", failing);
  repo.write("tests/support/s.ts", "export const s = 1;\n");
  repo.write("tests/gone.test.ts", "export {};\n");
  repo.write("tests/run.sh", "#!/bin/sh\n");
  chmodSync(join(repo.root, "tests/run.sh"), 0o755);
  symlinkSync("a.test.ts", join(repo.root, "tests/link"));
  repo.write("src-tauri/src/lib.rs", "pub mod x;\npub mod seam;\npub mod prod;\n#[cfg(test)]\nmod tests;\n");
  repo.write("src-tauri/src/tests.rs", "mod helpers;\n#[test]\nfn t() {}\n");
  repo.write("src-tauri/src/tests/helpers.rs", "pub fn h() {}\n");
  repo.write("src-tauri/src/x/mod.rs", 'pub fn x() {}\n#[path = "x_check.rs"]\n#[cfg(test)]\nmod x_check;\n#[cfg(test)]\n#[path = "x_more.rs"]\nmod x_more;\n');
  repo.write("src-tauri/src/x/x_check.rs", "#[test]\nfn c() {}\n");
  repo.write("src-tauri/src/x/x_more.rs", "#[test]\nfn m() {}\n");
  repo.write("src-tauri/src/seam.rs", "pub fn real() {}\n#[cfg(test)]\npub fn seam() {}\n");
  repo.write("src-tauri/src/prod.rs", "pub fn p() {}\n");
  repo.write("src-tauri/tests/it.rs", "#[test]\nfn it() {}\n");
  repo.write("src/app.ts", "export const app = 1;\n");
  await repo.commit("layout");
  repo.write("tests/support/s.ts", "export const s = 2; // dirty\n");
  repo.write("tests/new.test.ts", "export {};\n");
  repo.write("tests/support/ignored-cache.txt", "ignored\n");
  await repo.run("rm", ["tests/gone.test.ts"]);
}

describe.skipIf(!pluginVersion)("ADR0149E-2 pinned test tree", () => {
  it("pins exactly the test paths, with dirty and untracked bytes and their modes, and leaves index and tree alone", async () => {
    await layout();
    const before = await repo.snapshot();
    const config = repo.read(".git/config");
    const recorded = await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts");
    expect(recorded.status, recorded.output).toBe(0);
    const after = await repo.snapshot();
    expect(after.index).toBe(before.index);
    expect(after.status.split("\n").filter((line) => !line.includes(".claude/tdd-guardian/"))).toEqual(before.status.split("\n").filter((line) => !line.includes(".claude/tdd-guardian/")));
    expect(repo.read(".git/config")).toBe(config);

    const refs = await repo.refs();
    expect(refs).toHaveLength(1);
    const [, stamp, tree] = REF.exec(refs[0]) ?? [];
    expect(tree).toBeTruthy();
    expect(stamp).toBe(repo.store()[0].recorded_at.replace(/[-:.]/g, ""));
    const listing = (await repo.git("ls-tree", "-r", tree)).stdout.trim().split("\n").map((line) => { const [meta, path] = line.split("\t"); const [mode, , blob] = meta.split(" "); return { path, mode, blob }; });
    expect(listing.map((row) => row.path).sort()).toEqual([
      "src-tauri/src/lib.rs", "src-tauri/src/tests.rs", "src-tauri/src/tests/helpers.rs", "src-tauri/src/x/mod.rs",
      "src-tauri/src/x/x_check.rs", "src-tauri/src/x/x_more.rs", "src-tauri/tests/it.rs",
      "tests/a.test.ts", "tests/link", "tests/new.test.ts", "tests/run.sh", "tests/support/s.ts",
    ]);
    const row = (path: string) => listing.find((item) => item.path === path)!;
    expect((await repo.git("cat-file", "-p", row("tests/support/s.ts").blob)).stdout).toBe("export const s = 2; // dirty\n");
    expect(row("tests/run.sh").mode).toBe("100755");
    expect(row("tests/link").mode).toBe("120000");
    expect((await repo.git("cat-file", "-p", row("tests/link").blob)).stdout).toBe("a.test.ts");
    const entry = repo.evidence().entries.A;
    expect(entry.tests_tree).toEqual({ ref: refs[0].split(" ")[0], tree });
    expect(entry.spec_blobs).toEqual({ "tests/a.test.ts": row("tests/a.test.ts").blob });
  });

  it("refuses ids that cannot name a ref before the lane runs", async () => {
    repo.write("tests/a.test.ts", failing);
    for (const id of ["a..b", "x.lock"]) {
      const result = await repo.entry("record", "--id", id, "--test", "tests/a.test.ts");
      expect(result.status, id).toBe(64);
    }
    expect(repo.store()).toEqual([]);
    expect(await repo.refs()).toEqual([]);
  });

  it("refuses and pins nothing when a support file changes while the lane runs", async () => {
    repo.write("tests/support/s.ts", "export const s = 1;\n");
    repo.write("tests/a.test.ts", 'import { expect, it } from "vitest";\nimport { writeFileSync } from "node:fs";\nit("edits support", () => {\n  writeFileSync("tests/support/s.ts", "export const s = 9;\\n");\n  expect(1).toBe(2);\n});\n');
    await repo.commit("mutating spec");
    const result = await repo.entry("record", "--id", "A", "--test", "tests/a.test.ts");
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/changed while the lane ran/i);
    expect(await repo.refs()).toEqual([]);
    expect(repo.evidence()?.entries?.A).toBeUndefined();
    const pending = await repo.entry("check-pending");
    expect(pending.status).toBe(1);
    expect(pending.output).toMatch(/A/);
  });

  it("creates a pin ref only when no ref of that name exists", async () => {
    const tree = (await repo.git("write-tree")).stdout.trim();
    pinRef(repo.root, "refs/receipts/Z/20261029T000000000Z/tests", tree);
    expect(() => pinRef(repo.root, "refs/receipts/Z/20261029T000000000Z/tests", tree)).toThrow(/exists/i);
    expect(await repo.refs()).toEqual([`refs/receipts/Z/20261029T000000000Z/tests tree ${tree}`]);
  });
});
