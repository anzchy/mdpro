/**
 * D47 — the About page's "Install Update" (phase `available`) and "Restart to
 * Apply" (phase `ready`) buttons carried `toolbar-button-primary`, a class no
 * app stylesheet defines, so they rendered with browser-default styling.
 *
 * These tests render the real AboutSettings, drive it through the updater
 * phases with the Tauri plugins mocked at the boundary, and assert:
 *   1. each primary action uses the shared primary variant
 *      (`toolbar-button toolbar-button--primary`, rule 32 § Button states);
 *   2. every class on those buttons has a selector in the app CSS the app
 *      actually loads (src/styles/index.css import order, via src/test/appCss),
 *      so an undefined class name cannot slip back in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readAppCss } from "../src/test/appCss";
import { useUpdaterStore } from "../src/stores/updaterStore";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  check: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));

import { AboutSettings } from "../src/components/common/settings/AboutSettings";

function fakeUpdate() {
  return {
    version: "9.9.9",
    body: null,
    downloadAndInstall: vi.fn(async () => undefined),
  };
}

const APP_CSS = readAppCss();

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the app CSS has a selector naming `.className` exactly (not a longer class). */
function cssDefinesClass(className: string): boolean {
  return new RegExp(`\\.${escapeRegExp(className)}(?![\\w-])`).test(APP_CSS);
}

function classesOf(el: HTMLElement): string[] {
  return Array.from(el.classList);
}

beforeEach(() => {
  useUpdaterStore.setState({ cachedResult: null });
  mocks.invoke.mockImplementation(async (cmd: string) =>
    cmd === "get_app_version" ? "1.0.0" : undefined,
  );
  mocks.check.mockImplementation(async () => fakeUpdate());
  mocks.relaunch.mockImplementation(async () => undefined);
});

async function renderAvailable() {
  render(<AboutSettings />);
  return screen.findByRole("button", { name: "Install Update" });
}

async function renderReady() {
  const user = userEvent.setup();
  const install = await renderAvailable();
  await user.click(install);
  return screen.findByRole("button", { name: "Restart to Apply" });
}

describe("D47 — AboutSettings primary update actions use the defined primary variant", () => {
  it("Install Update (phase available) has toolbar-button and toolbar-button--primary", async () => {
    const button = await renderAvailable();
    expect(button).toHaveClass("toolbar-button", "toolbar-button--primary");
    expect(button).not.toHaveClass("toolbar-button-primary");
  });

  it("Restart to Apply (phase ready) has toolbar-button and toolbar-button--primary", async () => {
    const button = await renderReady();
    expect(button).toHaveClass("toolbar-button", "toolbar-button--primary");
    expect(button).not.toHaveClass("toolbar-button-primary");
  });
});

describe("D47 — every class on the update actions is defined in app CSS", () => {
  it("the guard itself rejects the undefined class and accepts the real ones", () => {
    expect(cssDefinesClass("toolbar-button-primary")).toBe(false);
    expect(cssDefinesClass("toolbar-button")).toBe(true);
    expect(cssDefinesClass("toolbar-button--primary")).toBe(true);
  });

  it("Install Update: no class is missing from app CSS", async () => {
    const button = await renderAvailable();
    const classes = classesOf(button);
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.filter((c) => !cssDefinesClass(c))).toEqual([]);
  });

  it("Restart to Apply: no class is missing from app CSS", async () => {
    const button = await renderReady();
    const classes = classesOf(button);
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.filter((c) => !cssDefinesClass(c))).toEqual([]);
  });
});
