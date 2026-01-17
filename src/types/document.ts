export interface Document {
  /** Unique identifier */
  id: string;

  /** File path on disk (null for unsaved) */
  path: string | null;

  /** Raw markdown content */
  content: string;

  /** File encoding */
  encoding: string;

  /** Has unsaved changes */
  isModified: boolean;

  /** Last saved timestamp (Unix epoch ms) */
  lastSaved: number | null;

  /** File size in bytes */
  fileSize: number | null;
}

export interface DocumentMetadata {
  id: string;
  path: string | null;
  title: string;
  isModified: boolean;
}
