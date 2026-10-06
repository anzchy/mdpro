import { useRef } from "react";

interface DevToolbarProps {
  onOpenFile: (content: string, fileName: string) => void;
}

/**
 * Browser-dev-mode test hook — renders no visible UI in any mode.
 *
 * In `pnpm dev` (`import.meta.env.DEV` true and no `window.__TAURI_INTERNALS__`) it
 * mounts one hidden, unfocusable `<input type="file" data-testid="dev-open-file">`.
 * Setting files on it (e.g. the E5 snapshot harness, `scripts/redesign/snapshot.js`)
 * reads the file and calls `onOpenFile(content, fileName)`.
 *
 * Renders nothing under `pnpm tauri dev` (the native menu provides New / Open) or in
 * the built app, so every mode looks like the release app. The visible "DEV MODE"
 * toolbar was removed by user decision on 2026-10-05.
 */
export function DevToolbar({ onOpenFile }: DevToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  // Mount only in browser development mode
  // - pnpm dev: DEV=true, isTauri=false → hidden file input
  // - pnpm tauri dev: DEV=true, isTauri=true → nothing
  // - built app: DEV=false → nothing
  if (!import.meta.env.DEV || isTauri) {
    return null;
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      console.log("[DEV] File loaded:", file.name, "content length:", content.length);
      onOpenFile(content, file.name);
    } catch (error) {
      console.error("[DEV] Failed to read file:", error);
    }

    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <input
      ref={fileInputRef}
      type="file"
      accept=".md,.markdown"
      data-testid="dev-open-file"
      hidden
      tabIndex={-1}
      aria-hidden="true"
      onChange={handleFileSelect}
    />
  );
}
