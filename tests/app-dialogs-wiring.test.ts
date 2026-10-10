// @vitest-environment node
/**
 * D42 WI-3 — App → AppDialogs wiring, matrix case 3.5 (c)(d)
 * (`.claude/tdd-guardian/tests-20261008-131500.md`).
 *
 * Source-text inspection: a weak supplement. `App` cannot be rendered in jsdom (see the
 * `large-document-guard-call-site.test.ts` header), and tsc cannot catch a swap between two
 * handlers of type `() => void`, so this pins that each AppDialogs handler prop is bound to
 * the same App expression it was bound to before the move. The behavioural half is
 * `app-dialogs.test.tsx`; the real App wiring is device checks G-D42-1/2.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const app = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");

/** The `<AppDialogs … />` JSX span, from its opening `<` to its self-closing `/>`. */
function appDialogsSpan(): string {
  const start = app.indexOf("<AppDialogs");
  expect(start).toBeGreaterThan(-1);
  const end = app.indexOf("/>", start);
  expect(end).toBeGreaterThan(start);
  return app.slice(start, end + 2);
}

describe("3.5 App renders AppDialogs once, wired to App's own handlers", () => {
  it("(c) renders <AppDialogs once, after <BottomTabs and before <Toast", () => {
    expect(app.match(/<AppDialogs\b/g) ?? []).toHaveLength(1);
    const at = app.indexOf("<AppDialogs");
    expect(at).toBeGreaterThan(app.indexOf("<BottomTabs"));
    expect(app.indexOf("<BottomTabs")).toBeGreaterThan(-1);
    expect(at).toBeLessThan(app.indexOf("<Toast"));
  });

  it.each([
    ["drafts", "drafts"],
    ["onRecoverDraft", "handleRecoverDraft"],
    ["onDiscardDraft", "handleDiscardDraft"],
    ["reloadMessage", "reloadMessage"],
    ["onReload", "handleReloadFile"],
    ["onIgnoreReload", "handleIgnoreReload"],
    ["encodingIssue", "encodingIssue"],
    ["onEncodingSelect", "handleEncodingSelect"],
    ["onEncodingCancel", "clearEncodingIssue"],
    ["confirmDialog", "confirmDialog"],
    ["onConfirmClose", "handleConfirmClose"],
    ["onCancelClose", "handleCancelClose"],
    ["settingsOpen", "settingsOpen"],
  ])("(d) %s is bound to App's %s", (prop, expr) => {
    expect(appDialogsSpan()).toMatch(new RegExp(`\\b${prop}=\\{${expr}\\}`));
  });

  it("(d) Settings close still sets settingsOpen false in App", () => {
    expect(appDialogsSpan()).toMatch(/\bonSettingsClose=\{\(\) => setSettingsOpen\(false\)\}/);
  });

  it("(d) the dialog elements no longer render directly in App", () => {
    for (const tag of ["RecoveryDialog", "ReloadDialog", "EncodingDialog", "ConfirmDialog", "SettingsDialog", "McpWriteConfirm"]) {
      expect(app).not.toMatch(new RegExp(`<${tag}\\b`));
    }
  });
});
