import { useEffect, useRef, useState } from "react";
import type { UserPreferences } from "../../../types/preferences";
import { preferencesService } from "../../../services/preferencesService";

interface ImageSlice {
  assetFolder: string;
  copyExternalImages: boolean;
}

const DEFAULT_IMAGE_SLICE: ImageSlice = {
  assetFolder: "./assets",
  copyExternalImages: true,
};

export function ImageSettings() {
  const cachedFullPrefs = useRef<UserPreferences | null>(null);
  const [prefs, setPrefs] = useState<ImageSlice | null>(null);

  useEffect(() => {
    void preferencesService.getPreferences().then((p) => {
      cachedFullPrefs.current = p;
      setPrefs({
        assetFolder:
          p.image?.assetFolder ?? DEFAULT_IMAGE_SLICE.assetFolder,
        copyExternalImages:
          p.image?.copyExternalImages ?? DEFAULT_IMAGE_SLICE.copyExternalImages,
      });
    });
  }, []);

  const handleChange = (key: keyof ImageSlice, value: string | boolean) => {
    if (!prefs || !cachedFullPrefs.current) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    cachedFullPrefs.current = {
      ...cachedFullPrefs.current,
      image: { ...cachedFullPrefs.current.image, ...next },
    };
    void preferencesService.setPreferences(cachedFullPrefs.current);
  };

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
                <h4>Image Folder</h4>
                <p>Relative path to store images (from the document location).</p>
              </div>
              <div className="settings-row-control">
                <input
                  type="text"
                  className="settings-input"
                  value={prefs.assetFolder}
                  onChange={(e) => handleChange("assetFolder", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-content">
              <div className="settings-row-label">
                <h4>Copy Images to Folder on Paste</h4>
                <p>Automatically copy external images to the image folder.</p>
              </div>
              <div className="settings-row-control">
                <input
                  type="checkbox"
                  checked={prefs.copyExternalImages}
                  onChange={(e) =>
                    handleChange("copyExternalImages", e.target.checked)
                  }
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
