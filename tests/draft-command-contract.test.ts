// @vitest-environment node
/**
 * D27 — source-text contracts for draft recovery.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260926-170000.md` cases c9 and c11.
 * - c9: every draft command `src/services/draftService.ts` invokes is registered in
 *   `generate_handler![…]` (`src-tauri/src/commands/mod.rs`), the pre-existing draft commands
 *   are still there, and nothing is registered twice.
 * - c11: `src/App.tsx` routes recover/discard through the draft service and never invokes the
 *   raw `delete_draft` / `recover_draft` commands.
 * No mocks: regex over the real source text (precedent: `tests/focus-trap.test.ts`).
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");

function registeredCommands(): string[] {
  const src = read("src-tauri/src/commands/mod.rs");
  const m = src.match(/generate_handler!\s*\[([\s\S]*?)\]/);
  expect(m, "generate_handler![…] not found in commands/mod.rs").not.toBeNull();
  return [...(m?.[1] ?? "").matchAll(/::(\w+)/g)].map((x) => x[1]);
}

function invokedCommands(rel: string): string[] {
  const src = read(rel);
  return [...src.matchAll(/invoke\s*(?:<[^>]*>)?\s*\(\s*["'`](\w+)["'`]/g)].map((x) => x[1]);
}

describe("c9: every draft command the frontend invokes is registered", () => {
  it("draftService invokes recover_draft and discard_recovery_draft, both registered", () => {
    const registered = new Set(registeredCommands());
    const invoked = new Set(invokedCommands("src/services/draftService.ts"));
    expect(invoked).toContain("recover_draft");
    expect(invoked).toContain("discard_recovery_draft");
    for (const name of invoked) {
      expect(registered, `${name} is invoked but not registered`).toContain(name);
    }
  });

  it("the pre-existing draft commands are still registered", () => {
    const registered = new Set(registeredCommands());
    for (const name of ["delete_draft", "get_draft", "list_drafts", "cleanup_old_drafts"]) {
      expect(registered).toContain(name);
    }
  });

  it("no command is registered twice", () => {
    const names = registeredCommands();
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });
});

describe("c11: App.tsx routes recover and discard through the draft service", () => {
  const app = read("src/App.tsx");
  const rawInvoke = (cmd: string) =>
    new RegExp(`invoke\\s*(<[^>]*>)?\\s*\\(\\s*["'\`]${cmd}["'\`]`);

  it("never invokes delete_draft directly", () => {
    expect(app).not.toMatch(rawInvoke("delete_draft"));
  });

  it("never invokes recover_draft directly", () => {
    expect(app).not.toMatch(rawInvoke("recover_draft"));
  });

  it("imports recoverDraft and discardRecoveryDraft from services/draftService, exactly once", () => {
    const imports = [
      ...app.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*services\/draftService["']/g),
    ];
    expect(imports).toHaveLength(1);
    const names = imports[0][1].split(",").map((s) => s.trim());
    expect(names).toContain("recoverDraft");
    expect(names).toContain("discardRecoveryDraft");
  });

  it("calls both service functions outside the import statement", () => {
    const withoutImport = app.replace(
      /import\s*\{[^}]*\}\s*from\s*["'][^"']*services\/draftService["'];?/g,
      "",
    );
    expect(withoutImport).toMatch(/\brecoverDraft\(/);
    expect(withoutImport).toMatch(/\bdiscardRecoveryDraft\(/);
  });
});
