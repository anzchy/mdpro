# IPC Contracts: Image Commands

**Feature**: Image Rendering and Upload (FR-018 to FR-022)
**Module**: `src-tauri/src/commands/image.rs` (NEW)

## Commands

### `resolve_image_path`

Resolves a relative or absolute image path to an absolute path, based on the document's location.

**Direction**: Frontend → Backend

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `document_path` | `string` | Yes | Path to the current document |
| `image_path` | `string` | Yes | Image path from Markdown (relative or absolute) |

**Returns**:

```typescript
interface ResolveImagePathResult {
  /** Resolved absolute path */
  absolutePath: string;
  /** Whether the file exists */
  exists: boolean;
  /** Whether the path is remote (URL) */
  isRemote: boolean;
  /** File size in bytes (if local and exists) */
  fileSize?: number;
  /** MIME type (if detectable) */
  mimeType?: string;
}
```

**Errors**:

| Code | Description |
|------|-------------|
| `INVALID_PATH` | Path format is invalid |
| `DOCUMENT_NOT_SAVED` | Document has no path (not yet saved) |

**Rust Signature**:

```rust
#[tauri::command]
pub async fn resolve_image_path(
    document_path: String,
    image_path: String,
) -> Result<ResolveImagePathResult, CommandError>
```

**Usage Example**:

```typescript
// src/services/imageService.ts
import { invoke } from '@tauri-apps/api/core';

export async function resolveImagePath(
  documentPath: string,
  imagePath: string
): Promise<ResolveImagePathResult> {
  return invoke<ResolveImagePathResult>('resolve_image_path', {
    document_path: documentPath,
    image_path: imagePath,
  });
}
```

---

### `upload_image`

Saves an image file to the asset folder and returns the Markdown reference.

**Direction**: Frontend → Backend

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `document_path` | `string` | Yes | Path to the current document |
| `image_data` | `string` | Yes | Base64-encoded image data |
| `filename` | `string` | Yes | Desired filename (with extension) |
| `asset_folder` | `string` | No | Custom asset folder (default from config) |

**Returns**:

```typescript
interface UploadImageResult {
  /** Relative path to inserted image */
  relativePath: string;
  /** Absolute path where image was saved */
  absolutePath: string;
  /** Generated Markdown syntax */
  markdownSyntax: string;
  /** File size in bytes */
  fileSize: number;
}
```

**Errors**:

| Code | Description |
|------|-------------|
| `INVALID_IMAGE_DATA` | Base64 data is not valid image |
| `DOCUMENT_NOT_SAVED` | Document has no path (need save first) |
| `PERMISSION_DENIED` | Cannot write to asset folder |
| `DISK_FULL` | Insufficient disk space |
| `UNSUPPORTED_FORMAT` | Image format not supported |

**Rust Signature**:

```rust
#[tauri::command]
pub async fn upload_image(
    document_path: String,
    image_data: String, // Base64
    filename: String,
    asset_folder: Option<String>,
    state: State<'_, AppState>,
) -> Result<UploadImageResult, CommandError>
```

---

### `upload_images_batch`

Uploads multiple images at once (for drag-drop/paste of multiple files).

**Direction**: Frontend → Backend

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `document_path` | `string` | Yes | Path to the current document |
| `images` | `ImageUploadItem[]` | Yes | Array of images to upload |
| `asset_folder` | `string` | No | Custom asset folder |

```typescript
interface ImageUploadItem {
  /** Base64-encoded image data */
  data: string;
  /** Desired filename */
  filename: string;
  /** Alt text for Markdown */
  altText?: string;
}
```

**Returns**:

```typescript
interface UploadImagesBatchResult {
  /** Results for each image */
  results: (UploadImageResult | { error: string })[];
  /** Number of successful uploads */
  successCount: number;
  /** Number of failed uploads */
  failureCount: number;
}
```

---

### `copy_external_image`

Copies an external image (from outside project) to the asset folder.

**Direction**: Frontend → Backend

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `document_path` | `string` | Yes | Path to the current document |
| `source_path` | `string` | Yes | Absolute path to external image |
| `asset_folder` | `string` | No | Custom asset folder |

**Returns**:

```typescript
interface CopyExternalImageResult {
  /** Relative path in asset folder */
  relativePath: string;
  /** Absolute path where copied */
  absolutePath: string;
  /** Generated Markdown syntax */
  markdownSyntax: string;
}
```

**Errors**:

| Code | Description |
|------|-------------|
| `SOURCE_NOT_FOUND` | Source image does not exist |
| `ALREADY_IN_PROJECT` | Image is already in project folder |

---

### `get_image_config`

Retrieves the user's image configuration.

**Direction**: Frontend → Backend

**Parameters**: None

**Returns**:

```typescript
interface ImageConfig {
  /** Default folder for uploaded images */
  assetFolder: string;
  /** Whether to copy external images */
  copyExternalImages: boolean;
  /** Whether to show preview before paste */
  showPastePreview: boolean;
  /** Maximum dimension for auto-resize */
  maxDimension?: number;
}
```

---

### `set_image_config`

Updates the user's image configuration.

**Direction**: Frontend → Backend

**Parameters**:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `config` | `ImageConfig` | Yes | New image configuration |

**Returns**:

```typescript
interface SetImageConfigResult {
  success: boolean;
}
```

---

## Events

### `image:drop`

Emitted when images are dropped onto the editor.

**Direction**: Frontend internal

**Payload**:

```typescript
interface ImageDropEvent {
  files: File[];
  position: { x: number; y: number };
  cursorPosition: number; // Document offset
}
```

---

### `image:paste`

Emitted when image is pasted from clipboard.

**Direction**: Frontend internal

**Payload**:

```typescript
interface ImagePasteEvent {
  items: ClipboardItem[];
  cursorPosition: number;
}
```

---

## Frontend Implementation

### useImageUpload Hook

```typescript
// src/hooks/useImageUpload.ts

interface UseImageUploadOptions {
  documentPath: string | null;
  onInsert: (markdown: string, position?: number) => void;
  onError: (error: Error) => void;
}

export function useImageUpload(options: UseImageUploadOptions) {
  const config = useImageConfig();

  const uploadImage = useCallback(async (
    file: File,
    position?: number
  ): Promise<void> => {
    if (!options.documentPath) {
      options.onError(new Error('Save document before adding images'));
      return;
    }

    // Convert file to base64
    const base64 = await fileToBase64(file);

    // Generate unique filename
    const filename = generateUniqueFilename(file.name);

    // Upload via IPC
    const result = await invoke<UploadImageResult>('upload_image', {
      document_path: options.documentPath,
      image_data: base64,
      filename,
    });

    // Insert markdown at position
    options.onInsert(result.markdownSyntax, position);
  }, [options.documentPath, options.onInsert, options.onError]);

  const handleDrop = useCallback(async (event: DragEvent) => {
    event.preventDefault();

    const files = Array.from(event.dataTransfer?.files ?? [])
      .filter(f => f.type.startsWith('image/'));

    if (files.length === 0) return;

    // Get cursor position from drop coordinates
    const position = getCursorPositionFromCoords(event.clientX, event.clientY);

    for (const file of files) {
      await uploadImage(file, position);
    }
  }, [uploadImage]);

  const handlePaste = useCallback(async (event: ClipboardEvent) => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItems = items.filter(item => item.type.startsWith('image/'));

    if (imageItems.length === 0) return;

    event.preventDefault();

    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;

      if (config.showPastePreview) {
        // Show preview dialog
        const confirmed = await showImagePreviewDialog(file);
        if (!confirmed) continue;
      }

      await uploadImage(file);
    }
  }, [uploadImage, config.showPastePreview]);

  return { handleDrop, handlePaste, uploadImage };
}
```

### Image Preview Dialog

```typescript
// src/components/ImagePreviewDialog.tsx

interface ImagePreviewDialogProps {
  file: File;
  onConfirm: () => void;
  onCancel: () => void;
}

function ImagePreviewDialog({ file, onConfirm, onCancel }: Props) {
  const [preview, setPreview] = useState<string>('');

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <Dialog open onOpenChange={() => onCancel()}>
      <DialogContent>
        <DialogTitle>Insert Image</DialogTitle>
        <div className="image-preview">
          <img src={preview} alt="Preview" />
        </div>
        <div className="image-info">
          <p>Filename: {file.name}</p>
          <p>Size: {formatBytes(file.size)}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm}>Insert</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Image Rendering

### Error Placeholder Component

```tsx
// src/components/Editor/ImageErrorPlaceholder.tsx

interface ImageErrorPlaceholderProps {
  altText: string;
  path: string;
  error: string;
}

function ImageErrorPlaceholder({ altText, path, error }: Props) {
  return (
    <div className="image-error-placeholder">
      <BrokenImageIcon className="error-icon" />
      <div className="error-info">
        <span className="alt-text">{altText || 'Image'}</span>
        <span className="path">{path}</span>
        <span className="error-message">{error}</span>
      </div>
    </div>
  );
}
```

### CSS Styles

```css
.image-error-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--error-bg);
  border: 1px dashed var(--error-border);
  border-radius: 4px;
}

.image-error-placeholder .error-icon {
  width: 24px;
  height: 24px;
  color: var(--error-color);
}

.image-error-placeholder .path {
  font-family: monospace;
  font-size: 12px;
  color: var(--text-muted);
}
```

---

## Backend Implementation

### Path Resolution (Rust)

```rust
// src-tauri/src/commands/image.rs

use std::path::{Path, PathBuf};
use url::Url;

pub fn resolve_image_path(
    document_path: &str,
    image_path: &str,
) -> Result<ResolveImagePathResult, Error> {
    // Check if remote URL
    if image_path.starts_with("http://") || image_path.starts_with("https://") {
        return Ok(ResolveImagePathResult {
            absolute_path: image_path.to_string(),
            exists: true, // Assume remote exists
            is_remote: true,
            file_size: None,
            mime_type: None,
        });
    }

    // Get document directory
    let doc_dir = Path::new(document_path)
        .parent()
        .ok_or(Error::InvalidPath)?;

    // Resolve relative path
    let absolute_path = if Path::new(image_path).is_absolute() {
        PathBuf::from(image_path)
    } else {
        doc_dir.join(image_path).canonicalize()?
    };

    // Check if exists
    let exists = absolute_path.exists();
    let (file_size, mime_type) = if exists {
        let metadata = std::fs::metadata(&absolute_path)?;
        let mime = mime_guess::from_path(&absolute_path)
            .first()
            .map(|m| m.to_string());
        (Some(metadata.len()), mime)
    } else {
        (None, None)
    };

    Ok(ResolveImagePathResult {
        absolute_path: absolute_path.to_string_lossy().to_string(),
        exists,
        is_remote: false,
        file_size,
        mime_type,
    })
}
```

### Image Upload (Rust)

```rust
pub async fn upload_image(
    document_path: String,
    image_data: String, // Base64
    filename: String,
    asset_folder: Option<String>,
    state: State<'_, AppState>,
) -> Result<UploadImageResult, Error> {
    // Decode base64
    let bytes = base64::decode(&image_data)?;

    // Validate image
    let format = image::guess_format(&bytes)?;

    // Get document directory
    let doc_dir = Path::new(&document_path).parent().ok_or(Error::InvalidPath)?;

    // Get asset folder
    let config = state.preferences.lock().await;
    let asset_dir = asset_folder
        .unwrap_or_else(|| config.image.asset_folder.clone());
    let target_dir = doc_dir.join(&asset_dir);

    // Create directory if needed
    std::fs::create_dir_all(&target_dir)?;

    // Write file
    let target_path = target_dir.join(&filename);
    std::fs::write(&target_path, &bytes)?;

    // Generate relative path
    let relative_path = format!("{}/{}", asset_dir, filename);

    Ok(UploadImageResult {
        relative_path: relative_path.clone(),
        absolute_path: target_path.to_string_lossy().to_string(),
        markdown_syntax: format!("![]({})", relative_path),
        file_size: bytes.len() as u64,
    })
}
```
