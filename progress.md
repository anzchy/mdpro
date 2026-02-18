# Progress & Lessons Learned

## 2026-02-18 — Image Paste Feature Bugs

### Bug 1: Existing images not rendering in WYSIWYG mode

**Symptom:** Opening a `.md` file with `![](./assets/test-image.png)` in WYSIWYG mode (⌃4) showed a broken image — the PNG was not displayed.

**Root Cause:** Three missing pieces for the Tauri 2 asset protocol:

1. **`tauri.conf.json`** — Missing `assetProtocol` config. `convertFileSrc()` generates `asset://localhost/...` URLs, but the webview won't serve local files unless `assetProtocol.enable: true` and a `scope` are set.
2. **`Cargo.toml`** — Missing `protocol-asset` feature on the `tauri` dependency. Without it, Tauri's build script rejects the `assetProtocol` config.
3. **CSP** — Missing `https://asset.localhost` in `img-src`. Tauri 2 uses `https://asset.localhost` internally for the asset protocol.

**Fix:**
- `src-tauri/tauri.conf.json`: Added `"assetProtocol": { "enable": true, "scope": ["**/*"] }` and `https://asset.localhost` to CSP `img-src`.
- `src-tauri/Cargo.toml`: Added `"protocol-asset"` to tauri features.

**Lesson:** In Tauri 2, displaying local images via `convertFileSrc()` requires **three** things in sync:
1. `tauri.conf.json` → `security.assetProtocol.enable: true` + `scope`
2. `Cargo.toml` → `tauri` dependency must include `"protocol-asset"` feature
3. `tauri.conf.json` → CSP `img-src` must include `asset:` and `https://asset.localhost`

Missing any one of these silently fails — the `<img>` tag gets a valid-looking `asset://` URL but the webview returns 403 or blocks the request.

---

### Bug 2: Image paste fails with `missing required key documentPath`

**Symptom:** Pasting a PNG in WYSIWYG mode showed toast: `Failed to paste image: invalid args documentPath for command upload_image : command upload_image missing required key documentPath`.

**Root Cause:** `src/services/imageService.ts` passed **snake_case** keys to `invoke()`:

```typescript
// WRONG — Tauri 2 expects camelCase
invoke("upload_image", { document_path: documentPath, image_data: imageData })

// CORRECT — Tauri 2 auto-converts camelCase → snake_case for Rust params
invoke("upload_image", { documentPath, imageData })
```

Tauri 2 changed the IPC serialization convention. The JS-side `invoke()` args must use **camelCase** keys. Tauri automatically converts them to **snake_case** when deserializing into Rust `#[tauri::command]` function parameters.

The existing working commands (e.g., `fileService.ts`) already used camelCase (`actionId`, `documentId`), but the image commands were written with snake_case — likely copied from the Rust function signatures.

**Fix:** Changed all `invoke()` calls in `imageService.ts` to use camelCase keys:
- `document_path` → `documentPath`
- `image_data` → `imageData`
- `asset_folder` → `assetFolder`
- `image_path` → `imagePath`
- `source_path` → `sourcePath`

Affected functions: `resolveImagePath`, `uploadImage`, `uploadImagesBatch`, `copyExternalImage`.

**Lesson:** When writing Tauri 2 IPC wrappers, always use **camelCase** keys in `invoke()` args, even though the Rust function uses snake_case parameters. Look at existing working commands in the same project as reference — don't copy from Rust signatures.

**Prevention:** Added unit tests (`markdown-editor-core.test.ts`) that verify the exact invoke arg keys for all image service functions.
