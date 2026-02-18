# Image Paste Feature — Plan

**Work Name**: `image-paste`
**Date**: 2026-02-18
**Status**: Draft

## Goal

When a user pastes an image from the clipboard (Cmd+V) in the WYSIWYG editor, save the image to the document's directory and insert a markdown image reference.

## Non-Goals

- Drag-and-drop image support (separate feature)
- Image paste in CodeMirror/source mode (separate feature)
- Image resizing or editing UI
- Cloud image upload
- Image format conversion (paste as-is)

## Architecture Summary

The infrastructure largely exists already:

| Layer | Status | What Exists |
|-------|--------|-------------|
| Rust backend | **Done** | `upload_image`, `upload_images_batch` commands in `image.rs` |
| IPC service | **Done** | `imageService.ts` with `uploadImage()`, `fileToBase64()`, `generateUniqueFilename()` |
| Toast system | **Done** | `showToast()` in App.tsx with 3s auto-dismiss |
| Plugin system | **Done** | `createPlugin()` pattern with `$prose()` for Milkdown |
| Paste handler | **Missing** | Need Milkdown ProseMirror plugin with `handlePaste` |
| Placeholder UI | **Missing** | Need loading indicator during upload |

### Data Flow

```
User presses Cmd+V with image on clipboard
    ↓
ProseMirror handlePaste → check clipboardData for image files
    ↓
Validate: format (PNG/JPEG), size (< 5MB), document saved
    ↓
Insert placeholder node into editor
    ↓
Convert File → base64 via imageService.fileToBase64()
    ↓
Call imageService.uploadImage(documentPath, base64, filename)
    ↓
Rust: saves to ./assets/{filename}, returns { relativePath, markdownSyntax }
    ↓
Replace placeholder with actual image node using ProseMirror transaction
    ↓
MilkdownEditor's post-render hook resolves path to asset:// URL
    ↓
Image renders in WYSIWYG view
```

---

## Work Items

### WI-1: Create Image Paste Milkdown Plugin

**Goal**: Create a Milkdown plugin that intercepts paste events containing images and triggers the upload pipeline.

**Non-Goals**: No placeholder UI yet (WI-2), no multi-image (WI-3).

**Files to touch**:
- `src/plugins/milkdown/imagePastePlugin.ts` (NEW)
- `src/plugins/index.ts` (register plugin)

**Acceptance Criteria**:
1. Pasting a single PNG image in WYSIWYG mode inserts `![](assets/image-{timestamp}.png)` into the document
2. The image file is saved to `./assets/` relative to the document
3. Pasting text (non-image) is unaffected — default behavior preserved
4. Plugin is registered with `supportedModes: ["milkdown"]`

**Edge Cases**:
- Paste event with no image data → ignore, let default handle
- Paste event with image + text mixed → handle image, let text pass through
- Document is unsaved (`path === null`) → show toast "Save document before pasting images", reject paste
- File write fails (permission denied, disk full) → show toast with error message
- Clipboard contains non-PNG/JPEG (e.g., BMP, WEBP, GIF) → reject with toast "Unsupported format. Use PNG or JPEG"

**Tests**:
- Unit test: `imagePastePlugin.test.ts`
  - Test file type validation (PNG accepted, JPEG accepted, BMP rejected, GIF rejected)
  - Test file size validation (4MB accepted, 6MB rejected)
  - Test filename generation (contains timestamp, has correct extension)
  - Test unsaved document rejection (path === null)

**Rollback**: Remove plugin file, unregister from index.ts.

---

### WI-2: Add Upload Placeholder UI

**Goal**: Show a visual placeholder in the editor while the image is being saved to disk.

**Non-Goals**: No progress bar (upload is local, near-instant).

**Files to touch**:
- `src/plugins/milkdown/imagePastePlugin.ts` (modify)
- `src/styles/editor.css` (add placeholder styles)

**Acceptance Criteria**:
1. When paste starts, a placeholder element appears at cursor position
2. Placeholder shows "Uploading image..." text with a subtle animation
3. On success, placeholder is replaced with the actual image
4. On failure, placeholder is removed and toast shows error

**Edge Cases**:
- User types while placeholder is visible → placeholder stays at original position
- User undoes while placeholder is visible → placeholder removed cleanly
- Multiple rapid pastes → each gets its own placeholder (handled in WI-3)

**Tests**:
- Unit test: verify placeholder insertion creates correct ProseMirror decoration
- Unit test: verify placeholder removal on success/failure

**Rollback**: Revert to direct insertion (no placeholder), revert CSS.

---

### WI-3: Support Multiple Image Paste

**Goal**: Handle clipboard data containing multiple images (e.g., from screenshot tools or file managers).

**Non-Goals**: No drag-and-drop.

**Files to touch**:
- `src/plugins/milkdown/imagePastePlugin.ts` (modify)

**Acceptance Criteria**:
1. Pasting 3 images at once inserts 3 `![](assets/...)` references, each on its own line
2. All images are uploaded via `uploadImagesBatch()` for efficiency
3. Each image gets its own placeholder during upload
4. If one image fails (e.g., too large), others still succeed
5. Toast reports: "2 of 3 images pasted" or "All 3 images pasted"

**Edge Cases**:
- Mixed valid/invalid images (1 PNG + 1 BMP) → paste the PNG, reject the BMP with toast
- All images invalid → toast "No supported images found"
- Total size of all images > available disk space → partial success, report failures
- 10+ images pasted at once → process all, but warn if > 10

**Tests**:
- Unit test: multi-image validation (filter valid formats)
- Unit test: partial failure handling (some succeed, some fail)
- Unit test: batch upload result aggregation

**Rollback**: Revert to single-image-only (WI-1 behavior).

---

### WI-4: Add Size Limit Enforcement (5MB)

**Goal**: Reject images larger than 5MB with a clear error toast.

**Non-Goals**: No image compression or resizing.

**Files to touch**:
- `src/plugins/milkdown/imagePastePlugin.ts` (modify)

**Acceptance Criteria**:
1. Images ≤ 5MB are accepted
2. Images > 5MB show toast: "Image too large (X.X MB). Maximum size is 5 MB"
3. Size check happens BEFORE base64 conversion (to avoid unnecessary processing)
4. In multi-image paste, oversized images are skipped, valid ones proceed

**Edge Cases**:
- Exactly 5MB file → accepted (≤, not <)
- 5.01MB file → rejected
- Image with unknown size (clipboard doesn't report) → attempt upload, let Rust validate
- Very large image (100MB+) → reject early, don't freeze UI

**Tests**:
- Unit test: `validateImageSize(file)` with boundary values (4.99MB, 5MB, 5.01MB)
- Unit test: mock File object with specific sizes

**Rollback**: Remove size check (accept all sizes).

---

### WI-5: Integration & Logging

**Goal**: Wire everything together, add structured logging per CLAUDE.md conventions, ensure end-to-end flow works.

**Non-Goals**: No new UI beyond what WI-1–WI-4 add.

**Files to touch**:
- `src/plugins/milkdown/imagePastePlugin.ts` (add logging)
- `src/components/Editor/MilkdownEditor.tsx` (verify plugin loaded)

**Acceptance Criteria**:
1. Structured log events emitted for: `image.paste.start`, `image.paste.success`, `image.paste.fail`, `image.paste.reject` (format/size)
2. Logs include context: `{ filename, format, sizeBytes, documentPath }`
3. End-to-end manual test: paste PNG → saved to assets/ → visible in editor → log entry in `~/.mdpro/mdpro.log`
4. Plugin appears in plugin registry and can be toggled off

**Edge Cases**:
- Logging service unavailable → paste still works (logging is non-blocking)

**Tests**:
- Unit test: verify log events are emitted with correct event names and context
- Integration: verify plugin registration

**Rollback**: Remove logging calls (plugin still functions).

---

## Implementation Order

```
WI-1 (core plugin) → WI-4 (size limits) → WI-2 (placeholder) → WI-3 (multi-image) → WI-5 (logging)
```

WI-4 depends on WI-1 (validation layer sits in the same plugin).
WI-2 depends on WI-1 (placeholder replaces the direct insertion).
WI-3 depends on WI-1 + WI-2 (multi-image needs placeholder per image).
WI-5 depends on all (logging wraps the final implementation).

## Testing Strategy

| Level | Tool | What |
|-------|------|------|
| Unit tests | Vitest | Validation functions, plugin logic, size checks |
| Manual QA | pnpm tauri dev | Paste real images, verify file saves, check rendering |
| Rust tests | cargo test | Image command edge cases (already covered) |
