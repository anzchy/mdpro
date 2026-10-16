// @vitest-environment node
/**
 * D253-WI-3 (ADR-0112) — App wires every user tab close to
 * `closeWindowIfLastTabClosed` (source contract).
 *
 * Checked as source text because rendering `App` in jsdom is too heavy (see
 * `app-open-route-wiring.test.ts`). The behaviour of the composed paths is in
 * `d253-last-tab-window-close.test.tsx`; this pins that App composes them that way:
 *   (a) one wrapper calls `closeWindowIfLastTabClosed` with the guard's
 *       `requestWindowClose` and the quit signal from `quitGuard.quitPrompt`;
 *   (b) ⌘W / File → Close runs it after `closeActiveDocument(true)`, and in the
 *       "noop" branch (no active document);
 *   (c) the dialog's Discard for a document runs it after `closeActiveDocument(true)`;
 *   (d) the tab × is not wired to bare `closeDocumentById`, but to a callback
 *       that closes the tab and then runs it.
 * Every regex must match, so a missing match fails loudly rather than passing vacuously.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

let app = "";
beforeAll(() => {
  const testPath = expect.getState().testPath;
  expect(testPath).toBeTruthy();
  app = readFileSync(path.resolve(path.dirname(testPath!), "../src/App.tsx"), "utf-8");
});

function mustMatch(re: RegExp, text: string, what: string): RegExpMatchArray {
  const m = text.match(re);
  expect(m, `App.tsx: no match for ${what} (${re})`).not.toBeNull();
  return m!;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The body of `const <name> = useCallback(` up to its dependency array. */
function callbackBody(name: string): string {
  return mustMatch(
    new RegExp(`const ${escape(name)} = useCallback\\(([\\s\\S]*?)\\n  \\}?,?\\s*\\[`),
    app,
    `const ${name} = useCallback(…)`,
  )[1];
}

function wrapperName(): string {
  return mustMatch(
    /const (\w+) = useCallback\(\s*\(\)\s*=>\s*(?:void\s+)?closeWindowIfLastTabClosed\(/,
    app,
    "const X = useCallback(() => closeWindowIfLastTabClosed(…))",
  )[1];
}

describe("App closes an emptied secondary window after every user tab close", () => {
  it("imports the helper from utils/lastTabClose", () => {
    mustMatch(/import \{[^}]*\bcloseWindowIfLastTabClosed\b[^}]*\} from "\.\/utils\/lastTabClose";/, app, "the import");
  });

  it("(a) the wrapper passes the guard's requestWindowClose and the quit signal", () => {
    const args = mustMatch(/closeWindowIfLastTabClosed\(\{([^}]*)\}\)/, app, "closeWindowIfLastTabClosed({ … })")[1];
    expect(args).toMatch(/requestWindowClose:\s*windowCloseGuard\.requestWindowClose/);
    // Amended after the D253 audit (Codex M, Fable M): the quit signal is read
    // through a ref when the close resolves, not captured by the closure; the
    // ref must mirror quitGuard.quitPrompt on every render.
    expect(args).toMatch(/quitInProgress:\s*quitPromptRef\.current\s*!==?\s*null/);
    expect(app).toMatch(/quitPromptRef\.current\s*=\s*quitGuard\.quitPrompt;/);
  });

  it("(b) ⌘W runs it after closing the active document and when nothing is active", () => {
    const name = wrapperName();
    const body = callbackBody("handleCloseRequest");
    expect(body).toMatch(new RegExp(`closeActiveDocument\\(true\\)\\.then\\(${escape(name)}\\)`));
    const rest = body.replace(new RegExp(`\\.then\\(${escape(name)}\\)`), "");
    expect(rest).toMatch(new RegExp(`else\\s*\\{?[\\s\\S]*?\\b${escape(name)}\\(\\)`));
  });

  it("(c) the dialog's Discard for a document runs it after the close", () => {
    const name = wrapperName();
    mustMatch(
      new RegExp(`if \\(target === "document"\\) \\{\\s*await closeActiveDocument\\(true\\);\\s*(?:void\\s+)?${escape(name)}\\(\\);`),
      app,
      "Discard → closeActiveDocument(true); wrapper()",
    );
  });

  it("(d) the tab × closes the tab, then runs it", () => {
    const name = wrapperName();
    const onClose = mustMatch(/<BottomTabs[\s\S]*?onClose=\{(\w+)\}/, app, "BottomTabs onClose={…}")[1];
    expect(onClose).not.toBe("closeDocumentById");
    const body = callbackBody(onClose);
    expect(body).toMatch(new RegExp(`closeDocumentById\\([^)]*\\)\\.then\\(${escape(name)}\\)`));
  });
});
