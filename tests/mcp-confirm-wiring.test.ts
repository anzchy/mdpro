// @vitest-environment node
/**
 * ADR-0042 WI-9 (matrix SG-3) — the MCP write-confirmation container is
 * mounted exactly once per window. Every window renders `App` (`src/main.tsx`
 * renders `<App />` for every webview), and since D42 WI-3 App renders the
 * dialog composition `AppDialogs` exactly once, which mounts the container.
 *
 * Source-text inspection: a weak supplement. The behavioural checks are the
 * hook/dialog tests (`use-mcp-confirm.test.tsx`,
 * `mcp-write-confirm-dialog.test.tsx`), `app-dialogs.test.tsx` 3.4 and the
 * WI-10 device gate G1.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
// Retargeted in D42 WI-3 (policy rule 12): the JSX moved from App.tsx into
// AppDialogs.tsx; the specification ("mounted exactly once per window") did not.
const appDialogs = fs.readFileSync(path.join(root, "src/components/AppDialogs.tsx"), "utf8");

describe("SG-3 McpWriteConfirm is mounted once per window", () => {
  it("renders <McpWriteConfirm exactly once", () => {
    // Retargeted in D42 WI-3: the JSX moved to AppDialogs.tsx; the specification did not.
    expect(appDialogs.match(/<McpWriteConfirm\b/g) ?? []).toHaveLength(1);
    // Added with the retarget: App mounts AppDialogs once and no longer mounts the
    // container itself, so the per-window count is still exactly one.
    expect(app.match(/<AppDialogs\b/g) ?? []).toHaveLength(1);
    expect(app).not.toMatch(/<McpWriteConfirm\b/);
  });

  it("imports it from the component that exists", () => {
    // Retargeted in D42 WI-3: the import moved with the JSX; the specification did not.
    const spec = appDialogs.match(/import\s*\{\s*McpWriteConfirm\s*\}\s*from\s*"([^"]+)"/);
    expect(spec).not.toBeNull();
    const target = path.join(root, "src/components", `${spec?.[1] ?? ""}.tsx`);
    expect(fs.existsSync(target)).toBe(true);
  });
});
