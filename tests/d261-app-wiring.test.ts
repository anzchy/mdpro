// @vitest-environment node
/**
 * D261-WI-1d: source-text pins for what cannot be mounted. `App` is too heavy
 * to render in jsdom (see `d253-last-tab-window-close.test.tsx`), so the
 * behaviour lives in the helper tests (`d261-close-confirm-stale`,
 * `d261-save-as-switch`, `d261-table-insert-stale`, `d261-highlight-stale`) and
 * these pins tie App to those helpers:
 *   - the close-confirm document branch passes the token `handleCloseRequest`
 *     stored when it prompted, never a fresh one, and the quit and
 *     window-close branches carry no token check;
 *   - the menu `onSave` goes through `saveIfCurrent` with its receipt token;
 *   - both `onHighlight` handlers build `{ seq, token }`;
 *   - both Insert Table paths call `triggerTableInsert`, the keyboard one with
 *     no token so one is minted at open;
 *   - the helpers never capture a token of their own;
 *   - the size limits of the work item.
 * Comments are stripped first, so a pin is never satisfied by prose. Every
 * extraction asserts it matched, so a missing anchor fails loudly.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../src");
const raw = (rel: string) => readFileSync(path.join(SRC, rel), "utf-8");
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\w])\/\/[^\n]*/g, "$1");

const APP_RAW = raw("App.tsx");
const app = stripComments(APP_RAW);
const token = stripComments(raw("utils/menuTargetToken.ts"));
const APP_BASE_LINES = 977;

function mustMatch(re: RegExp, text: string, what: string): RegExpMatchArray {
  const m = text.match(re);
  expect(m, `no match for ${what} (${re})`).not.toBeNull();
  return m!;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `const name = async () => { … };` or `const name = () => { … };` at App's indent. */
const arrowBody = (name: string) =>
  mustMatch(new RegExp(`const ${name} = (?:async )?\\(\\) => \\{([\\s\\S]*?)\\n  \\};`), app, name)[1];

/** `const name = useCallback(…, [deps])` at App's indent. */
const callbackBody = (name: string) =>
  mustMatch(new RegExp(`const ${name} = useCallback\\(([\\s\\S]*?)\\n  \\}?,?\\s*\\[`), app, name)[1];

/** The argument object of `hook({ … });` in App. */
const hookBlock = (hook: string) => mustMatch(new RegExp(`${hook}\\(\\{([\\s\\S]*?)\\n  \\}\\);`), app, hook)[1];

/** One property of a hook block, up to the next sibling property. */
const property = (block: string, key: string) =>
  mustMatch(new RegExp(`\\n    ${key}:([\\s\\S]*?)(?=\\n    \\w+[:,]|$)`), block, `${key}:`)[1];

/** The text of a balanced `(...)` call starting at `open` (index of the `(`). */
function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open, i + 1);
  }
  throw new Error("unbalanced call");
}

/** The body of `export (async )?function name(...) { ... }` in menuTargetToken.ts. */
const helperBody = (name: string) =>
  mustMatch(new RegExp(`export (?:async )?function ${name}\\b[\\s\\S]*?\\{([\\s\\S]*?)\\n\\}`), token, name)[1];

/** Extracted inside each test, so a missing anchor is an assertion failure, not a collection error. */
function closeParts() {
  const request = callbackBody("handleCloseRequest");
  const R = mustMatch(/(\w+)\.current = token \?\? captureToken\(/, request, "R.current = token ?? captureToken(")[1];
  const confirm = arrowBody("handleConfirmClose");
  const quitBlock = mustMatch(/if \(confirmDialog\.target === "quit"\) \{([\s\S]*?)\n    \}/, confirm, "quit block")[1];
  const afterQuit = confirm.slice(confirm.indexOf(quitBlock) + quitBlock.length);
  const windowBlock = mustMatch(
    /if \(windowCloseGuard\.pendingClose === "window"\) \{([\s\S]*?)\n    \}/,
    afterQuit,
    "window-close block",
  )[1];
  const documentBlock = mustMatch(/if \(target === "document"\) \{([\s\S]*?)\n    \}/, afterQuit, "document block")[1];
  return { request, R, confirm, quitBlock, afterQuit, windowBlock, documentBlock };
}

describe("close-confirm: App passes the stored token to confirmDocumentClose (A2)", () => {
  it("stores the token in the prompt branch of handleCloseRequest, next to closeTargetRef", () => {
    const { request, R } = closeParts();
    const prompt = mustMatch(/if \(decision === "prompt"\) \{([\s\S]*?)\}/, request, "prompt branch")[1];
    expect(prompt).toMatch(/closeTargetRef\.current = "document"/);
    expect(prompt).toMatch(new RegExp(`${escape(R)}\\.current = token \\?\\? captureToken\\(`));
    expect(request).toMatch(/\(\s*_?actionId\??: string,\s*token\??: MenuTargetToken\s*\)/);
  });

  it("reads the stored token into a local before clearing it, and confirms with that local", () => {
    const { R, afterQuit, documentBlock } = closeParts();
    const local = mustMatch(new RegExp(`const (\\w+) = ${escape(R)}\\.current;`), afterQuit, "const local = R.current")[1];
    const readAt = afterQuit.indexOf(`const ${local} = ${R}.current;`);
    const clearAt = afterQuit.indexOf(`${R}.current = null`);
    expect(clearAt).toBeGreaterThan(-1);
    expect(readAt).toBeLessThan(clearAt);
    expect(documentBlock).toMatch(new RegExp(`confirmDocumentClose\\(\\s*${escape(local)}\\s*,\\s*closeActiveDocument\\s*\\)`));
    expect(documentBlock).not.toMatch(/captureToken\(/);
  });

  it("the document branch closes only through confirmDocumentClose", () => {
    const { confirm } = closeParts();
    const withoutHelper = confirm.replace(/confirmDocumentClose\([^)]*\)/g, "");
    expect(withoutHelper).not.toMatch(/closeActiveDocument\(/);
  });

  it("the quit and window-close branches carry no token check", () => {
    const { quitBlock, windowBlock } = closeParts();
    for (const block of [quitBlock, windowBlock]) {
      expect(block).not.toMatch(/abandonIfStale|confirmDocumentClose/);
    }
  });

  it("cancel and the quit takeover clear the stored token", () => {
    const { R, quitBlock } = closeParts();
    expect(quitBlock).toMatch(new RegExp(`${escape(R)}\\.current = null`));
    expect(arrowBody("handleCancelClose")).toMatch(new RegExp(`${escape(R)}\\.current = null`));
  });
});

describe("save: the menu onSave goes through saveIfCurrent with its receipt token (A3)", () => {
  it("is (actionId, token) => saveIfCurrent(token, …) and saves only inside its callback", () => {
    const onSave = property(hookBlock("useMenuEvents"), "onSave");
    const [, a, t] = mustMatch(/^\s*\((\w+),\s*(\w+)\)\s*=>/, onSave, "(actionId, token) =>");
    const callAt = onSave.indexOf("saveIfCurrent(");
    expect(callAt).toBeGreaterThan(-1);
    const call = balanced(onSave, callAt + "saveIfCurrent".length);
    expect(call).toMatch(new RegExp(`^\\(\\s*${escape(t)}\\s*,\\s*${escape(a)}\\s*,`));
    const outside = onSave.replace(call, "");
    expect(outside).not.toMatch(/handleSave\(|performSave\(|saveActiveDocument\(/);
    expect(call).toMatch(/handleSave\(|performSave\(/);
  });
});

describe("highlight: both onHighlight handlers build { seq, token }", () => {
  it.each(["useKeyboardShortcuts", "useMenuEvents"])("%s", (hook) => {
    const onHighlight = property(hookBlock(hook), "onHighlight");
    expect(onHighlight).toMatch(/setHighlightRequest\(/);
    expect(onHighlight).toMatch(/\{\s*seq:[^}]*,\s*token\s*\}/);
  });

  it("the menu handler uses its receipt token; the keyboard one captures", () => {
    const menu = property(hookBlock("useMenuEvents"), "onHighlight");
    const [, t] = mustMatch(/^\s*\(\w+,\s*(\w+)\)\s*=>/, menu, "(actionId, token) =>");
    expect(menu).toMatch(new RegExp(`\\b${escape(t)}\\b[\\s\\S]*setHighlightRequest`));
    expect(property(hookBlock("useKeyboardShortcuts"), "onHighlight")).toMatch(/captureToken\(currentWindowLabel\(\)\)/);
  });

  it("the request is captured before setHighlightRequest, not inside its updater", () => {
    for (const hook of ["useKeyboardShortcuts", "useMenuEvents"]) {
      const handler = property(hookBlock(hook), "onHighlight");
      const updater = mustMatch(/setHighlightRequest\(([\s\S]*)\)/, handler, "setHighlightRequest(…)")[1];
      expect(updater).not.toMatch(/captureToken\(/);
    }
  });
});

describe("table: both Insert Table paths call triggerTableInsert", () => {
  it("App no longer defines it; it is imported from utils/tableInsertTrigger", () => {
    expect(app).not.toMatch(/const triggerTableInsert\b/);
    expect(app).toMatch(/import \{ triggerTableInsert \} from "\.\/utils\/tableInsertTrigger";/);
  });

  it("the menu passes its receipt token; the keyboard passes none, so one is minted at open", () => {
    const menu = property(hookBlock("useMenuEvents"), "onInsertTable");
    const [, t] = mustMatch(/^\s*\(\w+,\s*(\w+)\)\s*=>/, menu, "(actionId, token) =>");
    expect(menu).toMatch(new RegExp(`triggerTableInsert\\(\\s*${escape(t)}\\s*\\)`));
    expect(property(hookBlock("useKeyboardShortcuts"), "onInsertTable")).toMatch(/^\s*\(\)\s*=>\s*triggerTableInsert\(\)/);
  });

  it("tableInsertTrigger.ts has a Purpose header and checks the token before getEditor()", () => {
    const fileRaw = raw("utils/tableInsertTrigger.ts");
    expect(fileRaw).toMatch(/Purpose:/);
    const file = stripComments(fileRaw);
    expect(file).toMatch(/export function triggerTableInsert\(\s*token[^=]*= captureToken\(currentWindowLabel\(\)\)\s*\)/);
    const stale = file.search(/abandonIfStale\(\s*token\s*,\s*"table_submit"/);
    expect(stale).toBeGreaterThan(-1);
    expect(stale).toBeLessThan(file.indexOf("getEditor()"));
  });
});

describe("the helpers never capture a token of their own", () => {
  it("confirmDocumentClose checks the given token with close_confirm before closing", () => {
    const body = helperBody("confirmDocumentClose");
    expect(body).not.toMatch(/captureToken\(/);
    const check = body.search(/abandonIfStale\(\s*storedToken\s*,\s*"close_confirm"/);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.search(/closeActiveDocument\(/));
  });

  it("saveIfCurrent checks the given token with save_entry before run()", () => {
    const body = helperBody("saveIfCurrent");
    expect(body).not.toMatch(/captureToken\(/);
    const check = body.search(/abandonIfStale\(\s*token\s*,\s*"save_entry"/);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.search(/\brun\(\)/));
  });
});

describe("the Source editor checks the token before it touches the view", () => {
  it("abandonIfStale( comes before highlightCommand( in Editor.tsx's effect", () => {
    const editor = stripComments(raw("components/Editor/Editor.tsx"));
    const effect = mustMatch(/useEffect\(\(\) => \{([\s\S]*?)\}, \[highlightRequest\]\);/, editor, "highlight effect")[1];
    const check = effect.search(/abandonIfStale\(/);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(effect.search(/highlightCommand\(/));
    expect(editor).toMatch(/highlightRequest\?:\s*HighlightRequest/);
  });
});

describe("size limits of the work item", () => {
  const lines = (rel: string) => raw(rel).split("\n").length - (raw(rel).endsWith("\n") ? 1 : 0);

  it(`App.tsx has fewer than ${APP_BASE_LINES} lines`, () => {
    expect(lines("App.tsx")).toBeLessThan(APP_BASE_LINES);
  });

  it.each(["components/Editor/MilkdownEditor.tsx", "components/Editor/Editor.tsx"])("%s stays under 300 lines", (rel) => {
    expect(lines(rel)).toBeLessThan(300);
  });
});
