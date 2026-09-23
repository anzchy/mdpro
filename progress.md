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

---

## 2026-03-22 — Cross-Platform Line Ending (CRLF vs LF)

### Symptom

After pulling commits from the Mac device onto the WSL device, `git status` showed 46 modified files. `git diff --stat HEAD` showed identical insertion/deletion counts (19,837 each) — a strong signal that content is unchanged but every line differs.

### Root Cause

The Mac commits used **LF** line endings. The WSL device had files with **CRLF** line endings (Windows default). Git saw every line as "modified" because `\n` ≠ `\r\n`.

`git pull` updates the index but **never overwrites unstaged local changes** — so the CRLF local files persisted after the pull, appearing as modifications against the LF-committed versions.

### Diagnosis Commands

```bash
git diff --stat HEAD          # Same insertions = deletions → line ending issue
file src/App.tsx              # "CRLF line terminators" confirms it
xxd src/App.tsx | grep "0d 0a"  # Hex: 0d = CR, 0a = LF
```

### Fix (one-time recovery)

```bash
git checkout -- .   # Restore all tracked files to committed LF versions
```

### Permanent Fix

Added `.gitattributes` to enforce LF on all text files for all platforms:

```gitattributes
* text=auto eol=lf
*.png binary
*.dmg binary
# ... other binaries
```

Re-normalize all existing files:

```bash
git add --renormalize .
git commit -m "chore: add .gitattributes to enforce LF line endings"
```

### Lesson

**When developing across Mac + WSL/Windows:**
1. Always add `.gitattributes` with `* text=auto eol=lf` at project start.
2. Never rely on per-developer `core.autocrlf` settings — they're invisible and easy to forget.
3. When you see mass "modified" files after a pull with equal insertions/deletions, suspect line endings first.
4. `git checkout -- .` is safe when you know the committed version is correct.

---

## A commit cannot record its own SHA (2026-09-23, D16 WI-4)

**Symptom.** The D16 sequencing row briefly recorded `ac99c4a` for WI-4 while
the branch actually held a different commit. Worse, `git log ac99c4a` still
*resolved* — to the orphaned pre-amend commit — so the reference looked valid
and pointed at a commit nobody had.

**Root cause.** CLAUDE.md requires a work item's status row to be updated *in
the same commit that finishes it*, and the row convention carries commit SHAs.
Those two rules collide for a self-record: the SHA is only known after the
commit exists, and amending the commit to insert it changes the SHA again.
Commit → read SHA → `sed` → `--amend` feels like it closes the loop, but it
writes the *previous* hash every time.

**Rule.** A row may cite a SHA only for a commit that already exists — i.e. a
*late* record such as WI-5 / WI-8. When a row records the commit it is part of,
reference it as `本行所在提交` and let `git log` supply the hash. Never run the
commit-then-amend-the-SHA dance; it cannot converge.

**Check.** Before committing a row edit, resolve every SHA in it and confirm the
commit is an ancestor of `HEAD` (`git merge-base --is-ancestor <sha> HEAD`).
Plain `git log <sha>` is not enough — it happily resolves orphans.
