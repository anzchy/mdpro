/**
 * Purpose: every user-facing string of the encoding dialog and its retry, in one
 * object so the copy can change in one place (D52, ADR-0057), plus the choice of
 * toast when a retry fails.
 *
 * Key decisions:
 * - **Only UTF-16 is offered** (ADR-0057 decisions 2 and 3). The dialog opens only
 *   when detection returned "unknown", which already rules out UTF-8 and ASCII; a
 *   UTF-16 retry is checked in Rust (`encoding::hinted_decode_refusal`) and refused
 *   when implausible.
 * - **A refused retry is an `EncodingError`**, the same IPC shape as the first
 *   failed open. During a retry no other cause produces one, so
 *   `encodingRetryRefusalToast` maps it to `refusedToast`; anything else (I/O,
 *   permission, a vanished file) returns null and the caller keeps its generic
 *   toast.
 * - The copy is user-approved (2026-10-10). It names no detected encoding: detection
 *   only ever reports "unknown" here, which tells the user nothing.
 *
 * @coordinates-with src/components/common/EncodingDialog.tsx — renders the dialog copy
 * @coordinates-with src/App.tsx — `handleEncodingSelect` shows the refusal toast
 * @coordinates-with src/utils/openFailure.ts — `parseEncodingError`
 * @coordinates-with src-tauri/src/services/encoding.rs — `hinted_decode_refusal`
 */
import { parseEncodingError } from "../../utils/openFailure";

export const ENCODING_DIALOG_COPY = {
  /** Accessible name of the dialog. */
  ariaLabel: "Select encoding",
  title: "Can't open this file as UTF-8",
  body: "This file isn't valid UTF-8. Files in legacy encodings such as GBK, Big5 or Shift-JIS can't be opened yet.",
  retryHint:
    "If it was saved as UTF-16 without a byte-order mark, you can retry as UTF-16. mdpro checks the result and won't open the file if it doesn't look like UTF-16.",
  utf16le: "UTF-16LE",
  utf16be: "UTF-16BE",
  cancel: "Cancel",
  refusedToast:
    "Not opened: this file doesn't look like UTF-16, and mdpro can't read its encoding yet",
} as const;

/** The encodings the dialog offers, in button order, with their labels. */
export const ENCODING_DIALOG_OPTIONS = [
  { encoding: "UTF-16LE", label: ENCODING_DIALOG_COPY.utf16le },
  { encoding: "UTF-16BE", label: ENCODING_DIALOG_COPY.utf16be },
] as const;

/** The refusal toast when a retry failed as an encoding refusal, otherwise null. */
export function encodingRetryRefusalToast(error: unknown): string | null {
  return parseEncodingError(error) ? ENCODING_DIALOG_COPY.refusedToast : null;
}
