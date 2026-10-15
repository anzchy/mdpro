// @vitest-environment node
/**
 * D240 (ADR-0108): "a modal is open" means an `[aria-modal="true"]` element is
 * in the document. The MCP confirm queue holds on it, and the D165 / D235
 * guards refuse on it. A new modal that renders a `.dialog-backdrop` without
 * an `aria-modal="true"` card would be invisible to all three: an MCP prompt
 * would mount on top of it again. This pins the contract at the source: in
 * every component, each `dialog-backdrop` is matched by a `role="dialog"` tag
 * that carries `aria-modal="true"`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..", "src");

function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return e.name.endsWith(".tsx") ? [p] : [];
  });
}

/** The attribute text of the JSX opening tag that contains `at`. */
function openingTag(text: string, at: number): string {
  const start = text.lastIndexOf("<", at);
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
    } else if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
    } else if (c === ">" && depth === 0) {
      return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/** Every `role="dialog"` opening tag in `text`. */
function dialogTags(text: string): string[] {
  const tags: string[] = [];
  for (let at = text.indexOf('role="dialog"'); at >= 0; at = text.indexOf('role="dialog"', at + 1)) {
    tags.push(openingTag(text, at));
  }
  return tags;
}

const files = tsxFiles(SRC).map((file) => ({
  file: path.relative(SRC, file),
  text: fs.readFileSync(file, "utf8"),
}));

describe("D240 every modal is visible to the aria-modal check", () => {
  it("M1 finds the known modals (the scan is not vacuous)", () => {
    const withDialog = files.filter((f) => dialogTags(f.text).length > 0).map((f) => path.basename(f.file));
    for (const name of ["LinkInsertModal.tsx", "McpWriteConfirmDialog.tsx", "RecoveryDialog.tsx", "SettingsDialog.tsx"]) {
      expect(withDialog).toContain(name);
    }
  });

  it.each(files.filter((f) => dialogTags(f.text).length > 0).map((f) => [f.file, f.text]))(
    "M2 %s: every role=\"dialog\" tag carries aria-modal=\"true\"",
    (_file, text) => {
      for (const tag of dialogTags(text)) expect(tag).toContain('aria-modal="true"');
    },
  );

  it.each(files.filter((f) => f.text.includes("dialog-backdrop")).map((f) => [f.file, f.text]))(
    "M3 %s: each dialog-backdrop has a role=\"dialog\" aria-modal card",
    (_file, text) => {
      const backdrops = text.split('className="dialog-backdrop"').length - 1;
      const modals = dialogTags(text).filter((tag) => tag.includes('aria-modal="true"')).length;
      expect(modals).toBeGreaterThanOrEqual(backdrops);
    },
  );
});
