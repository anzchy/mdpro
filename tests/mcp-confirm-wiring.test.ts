/**
 * ADR-0042 WI-9 (matrix SG-3) — the MCP write-confirmation container is
 * mounted exactly once in `App`, which every window renders (`src/main.tsx`
 * renders `<App />` for every webview), so every window can show the prompt
 * for the documents it owns.
 *
 * Source-text inspection: a weak supplement. The behavioural checks are the
 * hook/dialog tests (`use-mcp-confirm.test.tsx`,
 * `mcp-write-confirm-dialog.test.tsx`) and the WI-10 device gate G1.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");

describe("SG-3 McpWriteConfirm is mounted once in App", () => {
  it("renders <McpWriteConfirm exactly once", () => {
    expect(app.match(/<McpWriteConfirm\b/g) ?? []).toHaveLength(1);
  });

  it("imports it from the component that exists", () => {
    const spec = app.match(/import\s*\{\s*McpWriteConfirm\s*\}\s*from\s*"([^"]+)"/);
    expect(spec).not.toBeNull();
    const target = path.join(root, "src", `${spec?.[1] ?? ""}.tsx`);
    expect(fs.existsSync(target)).toBe(true);
  });
});
