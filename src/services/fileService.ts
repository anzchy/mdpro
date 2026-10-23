import { invoke } from "@tauri-apps/api/core";
import type { Document } from "../types/document";
import { noteHold } from "../utils/watchHoldLedger";

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
  /** D173: the gen of the watch hold this open confirmed for this window; 0 = none. */
  holdGen?: number;
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
  /** D173: Save As only. The gen of the watch hold on `path` for this window; 0 = none. */
  holdGen?: number;
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

/**
 * D173: every acquisition reply's `holdGen` goes into this window's ledger as soon as it
 * arrives, whether or not the caller then commits a document, so the window can later
 * release that hold with the latest gen (`utils/watchHolds.ts`).
 */
export const fileService = {
  async openFile(path: string, encoding?: string, actionId?: string): Promise<OpenFileResult> {
    const result = await invoke<OpenFileResult>("open_file", { path, encoding, actionId });
    noteHold(path, result?.holdGen); // Rust holds the string it was sent
    return result;
  },

  async openFileDialog(actionId?: string): Promise<OpenFileResult | null> {
    const result = await invoke<OpenFileResult | null>("open_file_dialog", { actionId });
    noteHold(result?.document?.path, result?.holdGen);
    return result;
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
    originalPath?: string | null;
  }): Promise<SaveResult | null> {
    const { documentId, content, suggestedName, encoding, lineEnding, actionId, refusePath, originalPath } = options;
    const result = await invoke<SaveResult | null>("save_file_dialog", {
      documentId,
      content,
      suggestedName,
      encoding,
      lineEnding,
      actionId,
      refusePath: refusePath ?? null,
      originalPath: originalPath ?? null,
    }).catch((error: unknown) => {
      if (error && typeof error === "object" && "ExternalChangeConflict" in error) {
        throw new Error("external change at the selected file; your edits were not saved");
      }
      if (error && typeof error === "object" && "AlreadyOpen" in error) {
        throw new Error("the selected file is already open in mdpro; your edits were not saved");
      }
      throw error;
    });
    noteHold(result?.path, result?.holdGen);
    return result;
  },

  /** D173: no path; closing a document no longer unwatches (see `releaseWatchHold`). */
  async closeDocument(documentId: string, discardChanges: boolean): Promise<CloseResult> {
    return invoke("close_document", { documentId, discardChanges });
  },

  /**
   * D173: give up this window's watch hold on `path` at `gen` (the latest `holdGen` seen).
   * Resolves to Rust's outcome (`stale` / `keptRaw` / `unclaimedRaw` / `backendReleased`
   * / `notHeld`); rejects on an invalid request.
   */
  async releaseWatchHold(path: string, gen: number): Promise<string> {
    return invoke("release_watch_hold", { path, gen });
  },

  async checkFileModified(path: string): Promise<FileModifiedResult> {
    return invoke("check_file_modified", { path });
  },

  async reloadFile(path: string): Promise<Document> {
    return invoke("reload_file", { path });
  },
};
