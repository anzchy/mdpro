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
}

export interface SaveResult {
  success: boolean;
  path: string;
  savedAt: number;
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

  async saveFile(
    documentId: string,
    content: string,
    path?: string,
    actionId?: string,
  ): Promise<SaveResult> {
    return invoke("save_file", { documentId, content, path, actionId });
  },

  async saveFileDialog(
    documentId: string,
    content: string,
    suggestedName?: string,
    actionId?: string,
  ): Promise<SaveResult | null> {
    return invoke("save_file_dialog", { documentId, content, suggestedName, actionId });
  },

  async closeDocument(documentId: string, discardChanges: boolean): Promise<CloseResult> {
    return invoke("close_document", { documentId, discardChanges });
  },

  async checkFileModified(path: string): Promise<FileModifiedResult> {
    return invoke("check_file_modified", { path });
  },

  async reloadFile(path: string): Promise<Document> {
    return invoke("reload_file", { path });
  },
};
