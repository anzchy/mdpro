import { useRef } from "react";

interface DevToolbarProps {
  onOpenFile: (content: string, fileName: string) => void;
}

/**
 * Dev-build test hook — renders no visible UI in any mode.
 *
 * In every development build (`import.meta.env.DEV` true) — `pnpm dev` and
 * `pnpm tauri dev` alike — it mounts one hidden, unfocusable, aria-hidden
 * `<input type="file" data-testid="dev-open-file">`. Setting files on it (the E5
 * snapshot harness, `scripts/redesign/snapshot.js`, including inside the Tauri
 * WKWebView) reads the file and calls `onOpenFile(content, fileName)`. Mounting it
 * under Tauri too is a user decision of 2026-10-07.
 *
 * Renders nothing in the built app (`DEV` false), so release ships no hook. Because the
 * input is hidden, dev still looks like release: the visible "DEV MODE" toolbar was
 * removed by user decision on 2026-10-05.
 */
export function DevToolbar({ onOpenFile }: DevToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mount in every development build
  // - pnpm dev: DEV=true → hidden file input
  // - pnpm tauri dev: DEV=true → hidden file input (E5 harness loads fixtures in the WKWebView)
  // - built app: DEV=false → nothing
  if (!import.meta.env.DEV) {
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
