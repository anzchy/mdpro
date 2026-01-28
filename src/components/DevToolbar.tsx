import { useRef } from "react";
import { loggingService } from "../services/loggingService";

interface DevToolbarProps {
  onOpenFile: (content: string, fileName: string) => void;
}

/**
 * Development-only toolbar for testing in browser without Tauri.
 * Only visible when running `pnpm dev` (browser mode), hidden in:
 * - `pnpm tauri dev` (Tauri development)
 * - Built macOS app (production)
 */
export function DevToolbar({ onOpenFile }: DevToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if running in Tauri environment
  const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

  // Only show in development mode AND not in Tauri
  // - pnpm dev: DEV=true, isTauri=false → show
  // - pnpm tauri dev: DEV=true, isTauri=true → hide
  // - built app: DEV=false, isTauri=true → hide
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

  const handleOpenClick = () => {
    loggingService.logButtonClick("dev.toolbar.open_file");
    fileInputRef.current?.click();
  };

  return (
    <div className="dev-toolbar">
      <span className="dev-toolbar-label">DEV MODE</span>
      <button className="dev-toolbar-button" onClick={handleOpenClick}>
        Open File
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
