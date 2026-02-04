import { invoke } from "@tauri-apps/api/core";

/**
 * Represents an image in the document
 */
export interface ImageReference {
  /** Original path from Markdown syntax */
  originalPath: string;
  /** Resolved absolute path (for local images) */
  resolvedPath: string | null;
  /** Image alt text */
  altText: string;
  /** Image title (optional) */
  title?: string;
  /** Whether this is a remote URL */
  isRemote: boolean;
  /** Loading state */
  loadState: "loading" | "loaded" | "error";
  /** Error message if load failed */
  errorMessage?: string;
  /** Image dimensions (if known) */
  dimensions?: {
    width: number;
    height: number;
  };
}

/**
 * Image configuration settings
 */
export interface ImageConfig {
  /** Default folder for uploaded/pasted images */
  assetFolder: string;
  /** Whether to copy external images to asset folder */
  copyExternalImages: boolean;
  /** Whether to show preview before inserting pasted images */
  showPastePreview: boolean;
  /** Maximum image dimension (for auto-resize) */
  maxDimension?: number;
}

/**
 * Default image configuration
 */
export const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  assetFolder: "./assets",
  copyExternalImages: true,
  showPastePreview: true,
  maxDimension: undefined,
};

/**
 * Result from resolve_image_path command
 */
export interface ResolveImagePathResult {
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

/**
 * Result from upload_image command
 */
export interface UploadImageResult {
  /** Relative path to inserted image */
  relativePath: string;
  /** Absolute path where image was saved */
  absolutePath: string;
  /** Generated Markdown syntax */
  markdownSyntax: string;
  /** File size in bytes */
  fileSize: number;
}

/**
 * Item for batch upload
 */
export interface ImageUploadItem {
  /** Base64-encoded image data */
  data: string;
  /** Desired filename */
  filename: string;
  /** Alt text for Markdown */
  altText?: string;
}

/**
 * Result from upload_images_batch command
 */
export interface UploadImagesBatchResult {
  /** Results for each image */
  results: (UploadImageResult | { error: string })[];
  /** Number of successful uploads */
  successCount: number;
  /** Number of failed uploads */
  failureCount: number;
}

/**
 * Result from copy_external_image command
 */
export interface CopyExternalImageResult {
  /** Relative path in asset folder */
  relativePath: string;
  /** Absolute path where copied */
  absolutePath: string;
  /** Generated Markdown syntax */
  markdownSyntax: string;
}

/**
 * Resolve a relative or absolute image path to an absolute path
 */
export async function resolveImagePath(
  documentPath: string,
  imagePath: string
): Promise<ResolveImagePathResult> {
  return invoke<ResolveImagePathResult>("resolve_image_path", {
    document_path: documentPath,
    image_path: imagePath,
  });
}

/**
 * Upload an image file to the asset folder
 */
export async function uploadImage(
  documentPath: string,
  imageData: string,
  filename: string,
  assetFolder?: string
): Promise<UploadImageResult> {
  return invoke<UploadImageResult>("upload_image", {
    document_path: documentPath,
    image_data: imageData,
    filename,
    asset_folder: assetFolder,
  });
}

/**
 * Upload multiple images at once
 */
export async function uploadImagesBatch(
  documentPath: string,
  images: ImageUploadItem[],
  assetFolder?: string
): Promise<UploadImagesBatchResult> {
  return invoke<UploadImagesBatchResult>("upload_images_batch", {
    document_path: documentPath,
    images,
    asset_folder: assetFolder,
  });
}

/**
 * Copy an external image to the asset folder
 */
export async function copyExternalImage(
  documentPath: string,
  sourcePath: string,
  assetFolder?: string
): Promise<CopyExternalImageResult> {
  return invoke<CopyExternalImageResult>("copy_external_image", {
    document_path: documentPath,
    source_path: sourcePath,
    asset_folder: assetFolder,
  });
}

/**
 * Get the user's image configuration
 */
export async function getImageConfig(): Promise<ImageConfig> {
  return invoke<ImageConfig>("get_image_config");
}

/**
 * Update the user's image configuration
 */
export async function setImageConfig(
  config: ImageConfig
): Promise<{ success: boolean }> {
  return invoke<{ success: boolean }>("set_image_config", { config });
}

/**
 * Convert a File to base64 string
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/png;base64,")
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Generate a unique filename based on timestamp
 */
export function generateUniqueFilename(originalName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ext = originalName.split(".").pop() || "png";
  return `image-${timestamp}-${random}.${ext}`;
}

/**
 * Check if a path is a remote URL
 */
export function isRemoteUrl(path: string): boolean {
  return path.startsWith("http://") || path.startsWith("https://");
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
