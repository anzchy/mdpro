import { useRef } from "react";
import { loggingService } from "../services/loggingService";

interface DevToolbarProps {
  onOpenFile: (content: string, fileName: string) => void;
  onNewDocument?: () => void;
  onOpenDialog?: () => void;
}

/**
 * Development-only toolbar for testing/debugging.
 * Visible when running in development mode:
 * - `pnpm dev` (browser mode) - uses browser file input
 * - `pnpm tauri dev` (Tauri development) - uses Tauri native dialogs
 * Hidden in:
 * - Built macOS app (production)
 */
export function DevToolbar({ onOpenFile, onNewDocument, onOpenDialog }: DevToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if running in Tauri environment
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  // Only show in development mode (both browser and Tauri dev)
  // - pnpm dev: DEV=true, isTauri=false → show (browser file input)
  // - pnpm tauri dev: DEV=true, isTauri=true → show (Tauri native dialogs)
  // - built app: DEV=false → hide
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

  const handleOpenClick = () => {
    loggingService.logButtonClick("dev.toolbar.open_file");
    if (isTauri && onOpenDialog) {
      // In Tauri dev mode, use native file dialog
      onOpenDialog();
    } else {
      // In browser mode, use file input
      fileInputRef.current?.click();
    }
  };

  const handleNewClick = () => {
    loggingService.logButtonClick("dev.toolbar.new_document");
    onNewDocument?.();
  };

  return (
    <div className="dev-toolbar" tabIndex={-1}>
      <span className="dev-toolbar-label">DEV MODE</span>
      <button className="dev-toolbar-button" onClick={handleNewClick}>
        New
      </button>
      <button className="dev-toolbar-button" onClick={handleOpenClick}>
        Open
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown"
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />
    </div>
  );
}
