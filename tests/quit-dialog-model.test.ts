/**
 * D16 WI-7 / WI7-M1 — the ConfirmDialog model App.tsx renders from.
 *
 * The extraction exists so App.tsx gains wiring only: the priority between an
 * open ⌘W / window-close dialog and an arriving quit prompt is a decision, and
 * decisions do not live in a 1100-line component.
 *
 * Law: whenever `quitPrompt !== null` the target is `"quit"`, whatever
 * `pendingClose` is. The dialog is open iff either value is non-null.
 *
 * The matrix names the close targets `tab` / `window`; App.tsx's own union
 * spells the first one `"document"`, and that spelling is used here.
 */
import { describe, expect, it } from "vitest";
import {
  CLOSE_DIALOG_MESSAGE,
  QUIT_DIALOG_MESSAGE,
  quitDialogModel,
  type QuitDialogPendingClose,
} from "../src/utils/quitDialogModel";

const PENDING_CLOSES: QuitDialogPendingClose[] = [null, "document", "window"];
const QUIT_PROMPTS = [null, { requestId: 1 }] as const;

describe("quitDialogModel — exhaustive priority table (WI7-M1)", () => {
  it("covers the whole domain: 3 pendingClose values x 2 quitPrompt values", () => {
    const seen: string[] = [];

    for (const pendingClose of PENDING_CLOSES) {
      for (const quitPrompt of QUIT_PROMPTS) {
        const model = quitDialogModel({ pendingClose, quitPrompt });
        seen.push(`${String(pendingClose)}|${quitPrompt ? "prompt" : "null"}`);

        expect(model.open).toBe(pendingClose !== null || quitPrompt !== null);
        expect(model.target).toBe(quitPrompt ? "quit" : pendingClose);
        expect(model.message).toBe(
          model.target === "quit" ? QUIT_DIALOG_MESSAGE : CLOSE_DIALOG_MESSAGE,
        );
        expect(model.clearsPendingClose).toBe(model.target === "quit");
      }
    }

    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  it("a quit prompt takes over a window-close dialog that is already open", () => {
    const model = quitDialogModel({
      pendingClose: "window",
      quitPrompt: { requestId: 42 },
    });
    expect(model.open).toBe(true);
    expect(model.target).toBe("quit");
    expect(model.message).toBe(QUIT_DIALOG_MESSAGE);
    expect(model.clearsPendingClose).toBe(true);
  });

  it("a quit prompt takes over a ⌘W document dialog that is already open", () => {
    const model = quitDialogModel({
      pendingClose: "document",
      quitPrompt: { requestId: 42 },
    });
    expect(model.target).toBe("quit");
    expect(model.clearsPendingClose).toBe(true);
  });

  it("the two messages are distinct, and only the quit one mentions quitting", () => {
    expect(QUIT_DIALOG_MESSAGE).not.toBe(CLOSE_DIALOG_MESSAGE);
    expect(QUIT_DIALOG_MESSAGE).toBe("Quit without saving?");
    expect(CLOSE_DIALOG_MESSAGE).toBe("You have unsaved changes. Close without saving?");
  });

  it("nothing pending closes the dialog and names no target", () => {
    const model = quitDialogModel({ pendingClose: null, quitPrompt: null });
    expect(model.open).toBe(false);
    expect(model.target).toBeNull();
    expect(model.clearsPendingClose).toBe(false);
  });
});
