import { useRef } from "react";

interface DevToolbarProps {
  onOpenFile: (content: string, fileName: string) => void;
}

/**
 * Development-only toolbar for testing in browser without Tauri.
 * Only visible when running in browser (not in Tauri window).
 */
export function DevToolbar({ onOpenFile }: DevToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if running in Tauri (window.__TAURI__ exists)
  const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

  // Don't render in Tauri environment
  if (isTauri) {
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
