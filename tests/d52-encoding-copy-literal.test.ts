// @vitest-environment node
/**
 * D52 — the encoding dialog's user-approved copy (2026-10-10), pinned verbatim.
 *
 * `ENCODING_DIALOG_COPY` holds every string the dialog and its refused retry show.
 * Other tests compare rendered text against the constant, so a reworded constant
 * would pass them all; this file is the only check that the copy is still the text
 * the user approved. Strings are written out literally here on purpose: changing the
 * copy must change this file, in the same commit, with the user's approval.
 */
import { describe, expect, it } from "vitest";
import { ENCODING_DIALOG_COPY } from "../src/components/common/encodingDialogCopy";

describe("D52 — encoding dialog copy is the approved text", () => {
  it.each([
    ["ariaLabel", "Select encoding"],
    ["title", "Can't open this file as UTF-8"],
    [
      "body",
      "This file isn't valid UTF-8. Files in legacy encodings such as GBK, Big5 or Shift-JIS can't be opened yet.",
    ],
    [
      "retryHint",
      "If it was saved as UTF-16 without a byte-order mark, you can retry as UTF-16. mdpro checks the result and won't open the file if it doesn't look like UTF-16.",
    ],
    ["refusedToast", "Not opened: this file doesn't look like UTF-16, and mdpro can't read its encoding yet"],
    ["utf16le", "UTF-16LE"],
    ["utf16be", "UTF-16BE"],
    ["cancel", "Cancel"],
  ] as const)("%s", (key, text) => {
    expect(ENCODING_DIALOG_COPY[key]).toBe(text);
  });

  it("has no string beyond the pinned ones", () => {
    expect(Object.keys(ENCODING_DIALOG_COPY).sort()).toEqual(
      ["ariaLabel", "body", "cancel", "refusedToast", "retryHint", "title", "utf16be", "utf16le"],
    );
  });
});
