// @vitest-environment node
/**
 * Tests for AboutSettings component.
 *
 * Strategy: source inspection for key correctness guarantees.
 * Behavioral tests for updaterStore and prepareForRelaunch are in their own files.
 *
 * Covers:
 *   1. Component structure and phase rendering
 *   2. Critical review fixes: ConfirmDialog, progress bar, disabled states
 *   3. DOMPurify sanitization of release notes
 *   4. Cache-safe state usage (no caching of 'available')
 *   5. updates-disabled phase detection — behavioural, in
 *      about-settings-updater-disabled.test.tsx and updater-errors.test.ts
 *   6. Logging events
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");
const aboutSrc = fs.readFileSync(
  path.join(SRC, "components/common/settings/AboutSettings.tsx"),
  "utf-8",
);

describe("AboutSettings — source structure", () => {
  it("exports AboutSettings as a named export", () => {
    expect(aboutSrc).toContain("export function AboutSettings");
  });

  it("imports from updaterStore, not module-level cache", () => {
    expect(aboutSrc).toContain("useUpdaterStore");
    expect(aboutSrc).not.toContain("let cachedResult:");
    // Rule 50: uses getState() in callback, not React subscription
    expect(aboutSrc).toContain("useUpdaterStore.getState().cachedResult");
  });

  it("imports prepareForRelaunch from useUpdater hook", () => {
    expect(aboutSrc).toContain("prepareForRelaunch");
    expect(aboutSrc).toContain('from "../../../hooks/useUpdater"');
  });

  it("uses ConfirmDialog, not window.confirm", () => {
    expect(aboutSrc).toContain("<ConfirmDialog");
    expect(aboutSrc).not.toContain("window.confirm");
  });

  it("ConfirmDialog has correct labels", () => {
    expect(aboutSrc).toContain('confirmLabel="Save and Restart"');
    expect(aboutSrc).toContain("Don't restart yet");
  });

  it("uses relaunch from @tauri-apps/plugin-process", () => {
    expect(aboutSrc).toContain('from "@tauri-apps/plugin-process"');
    expect(aboutSrc).toContain("relaunch()");
  });

  it("calls prepareForRelaunch before relaunch", () => {
    const relaunchFunc = aboutSrc.match(
      /async function handleRelaunch[\s\S]*?^\s{2}\}/m,
    );
    expect(relaunchFunc).not.toBeNull();
    const body = relaunchFunc![0];
    const prepareIndex = body.indexOf("prepareForRelaunch");
    const relaunchIndex = body.indexOf("relaunch()");
    expect(prepareIndex).toBeLessThan(relaunchIndex);
    expect(body).toContain("if (!canProceed) return");
  });
});

describe("AboutSettings — update phases", () => {
  it("renders all 7 phases", () => {
    expect(aboutSrc).toContain('"checking"');
    expect(aboutSrc).toContain('"up-to-date"');
    expect(aboutSrc).toContain('"error"');
    expect(aboutSrc).toContain('"updates-disabled"');
    expect(aboutSrc).toContain('"available"');
    expect(aboutSrc).toContain('"downloading"');
    expect(aboutSrc).toContain('"ready"');
  });

  it("shows updates-disabled message", () => {
    expect(aboutSrc).toContain("Automatic updates coming soon");
  });

  it("uses mechanical microcopy for up-to-date", () => {
    expect(aboutSrc).toContain("You're up to date");
  });

  it("uses mechanical microcopy for available", () => {
    expect(aboutSrc).toContain("Update available —");
  });

  it("uses mechanical microcopy for ready", () => {
    expect(aboutSrc).toContain("Ready to install");
  });

  it("uses mechanical microcopy for error", () => {
    // D85 / rule 12: error copy changed (user-approved).
    expect(aboutSrc).toContain(
      "Couldn't get update information. Try again later.",
    );
  });

  it("version is prefixed with v", () => {
    expect(aboutSrc).toContain("`v${currentVersion}`");
    // In JSX: v{state.version}
    expect(aboutSrc).toContain("v{state.version}");
  });
});

describe("AboutSettings — progress bar", () => {
  it("uses <progress> element, not text-only percentage", () => {
    expect(aboutSrc).toContain("<progress");
  });

  it("renders indeterminate when progress is 0", () => {
    expect(aboutSrc).toContain(
      "state.progress > 0 ? state.progress : undefined",
    );
  });

  it("has aria-label on progress element", () => {
    expect(aboutSrc).toContain('aria-label="Download progress"');
  });
});

describe("AboutSettings — Check Again disabled states", () => {
  it("disables during checking, downloading, and ready phases", () => {
    expect(aboutSrc).toContain('state.phase === "checking"');
    expect(aboutSrc).toContain('state.phase === "downloading"');
    expect(aboutSrc).toContain('state.phase === "ready"');
    expect(aboutSrc).toContain("disabled={checkDisabled}");
  });

  it("hides Check Again in updates-disabled phase", () => {
    expect(aboutSrc).toContain('state.phase !== "updates-disabled"');
  });
});

describe("AboutSettings — release notes", () => {
  it("uses DOMPurify to sanitize HTML", () => {
    expect(aboutSrc).toContain("DOMPurify.sanitize");
  });

  it("uses marked to parse markdown", () => {
    expect(aboutSrc).toContain("marked.parse");
  });

  it("renders via dangerouslySetInnerHTML", () => {
    expect(aboutSrc).toContain("dangerouslySetInnerHTML");
    expect(aboutSrc).toContain("renderReleaseNotes(state.body)");
  });
});

describe("AboutSettings — error handling", () => {
  it("has try/catch on handleInstall", () => {
    const installFunc = aboutSrc.match(
      /async function handleInstall[\s\S]*?^\s{2}\}/m,
    );
    expect(installFunc).not.toBeNull();
    expect(installFunc![0]).toContain("try {");
    expect(installFunc![0]).toContain("catch (e)");
  });

  it("caches only safe states (not available)", () => {
    // The available branch should NOT call setCachedResult
    const ifUpdateBlock = aboutSrc.match(
      /if \(update\) \{[\s\S]*?\n\s{6}\} else/,
    );
    expect(ifUpdateBlock).not.toBeNull();
    expect(ifUpdateBlock![0]).not.toContain("setCachedResult");
  });
});

describe("AboutSettings — logging", () => {
  it("logs update check start and success/fail", () => {
    expect(aboutSrc).toContain("ui.about.update_check");
  });

  it("logs install start and success/fail", () => {
    expect(aboutSrc).toContain("ui.about.update_install");
  });

  it("logs relaunch event", () => {
    expect(aboutSrc).toContain("ui.about.relaunch");
  });
});
