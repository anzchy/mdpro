/**
 * Purpose: turn any value a failed Tauri `invoke` (or the code around it) threw into
 * readable text for a user-facing message, so a toast never reads `[object Object]` (D163).
 *
 * Key decisions:
 * - A `Result<_, FileError>` command rejects with serde's default external tagging of
 *   `FileError` (src-tauri/src/commands/file.rs, no `#[serde]` attribute): a struct
 *   variant is `{ Variant: { ...fields } }`, the unit variant `DiskFull` is the string
 *   `"DiskFull"`. Those are formatted exactly as Rust's `file_error_message` formats
 *   them, so the toast and the `file.save` fail log name the same failure.
 * - An `Error` gives its `message`, any other string is returned as-is (a
 *   `Result<_, String>` command), and a plain object gives its string `message`.
 * - Any other single-key object (another command's error enum) gives its variant name,
 *   plus a string `message` / `path` field when it has one. Anything else falls back to
 *   `UNKNOWN_ERROR_TEXT`; nothing here ever stringifies an object.
 * - Pure and log-free: the caller decides where the text goes.
 *
 * @coordinates-with src-tauri/src/commands/file.rs — FileError, file_error_message
 * @coordinates-with src/services/saveService.ts — performSave's "Save failed:" toast
 * @module utils/ipcErrorMessage
 */

/** Text for a rejection whose shape carries nothing readable. */
export const UNKNOWN_ERROR_TEXT = "unknown error";

type Fields = Record<string, unknown>;

const str = (fields: Fields, key: string): string => {
  const value = fields[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

/** `file_error_message` (file.rs) for each struct variant of `FileError`. */
const FILE_ERROR_FORMATS: Readonly<Record<string, (f: Fields) => string>> = {
  FileNotFound: (f) => `file not found: ${str(f, "path")}`,
  PermissionDenied: (f) => `permission denied: ${str(f, "path")}`,
  EncodingError: (f) => `encoding error: ${str(f, "path")} detected=${str(f, "detected")}`,
  FileTooLarge: (f) => `file too large: ${str(f, "path")} size=${str(f, "size")}`,
  InvalidPath: (f) => `invalid path: ${str(f, "path")}`,
  IoError: (f) => str(f, "message"),
};

/** `file_error_message` (file.rs) for the unit variants of `FileError`. */
const FILE_ERROR_UNIT_TEXT: Readonly<Record<string, string>> = { DiskFull: "disk full" };

const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One externally tagged enum value `{ Variant: payload }` as text. */
function variantText(variant: string, payload: unknown): string {
  const format = FILE_ERROR_FORMATS[variant];
  if (format && isFields(payload)) {
    const text = format(payload);
    if (text) return text;
  }
  const detail = isFields(payload) ? str(payload, "message") || str(payload, "path") : "";
  return detail ? `${variant}: ${detail}` : variant;
}

/**
 * Readable text for a caught error: `Error` → message, string → itself (`"DiskFull"`
 * → "disk full"), serialized `FileError` → Rust's wording, `{ message }` → message,
 * other `{ Variant: … }` → variant name (+ message/path), else `UNKNOWN_ERROR_TEXT`.
 */
export function ipcErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || UNKNOWN_ERROR_TEXT;
  if (typeof error === "string") return FILE_ERROR_UNIT_TEXT[error] ?? (error || UNKNOWN_ERROR_TEXT);
  if (!isFields(error)) return UNKNOWN_ERROR_TEXT;
  const message = str(error, "message");
  if (message) return message;
  const keys = Object.keys(error);
  if (keys.length === 1) return variantText(keys[0], error[keys[0]]);
  return UNKNOWN_ERROR_TEXT;
}
