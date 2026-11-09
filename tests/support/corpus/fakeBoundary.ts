/** Reusable process-boundary model. UTF-8 bytes describe frontend IPC content, not Rust encoding conversion. */
export interface BoundaryWrite {
  command: 'save_file' | 'save_file_dialog' | 'save_draft' | 'delete_draft'; documentId: string; path?: string; content: string; bytes: number[];
}
export interface BoundaryEvent { event: string; context?: Record<string, unknown>; [key: string]: unknown }
export class FakeTauriBoundary {
  readonly files = new Map<string, string>();
  readonly drafts = new Map<string, string>();
  readonly writeLog: BoundaryWrite[] = [];
  readonly openerCalls: string[] = [];
  readonly events: BoundaryEvent[] = [];
  readonly unresolvedAssets = new Set<string>();
  saveDialogPath: string | null = '/corpus/saved.md';
  private saveOrder = 0;
  private readonly documentIds = new Map<string, string>();
  seed(path: string, content: string): void { this.files.set(path, content); }
  reset(): void {
    this.files.clear(); this.drafts.clear(); this.unresolvedAssets.clear(); this.documentIds.clear();
    this.writeLog.length = 0; this.openerCalls.length = 0; this.events.length = 0; this.saveOrder = 0;
    this.saveDialogPath = '/corpus/saved.md';
  }
  async invoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const string = (key: string): string => {
      const value = args[key];
      if (typeof value !== 'string' || (key !== 'content' && !value)) throw new Error(`${command}: invalid ${key}`);
      return value;
    };
    const write = (kind: BoundaryWrite['command'], documentId: string, content: string, path?: string) => {
      this.writeLog.push({ command: kind, documentId, ...(path === undefined ? {} : { path }), content,
        bytes: [...new TextEncoder().encode(content)] });
    };
    switch (command) {
      case 'open_file': {
        const path = string('path'), content = this.files.get(path);
        if (content === undefined) throw new Error(`open_file: missing ${path}`);
        const id = this.documentIds.get(path) ?? `corpus-document${this.documentIds.size ? `-${this.documentIds.size + 1}` : ''}`;
        this.documentIds.set(path, id);
        return { document: { id, path, content, encoding: 'UTF-8', lineEnding: 'lf',
          isModified: false, lastSaved: null, fileSize: new TextEncoder().encode(content).length },
          recoveredDraft: null, changedSinceRead: false, holdGen: 0 };
      }
      case 'save_file': case 'save_file_dialog': {
        const documentId = string('documentId'), content = string('content');
        const path = command === 'save_file_dialog' ? this.saveDialogPath : string('path');
        if (path === null) return null;
        this.files.set(path, content); write(command, documentId, content, path);
        return { success: true, path, savedAt: Date.now() };
      }
      case 'save_draft': {
        const documentId = string('documentId'), content = string('content');
        this.drafts.set(documentId, content); write(command, documentId, content); this.saveOrder++;
        return { revision: String(this.saveOrder), saveOrder: this.saveOrder };
      }
      case 'delete_draft': {
        const documentId = string('documentId'), content = this.drafts.get(documentId) ?? '';
        this.drafts.delete(documentId); write(command, documentId, content); return null;
      }
      case 'get_preferences': return { markdown: { autoReformatTablesOnSave: false } };
      case 'release_watch_hold': return 'notHeld';
      default: throw new Error(`unhandled corpus IPC: ${command}`);
    }
  }
  async openUrl(href: string): Promise<void> { this.openerCalls.push(href); }
  convertFileSrc(path: string): string {
    if (this.unresolvedAssets.has(path)) throw new Error(`unresolved asset: ${path}`);
    return `asset://localhost/${encodeURIComponent(path)}`;
  }
}
