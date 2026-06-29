/**
 * WI-1 — exportService PDF export + htmlIncludeStyles wiring.
 *
 * Mocks the Tauri IPC boundary (`@tauri-apps/api/core` invoke) only; the
 * service logic under test is exercised directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportService } from "../src/services/exportService";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("exportService — WI-1 PDF + htmlIncludeStyles wiring", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  // C1: exportPdf forwards content/title/theme/includeStyles to the export_pdf command.
  it("C1: exportPdf invokes export_pdf with includeStyles forwarded", async () => {
    invokeMock.mockResolvedValue({ success: true, path: "/out.pdf", htmlSize: 10 });

    const result = await exportService.exportPdf("# hi", "doc", "light", false);

    expect(invokeMock).toHaveBeenCalledWith("export_pdf", {
      content: "# hi",
      title: "doc",
      theme: "light",
      includeStyles: false,
    });
    expect(result.path).toBe("/out.pdf");
  });

  // C2: the includeStyles flag actually changes the returned payload (not ignored).
  it("C2: htmlIncludeStyles branch changes exportHtml result", async () => {
    invokeMock.mockImplementation((_cmd: string, args?: Record<string, unknown>) =>
      Promise.resolve({
        success: true,
        path: "/out.html",
        htmlSize: args?.includeStyles ? 5000 : 200,
      }),
    );

    const withStyles = await exportService.exportHtml("# x", "doc", "light", true);
    const withoutStyles = await exportService.exportHtml("# x", "doc", "light", false);

    expect(withStyles.htmlSize).toBe(5000);
    expect(withoutStyles.htmlSize).toBe(200);
    expect(withStyles.htmlSize).not.toBe(withoutStyles.htmlSize);
  });

  // C3: an ExportError-shaped rejection propagates (wrapper does not swallow it).
  it("C3: exportPdf rejects when the command rejects", async () => {
    invokeMock.mockRejectedValue({ ExportFailed: { message: "boom" } });

    await expect(
      exportService.exportPdf("# x", "doc", "dark", true),
    ).rejects.toEqual({ ExportFailed: { message: "boom" } });
  });

  // C4: a Cancelled rejection is surfaced distinctly (not coerced to success).
  it("C4: exportPdf surfaces Cancelled distinctly", async () => {
    invokeMock.mockRejectedValue("Cancelled");

    await expect(
      exportService.exportPdf("# x", "doc", "light", true),
    ).rejects.toBe("Cancelled");
  });

  // exportHtml defaults includeStyles to true when caller omits it (back-compat).
  it("exportHtml defaults includeStyles=true when omitted", async () => {
    invokeMock.mockResolvedValue({ success: true, path: "/o.html", htmlSize: 1 });

    await exportService.exportHtml("# x", "doc", "light");

    expect(invokeMock).toHaveBeenCalledWith("export_html", {
      content: "# x",
      title: "doc",
      theme: "light",
      includeStyles: true,
    });
  });
});
