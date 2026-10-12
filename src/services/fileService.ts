import { invoke } from "@tauri-apps/api/core";
import type { Document } from "../types/document";

export interface Draft {
  id: string;
  originalPath: string | null;
  content: string;
  lastModified: number;
  recovered: boolean;
}

export interface OpenFileResult {
  document: Document;
  recoveredDraft: Draft | null;
  /**
   * D111: the file changed between the open's read and the watch registration, or the
   * check failed open; the document may not hold what is on disk (ADR-0081).
   */
  changedSinceRead: boolean;
}

export interface SaveResult {
  success: boolean;
  path: string;
  savedAt: number;
  /**
   * D111: Save As only. The target changed between the write and the watch registration,
   * or the check failed open. Rust always sends it (optional so pre-D111 fixtures stay valid).
   */
  changedSinceRead?: boolean;
  /**
   * D111-WI-1: Save As only. The dialog picked `refusePath` (the document's own file,
   * sent while it has a pending external change): nothing was written, `success` is false.
   */
  blockedByPendingChange?: boolean;
}

export interface CloseResult {
  success: boolean;
  draftDeleted: boolean;
}

export interface FileModifiedResult {
  modified: boolean;
  lastModified: number;
  currentMtime: number;
}

export const fileService = {
  async openFile(path: string, encoding?: string, actionId?: string): Promise<OpenFileResult> {
    return invoke("open_file", { path, encoding, actionId });
  },

  async openFileDialog(actionId?: string): Promise<OpenFileResult | null> {
    return invoke("open_file_dialog", { actionId });
  },

  async createDocument(): Promise<Document> {
    return invoke("create_document", {});
  },

  /**
   * Save `content` to disk.
   *
   * Takes an options object rather than positional args: the previous
   * signature put `encoding` before `actionId`, so adding a new field
   * (`lineEnding`) between them would silently shift every caller's args by
   * one (a wrong-arg footgun). Named fields make a misplaced value a type
   * error instead. `encoding` preserves the original file encoding (WI-0.3)
   * and `lineEnding` restores the original CRLF/CR/LF style (Fix 2).
   */
  async saveFile(options: {
    documentId: string;
    content: string;
    path?: string;
    encoding?: string;
    lineEnding?: string;
    actionId?: string;
  }): Promise<SaveResult> {
    const { documentId, content, path, encoding, lineEnding, actionId } = options;
    return invoke("save_file", { documentId, content, path, encoding, lineEnding, actionId });
  },

  async saveFileDialog(options: {
    documentId: string;
    content: string;
    suggestedName?: string;
    encoding?: string;
    lineEnding?: string;
    actionId?: string;
    /** D111-WI-1: the document's own path while it has a pending external change. */
    refusePath?: string | null;
  }): Promise<SaveResult | null> {
    const { documentId, content, suggestedName, encoding, lineEnding, actionId, refusePath } = options;
    return invoke("save_file_dialog", {
      documentId,
      content,
      suggestedName,
      encoding,
      lineEnding,
      actionId,
      refusePath: refusePath ?? null,
    });
  },

  async closeDocument(documentId: string, discardChanges: boolean, path?: string | null): Promise<CloseResult> {
    return invoke("close_document", { documentId, discardChanges, path: path ?? null });
  },

  async checkFileModified(path: string): Promise<FileModifiedResult> {
    return invoke("check_file_modified", { path });
  },

  async reloadFile(path: string): Promise<Document> {
    return invoke("reload_file", { path });
  },
};
