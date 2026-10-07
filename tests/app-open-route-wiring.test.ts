// @vitest-environment node
/**
 * D29 WI-6 — App wires the three routing hooks together (source contract).
 *
 * Matrix: `.claude/tdd-guardian/tests-20260924-131525.md` § WI-6, "App wiring".
 *
 * Checked as source text because rendering `App` in jsdom is too heavy for what
 * is pinned here (see `large-document-guard-call-site.test.ts` for the standing
 * reasons). The behaviour of each hook is tested in its own suite; this pins:
 *   (a) `useMcpSync` receives `routable` from `useOpenInWindow`, never a literal;
 *   (b) `useWindowCloseGuard` receives an `onCloseCancelled` that resolves to
 *       `forceSync`, never `syncNow` (which the dedupe hash would swallow).
 * App calls the close guard before `useMcpSync`, so (b) may be ref-backed.
 * Every regex must match, so a missing match fails loudly rather than passing
 * vacuously. Paired integration: G-D29-2 and G-D29-3 in WI-8.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Anchored on the test path: under Vite's transform `import.meta.url` is not a
// file:// URL (see large-document-guard-call-site.test.ts).
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

describe("App feeds useOpenInWindow's routable to useMcpSync and forceSync to the close guard", () => {
  it("(a) useMcpSync's routable comes from useOpenInWindow", () => {
    expect(app).not.toMatch(/useMcpSync\(\s*\)/);
    const args = mustMatch(/useMcpSync\(\s*\{([^}]*)\}\s*\)/, app, "useMcpSync({ … })")[1];
    const entry = mustMatch(/\broutable\b(?:\s*:\s*([\w.]+))?/, args, "routable in useMcpSync's argument");
    const value = entry[1] ?? "routable";
    expect(["true", "false"]).not.toContain(value);

    const member = value.match(/^(\w+)\.routable$/);
    if (member) {
      mustMatch(new RegExp(`const ${escape(member[1])} = useOpenInWindow\\(`), app, "const X = useOpenInWindow(");
    } else {
      expect(value).toMatch(/^\w+$/);
      const destructure = mustMatch(
        /const \{([^}]*)\} = useOpenInWindow\(/,
        app,
        "const { … } = useOpenInWindow(",
      )[1];
      const bound = destructure.match(/\broutable\b(?:\s*:\s*(\w+))?/);
      expect(bound).not.toBeNull();
      expect(bound![1] ?? "routable").toBe(value);
    }
  });

  it("(b) onCloseCancelled resolves to forceSync, never syncNow", () => {
    const value = mustMatch(
      /useWindowCloseGuard\(\s*\{[^;]*?onCloseCancelled\s*:\s*([^,}\n]+)/,
      app,
      "useWindowCloseGuard({ onCloseCancelled: … })",
    )[1].trim();
    expect(value).not.toMatch(/syncNow/);

    if (/^[\w.]+\.forceSync$/.test(value)) return;

    // Ref-backed: `() => <ref>.current()`, with `<ref>.current = <x>.forceSync`.
    const ref = mustMatch(
      /^\(\)\s*=>\s*(?:void\s+)?(\w+)\.current\??\.?\(\)$/,
      value,
      "a ref-backed onCloseCancelled lambda",
    )[1];
    const assigned = [...app.matchAll(new RegExp(`${escape(ref)}\\.current\\s*=\\s*([\\w.]+)`, "g"))].map((m) => m[1]);
    expect(assigned.length).toBeGreaterThan(0);
    for (const target of assigned) {
      expect(target).toMatch(/\.forceSync$/);
    }
  });
});
