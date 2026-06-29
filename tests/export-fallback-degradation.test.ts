/**
 * Pins the ACCEPTED DEGRADATION of the export `marked` fallback (audit B2,
 * plan decision A1).
 *
 * `exportService.renderMarkdown` uses the canonical Rust `render_markdown` IPC.
 * When that IPC throws, it falls back to a `marked` render that has NO math or
 * footnote support wired. This test forces the fallback (by rejecting the IPC)
 * and asserts the gap so it is a reviewed, documented limitation rather than a
 * silent surprise: math stays as raw `$…$`, footnotes stay as raw `[^1]`.
 *
 * If a future change adds math/footnotes to the fallback, this test will fail —
 * a deliberate prompt to update the CHANGELOG degradation note and the catch
 * block comment in exportService.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportService } from "../src/services/exportService";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("export marked-fallback degradation (B2)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    // Force the fallback path: the canonical Rust renderer is unavailable.
    invokeMock.mockRejectedValue(new Error("render_markdown IPC unavailable"));
  });

  it("does NOT render inline/display math (stays raw $…$)", async () => {
    const html = await exportService.renderMarkdown("Value $a+b$ and $$\\int_0^1$$");
    // The Rust-only math wrappers are absent on the fallback path.
    expect(html).not.toContain("math-inline");
    expect(html).not.toContain("math-display");
    // The raw TeX survives as literal text (degraded, but not lost/blanked).
    expect(html).toContain("$a+b$");
  });

  it("does NOT render footnotes (no back-link, stays raw [^1])", async () => {
    const html = await exportService.renderMarkdown("Note[^1].\n\n[^1]: text");
    expect(html).not.toContain("footnote-backref");
    expect(html).not.toContain("footnote-reference");
    expect(html).not.toContain('href="#fnref-1"');
  });

  it("still renders ordinary markdown (headings) so export is not empty", async () => {
    const html = await exportService.renderMarkdown("# Hello world");
    // The fallback IS wired for headings (with anchor ids) — confirm it works,
    // so the degradation is scoped to math/footnotes, not a total failure.
    expect(html).toContain("<h1");
    expect(html).toContain("Hello world");
  });
});
