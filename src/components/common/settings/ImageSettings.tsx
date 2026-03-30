import { useEffect, useRef, useState } from "react";
import type { UserPreferences } from "../../../types/preferences";
import { DEFAULT_IMAGE_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";

interface ImageSlice {
  assetFolder: string;
  copyExternalImages: boolean;
}

/** Reject absolute paths and path traversal out of the document tree. */
function isValidAssetFolder(path: string): boolean {
  if (path.startsWith("/")) return false;
  if (path.split("/").some((p) => p === "..")) return false;
  // Reject null bytes and control characters.
  if (/[\x00-\x1f]/.test(path)) return false;
  return true;
}

export function ImageSettings() {
  const cachedFullPrefs = useRef<UserPreferences | null>(null);
  const [prefs, setPrefs] = useState<ImageSlice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    preferencesService
      .getPreferences()
      .then((p) => {
        if (cancelled) return;
        cachedFullPrefs.current = p;
        setPrefs({
          assetFolder: p.image?.assetFolder ?? DEFAULT_IMAGE_CONFIG.assetFolder,
          copyExternalImages:
            p.image?.copyExternalImages ?? DEFAULT_IMAGE_CONFIG.copyExternalImages,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load settings");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Checkbox toggle — immediate async save with rollback. */
  const handleBoolChange = async (key: keyof ImageSlice, value: boolean) => {
    if (!prefs || !cachedFullPrefs.current) return;
    const prev = { ...prefs };
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    const nextImage = { ...cachedFullPrefs.current.image, ...next };
    cachedFullPrefs.current = { ...cachedFullPrefs.current, image: nextImage };
    try {
      await preferencesService.setPreferences({ image: nextImage });
    } catch {
      setPrefs(prev);
      cachedFullPrefs.current = { ...cachedFullPrefs.current, image: { ...nextImage, ...prev } };
    }
  };

  /** Text input — validates path, updates local state immediately, debounces save 500ms. */
  const handleFolderChange = (value: string) => {
    if (!prefs || !cachedFullPrefs.current) return;
    if (value !== "" && !isValidAssetFolder(value)) return;
    const next = { ...prefs, assetFolder: value };
    setPrefs(next);
    const nextImage = { ...cachedFullPrefs.current.image, ...next };
    cachedFullPrefs.current = { ...cachedFullPrefs.current, image: nextImage };

    if (textSaveTimer.current) clearTimeout(textSaveTimer.current);
    textSaveTimer.current = setTimeout(() => {
      void preferencesService.setPreferences({ image: nextImage }).catch(() => {
        setError("Failed to save image settings");
      });
    }, 500);
  };

  if (error) {
    return (
      <div>
        <div className="settings-page-header">
          <h3 className="settings-page-title">Image</h3>
        </div>
        <p className="settings-error">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="settings-page-header">
        <h3 className="settings-page-title">Image</h3>
        <p className="settings-page-desc">Image handling and paste behavior.</p>
      </div>

      {!prefs ? (
        <div aria-busy="true" style={{ opacity: 0.5 }}>
          Loading…
        </div>
      ) : (
        <>
          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <label htmlFor="img-asset-folder">
                  <h4>Image Folder</h4>
                  <p>Relative path to store images (from the document location).</p>
                </label>
              </div>
              <div className="settings-row-control">
                <input
                  id="img-asset-folder"
                  type="text"
                  className="settings-input"
                  value={prefs.assetFolder}
                  onChange={(e) => handleFolderChange(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <label htmlFor="img-copy-external">
                  <h4>Copy Images to Folder on Paste</h4>
                  <p>Automatically copy external images to the image folder.</p>
                </label>
              </div>
              <div className="settings-row-control">
                <input
                  id="img-copy-external"
                  type="checkbox"
                  checked={prefs.copyExternalImages}
                  onChange={(e) => {
                    void handleBoolChange("copyExternalImages", e.target.checked);
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
