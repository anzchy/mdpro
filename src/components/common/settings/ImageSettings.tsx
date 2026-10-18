import { useEffect, useRef, useState } from "react";
import type { ImageConfig, UserPreferences } from "../../../types/preferences";
import { DEFAULT_IMAGE_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";
import { SettingsLoadFailed, SettingsLoading } from "./SettingsPageState";
import { useSettingsWriter } from "./useSettingsWriter";
import { ToggleSwitch } from "../ToggleSwitch";

interface ImageSlice {
  assetFolder: string;
  copyExternalImages: boolean;
}

/** Debounce window for the asset-folder text input. */
const SAVE_DEBOUNCE_MS = 500;

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
  const [loadFailed, setLoadFailed] = useState(false);
  const textSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Build the whole `image` group for a write.
   *
   * Seeded from `DEFAULT_IMAGE_CONFIG`, not from `cachedFullPrefs.current.image`:
   * the loaded preferences may carry no `image` group at all (the load path below
   * handles exactly that), and spreading `undefined` would emit a two-leaf group.
   * `ImageConfig` declares no serde defaults, so a partial group fails to
   * deserialize and the write dies at the backend (WI2-J). The backend replaces a
   * group wholesale, so every write must carry all four leaves.
   */
  const buildImagePayload = (slice: ImageSlice): ImageConfig => ({
    ...DEFAULT_IMAGE_CONFIG,
    ...cachedFullPrefs.current?.image,
    ...slice,
  });

  /**
   * One write at a time, each built when sent from the last confirmed slice
   * (F508-2). The writer also owns what `prefsRef` and the per-leaf intents did
   * here before: the debounced write reads the shown value at fire time (WI-2),
   * a failed write rolls back only its own leaf (WI2-G′), and only while no
   * later edit has claimed it (WI2-L) — now to the confirmed value, not to a
   * snapshot that may itself never have been saved.
   *
   * No inline notice on failure, deliberately: `preferencesService` raises the
   * one toast for the event (rule 30 §5), and it is the only signal that still
   * reaches the user when the dialog closed before the write rejected. WI2-I's
   * defect was the pane being destroyed on failure; the controls stay mounted,
   * operable and holding the saved value. `loadFailed` is load-failure only.
   */
  const writer = useSettingsWriter<ImageSlice>({
    save: (next) => preferencesService.setPreferences({ image: buildImagePayload(next) }),
  });
  const prefs = writer.value;

  useEffect(() => {
    let cancelled = false;
    preferencesService
      .getPreferences("settings_image")
      .then((p) => {
        if (cancelled) return;
        cachedFullPrefs.current = p;
        writer.load({
          assetFolder: p.image?.assetFolder ?? DEFAULT_IMAGE_CONFIG.assetFolder,
          copyExternalImages:
            p.image?.copyExternalImages ?? DEFAULT_IMAGE_CONFIG.copyExternalImages,
        });
      })
      .catch(() => {
        // The service has logged the failure (enum-only); the raw message stays out of the UI.
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
      // DISCARD, not flush (WI-5): a pending keystroke whose result the user can
      // no longer see is abandoned when the panel goes away. Flushing it would
      // commit a write after the surface that showed it is gone.
      if (textSaveTimer.current) {
        clearTimeout(textSaveTimer.current);
        textSaveTimer.current = null;
      }
    };
  }, []);

  /** Switch toggle — saved after any earlier write; rolls back only this control. */
  const handleBoolChange = (key: keyof ImageSlice, value: boolean) => {
    void writer.write({ [key]: value });
  };

  /** Text input — validates the path, updates local state, debounces the save. */
  const handleFolderChange = (value: string) => {
    if (writer.current() === null) return;
    // A rejected keystroke changes nothing — including the pending timer, which
    // must still fire with the last *valid* folder (WI2-D).
    if (value !== "" && !isValidAssetFolder(value)) return;
    // Every accepted keystroke claims the leaf, so a write already in flight
    // against it can no longer roll the user's typing back (WI2-L).
    writer.edit({ assetFolder: value });

    if (textSaveTimer.current) clearTimeout(textSaveTimer.current);
    textSaveTimer.current = setTimeout(() => {
      textSaveTimer.current = null;
      const slice = writer.current();
      // No rollback: a failed save keeps the typed folder shown (WI2-I); the toast says it failed.
      if (slice) void writer.write({ assetFolder: slice.assetFolder }, { rollback: false });
    }, SAVE_DEBOUNCE_MS);
  };

  return (
    <div>
      <div className="settings-page-header">
        <h3 className="settings-page-title">Image</h3>
        <p className="settings-page-desc">Image handling and paste behavior.</p>
      </div>

      {!prefs ? (
        // A load failure leaves no values to render, so it replaces the busy
        // line; a save failure keeps the controls mounted.
        loadFailed ? <SettingsLoadFailed /> : <SettingsLoading />
      ) : (
        <>
          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4 id="img-asset-folder-label">Image Folder</h4>
                <p>Relative path to store images (from the document location).</p>
              </div>
              <div className="settings-row-control">
                <input
                  id="img-asset-folder"
                  aria-labelledby="img-asset-folder-label"
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
                <h4 id="img-copy-external-label">Copy Images to Folder on Paste</h4>
                <p>Automatically copy external images to the image folder.</p>
              </div>
              <div className="settings-row-control">
                <ToggleSwitch
                  id="img-copy-external"
                  labelledBy="img-copy-external-label"
                  checked={prefs.copyExternalImages}
                  onChange={(v) => {
                    void handleBoolChange("copyExternalImages", v);
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
