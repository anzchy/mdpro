export interface Document {
  /** Unique identifier */
  id: string;

  /** File path on disk (null for unsaved) */
  path: string | null;

  /** Raw markdown content */
  content: string;

  /** File encoding */
  encoding: string;

  /** Original on-disk line-ending style ("lf" | "crlf" | "cr") */
  lineEnding: string;

  /** Has unsaved changes */
  isModified: boolean;

  /**
   * D214: the text last known to match disk (the baseline). With a baseline,
   * `isModified === (content !== savedContent)`, so undoing back to it reads clean.
   * `undefined` = no baseline (sticky dirty: a recovered draft, an MCP-created
   * document with content, a failed save): every write reads dirty until the next
   * clean point. Frontend-only; never sent to Rust.
   */
  savedContent?: string;

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
