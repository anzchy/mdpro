// @vitest-environment node
/**
 * D163: `ipcErrorMessage` turns any caught IPC rejection into readable text.
 *
 * The FileError cases mirror `file_error_message` in src-tauri/src/commands/file.rs,
 * so the toast reads the same as the `file.save` fail log Rust writes. The serialized
 * shapes are serde's default external tagging (no `#[serde]` attribute on the enum):
 * struct variants as `{ Variant: { ...fields } }`, the unit variant as `"DiskFull"`.
 */
import { describe, expect, it } from "vitest";

// Loaded per test rather than imported statically, so before the helper existed each
// test failed on its own (the D163 red) instead of the whole file failing to collect.
const ipcErrorMessage = async (error: unknown): Promise<string> => {
  const mod = await import("../src/utils/ipcErrorMessage").catch(() => null);
  if (!mod) throw new Error("src/utils/ipcErrorMessage.ts is not implemented");
  return mod.ipcErrorMessage(error);
};

const P = "/Users/x/ro/s8b.md";

describe("ipcErrorMessage — FileError variants (serialized by serde)", () => {
  it.each([
    [{ FileNotFound: { path: P } }, `file not found: ${P}`],
    [{ PermissionDenied: { path: P } }, `permission denied: ${P}`],
    [{ EncodingError: { path: P, detected: "GBK" } }, `encoding error: ${P} detected=GBK`],
    [{ FileTooLarge: { path: P, size: 11_000_000 } }, `file too large: ${P} size=11000000`],
    ["DiskFull", "disk full"],
    [{ InvalidPath: { path: "../x" } }, "invalid path: ../x"],
    [{ IoError: { message: "Read-only file system (os error 30)" } }, "Read-only file system (os error 30)"],
  ])("%j → %s", async (error, expected) => {
    expect(await ipcErrorMessage(error)).toBe(expected);
  });
});

describe("ipcErrorMessage — other shapes", () => {
  it("Error → its message", async () => {
    expect(await ipcErrorMessage(new Error("editor changes could not be captured"))).toBe(
      "editor changes could not be captured",
    );
  });

  it("plain string (a `Result<_, String>` command) → itself", async () => {
    expect(await ipcErrorMessage("watcher not running")).toBe("watcher not running");
  });

  it("plain object with a string message → the message", async () => {
    expect(await ipcErrorMessage({ message: "boom", code: 3 })).toBe("boom");
  });

  it("an unknown externally tagged variant → its variant name, never [object Object]", async () => {
    expect(await ipcErrorMessage({ Cancelled: null })).toBe("Cancelled");
    expect(await ipcErrorMessage({ ExportFailed: { message: "render failed" } })).toBe("ExportFailed: render failed");
  });

  it("a FileError-named key with a malformed payload does not throw or print [object Object]", async () => {
    const out = await ipcErrorMessage({ PermissionDenied: "oops" });
    expect(out).not.toContain("[object Object]");
    expect(out).toContain("PermissionDenied");
  });

  it.each([[null], [undefined], [42], [{}], [{ a: 1, b: 2 }], [[1, 2]]])(
    "unknown %j → non-empty text without [object Object]",
    async (error) => {
      const out = await ipcErrorMessage(error);
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toContain("[object Object]");
    },
  );
});
