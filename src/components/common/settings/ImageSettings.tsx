import { useEffect, useRef, useState } from "react";
import type { ImageConfig, UserPreferences } from "../../../types/preferences";
import { DEFAULT_IMAGE_CONFIG } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";

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
  const [prefs, setPrefs] = useState<ImageSlice | null>(null);
  /**
   * The same value as `prefs`, readable synchronously.
   *
   * The debounced write reads this at *fire* time instead of sending a snapshot
   * captured when the keystroke happened. A captured snapshot is what made the
   * timer replay a stale `copyExternalImages` over the newer toggle (WI-2).
   */
  const prefsRef = useRef<ImageSlice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Per-leaf monotonic token: "which write most recently claimed this field".
   *
   * Rolling back against the *latest* slice protects a **sibling** the user
   * edited while the failing write was open (WI2-G′). It does not protect the
   * failing field itself: toggle a checkbox three times with the first write
   * still in flight and that write's rollback restores a value the boundary has
   * already superseded twice, with no further event to correct it.
   *
   * So a write may only roll its leaf back while it is still the leaf's latest
   * claimant. Twin of `leafIntents` in `ExportSettings.tsx`, same device as
   * `latestThemeIntent` in `src/hooks/useTheme.ts`.
   *
   * Found at review, 2026-09-24; pinned by WI2-L.
   */
  const leafIntents = useRef<Partial<Record<keyof ImageSlice, number>>>({});
  const nextLeafIntent = useRef(0);

  /** Mark `key` as claimed by a new write and return that write's token. */
  const claimLeaf = (key: keyof ImageSlice): number => {
    nextLeafIntent.current += 1;
    leafIntents.current[key] = nextLeafIntent.current;
    return nextLeafIntent.current;
  };

  const commitSlice = (slice: ImageSlice) => {
    prefsRef.current = slice;
    setPrefs(slice);
  };

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

  const saveSlice = async (slice: ImageSlice): Promise<boolean> => {
    try {
      await preferencesService.setPreferences({ image: buildImagePayload(slice) });
      return true;
    } catch {
      // No inline notice here, deliberately — matches ExportSettings exactly.
      // `preferencesService` already raises the one toast for this event, and
      // rule 30 §5 allows a single event exactly one of toast / banner / inline
      // note / modal, never two. The toast is also the only signal that still
      // reaches the user when this write was dispatched and the dialog closed
      // before it rejected; an inline note is a no-op on an unmounted panel.
      //
      // WI2-I's defect was the pane being *destroyed* on failure, not the
      // absence of an inline message: the controls below stay mounted, operable
      // and holding the user's value. `error` is load-failure only, where no
      // toast is raised and it is therefore the sole signal.
      return false;
    }
  };

  useEffect(() => {
    let cancelled = false;
    preferencesService
      .getPreferences("settings_image")
      .then((p) => {
        if (cancelled) return;
        cachedFullPrefs.current = p;
        commitSlice({
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
      // DISCARD, not flush (WI-5): a pending keystroke whose result the user can
      // no longer see is abandoned when the panel goes away. Flushing it would
      // commit a write after the surface that showed it is gone.
      if (textSaveTimer.current) {
        clearTimeout(textSaveTimer.current);
        textSaveTimer.current = null;
      }
    };
  }, []);

  /** Checkbox toggle — immediate async save, rolling back only this control. */
  const handleBoolChange = async (key: keyof ImageSlice, value: boolean) => {
    const current = prefsRef.current;
    if (!current) return;
    const previousValue = current[key];
    const intent = claimLeaf(key);
    const next = { ...current, [key]: value };
    commitSlice(next);

    const saved = await saveSlice(next);
    if (saved) return;
    // A later write has claimed this leaf since; its value is newer than ours,
    // so ours is not the one to restore (WI2-L).
    if (leafIntents.current[key] !== intent) return;
    // Roll back this control only, against the *latest* state: the rejection can
    // land after the user has edited another field, and a whole-slice snapshot
    // would revert that edit under them (WI2-G′).
    const latest = prefsRef.current ?? next;
    commitSlice({ ...latest, [key]: previousValue });
  };

  /** Text input — validates the path, updates local state, debounces the save. */
  const handleFolderChange = (value: string) => {
    const current = prefsRef.current;
    if (!current) return;
    // A rejected keystroke changes nothing — including the pending timer, which
    // must still fire with the last *valid* folder (WI2-D).
    if (value !== "" && !isValidAssetFolder(value)) return;
    // Every accepted keystroke claims the leaf, so a write already in flight
    // against it can no longer roll the user's typing back (WI2-L).
    claimLeaf("assetFolder");
    commitSlice({ ...current, assetFolder: value });

    if (textSaveTimer.current) clearTimeout(textSaveTimer.current);
    textSaveTimer.current = setTimeout(() => {
      textSaveTimer.current = null;
      const slice = prefsRef.current;
      if (slice) void saveSlice(slice);
    }, SAVE_DEBOUNCE_MS);
  };

  return (
    <div>
      <div className="settings-page-header">
        <h3 className="settings-page-title">Image</h3>
        <p className="settings-page-desc">Image handling and paste behavior.</p>
      </div>

      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}

      {!prefs ? (
        // A load failure leaves no values to render, so the busy note is
        // suppressed once the error is showing; a save failure keeps the
        // controls mounted above.
        error ? null : (
          <div aria-busy="true" style={{ opacity: 0.5 }}>
            Loading…
          </div>
        )
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
