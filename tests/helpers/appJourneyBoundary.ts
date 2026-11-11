import { vi } from 'vitest';
import { FakeTauriBoundary, type BoundaryWrite } from '../support/corpus/fakeBoundary';
import { makePreferences } from '../support/preferenceFixtures';
import { defaultAppliedShortcuts } from '../../src/commands/appliedKeymap';

type Callback = (event: { payload: unknown }) => void;
export interface JourneyCall { command: string; args: Record<string, unknown> }
export interface FakeBehaviour { behaviour: string; rustProof: string; fixture?: string }

/** A fail-closed layer over MIG-001's unchanged file and draft boundary. */
export class AppJourneyBoundary {
  readonly corpus = new FakeTauriBoundary();
  readonly calls: JourneyCall[] = [];
  readonly events: Array<{ name: string; payload: unknown; windowScoped: boolean; targetLabel?: string }> = [];
  readonly logs: Array<Record<string, unknown>> = [];
  readonly replies: JourneyCall[] = [];
  readonly unmodelledCalls: JourneyCall[] = [];
  /** Declared fake outcomes tied to named Rust tests. */
  readonly fakeBehaviours: FakeBehaviour[] = [];
  readonly windowLabel = 'main';
  private readonly listeners = new Map<string, Set<Callback>>();
  private readonly windowListeners = new Map<string, Set<Callback>>();
  private readonly dialogAnswers = new Map<string, unknown[]>();
  private closeListener: ((event: { preventDefault: () => void }) => void | Promise<void>) | null = null;

  get writeLog(): readonly BoundaryWrite[] { return this.corpus.writeLog; }
  get liveListeners(): number {
    return [...this.listeners.values(), ...this.windowListeners.values()].reduce((n, group) => n + group.size, 0)
      + (this.closeListener ? 1 : 0);
  }
  get liveListenerNames(): string[] {
    return [...this.listeners.entries(), ...this.windowListeners.entries()].flatMap(([name, group]) =>
      [...group].map(() => name)).concat(this.closeListener ? ['close'] : []);
  }
  scriptDialog(kind: string, ...answers: unknown[]): void { this.dialogAnswers.set(kind, answers); }
  answerDialog(kind: string): unknown {
    const answers = this.dialogAnswers.get(kind);
    if (!answers?.length) throw new Error(`unmodelled dialog answer: ${kind}`);
    return answers.shift();
  }
  listen(name: string, callback: Callback, windowScoped = false): Promise<() => void> {
    const table = windowScoped ? this.windowListeners : this.listeners;
    const group = table.get(name) ?? new Set<Callback>();
    group.add(callback); table.set(name, group);
    return Promise.resolve(() => { group.delete(callback); if (!group.size) table.delete(name); });
  }
  emit(name: string, payload: unknown, windowScoped = false): void {
    this.events.push({ name, payload: structuredClone(payload), windowScoped });
    for (const callback of this.listeners.get(name) ?? []) callback({ payload });
    for (const callback of this.windowListeners.get(name) ?? []) callback({ payload });
  }
  /** Targeted delivery is confined to this fake window; Rust save notices use broadcast `emit`. */
  emitTo(targetLabel: string, name: string, payload: unknown): void {
    this.events.push({ name, payload: structuredClone(payload), windowScoped: true, targetLabel });
    if (targetLabel !== this.windowLabel) return;
    for (const callback of this.listeners.get(name) ?? []) callback({ payload });
    for (const callback of this.windowListeners.get(name) ?? []) callback({ payload });
  }
  onCloseRequested(callback: (event: { preventDefault: () => void }) => void | Promise<void>): Promise<() => void> {
    if (this.closeListener) throw new Error('duplicate close listener');
    this.closeListener = callback;
    return Promise.resolve(() => { if (this.closeListener === callback) this.closeListener = null; });
  }
  async requestClose(): Promise<{ prevented: boolean }> {
    if (!this.closeListener) throw new Error('close listener absent');
    let prevented = false;
    await this.closeListener({ preventDefault: () => { prevented = true; } });
    return { prevented };
  }
  async invoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const call = { command, args: structuredClone(args) };
    this.calls.push(call);
    switch (command) {
      case 'open_file': case 'save_file':
      case 'save_draft': case 'delete_draft': case 'release_watch_hold':
        return this.corpus.invoke(command, args);
      case 'save_file_dialog': {
        const path = this.answerDialog('save');
        if (path !== null && (typeof path !== 'string' || !path)) throw new Error('invalid save dialog path');
        if (path !== null && path !== args.originalPath && this.calls.some(call =>
          call.command === 'open_file' && call.args.path === path)) {
          throw { AlreadyOpen: { path } };
        }
        this.corpus.saveDialogPath = path;
        return this.corpus.invoke(command, args);
      }
      case 'open_file_dialog': {
        const path = this.answerDialog('open');
        if (path === null) return null;
        if (typeof path !== 'string' || !path) throw new Error('invalid open dialog path');
        return this.corpus.invoke('open_file', { path });
      }
      case 'get_preferences': return makePreferences();
      case 'get_logging_settings': return { enabled: true, level: 'info' };
      case 'get_launch_paths': case 'list_drafts': return [];
      case 'get_applied_shortcuts': return defaultAppliedShortcuts('macos');
      case 'cleanup_old_drafts': case 'save_window_state': case 'save_window_geometry':
        return null;
      case 'plugin:app|set_app_theme': case 'sync_recent_files_menu': case 'set_preferences': return null;
      case 'get_system_theme': return 'light';
      case 'get_app_version': return '0.0.0-test';
      case 'mcp_get_status': return { enabled: false, running: false };
      case 'mcp_get_installations': return [];
      case 'mcp_sync_documents': return null;
      case 'quit_guard_reply': this.replies.push(call); return null;
      case 'log_event': this.logs.push(args.payload as Record<string, unknown>); return null;
      default: this.unmodelledCalls.push(call); throw new Error(`unmodelled App IPC: ${command}`);
    }
  }
}

let active: AppJourneyBoundary;

export function installAppJourneyBoundary(boundary: AppJourneyBoundary): void {
  active = boundary;
  vi.doMock('@tauri-apps/api/core', async () => ({
    ...(await import('../support/tauriCoreMock')).createTauriCoreMock(),
    invoke: (command: string, args?: Record<string, unknown>) => active.invoke(command, args),
    isTauri: () => true,
  }));
  vi.doMock('@tauri-apps/api/event', () => ({
    listen: (name: string, callback: Callback) => active.listen(name, callback),
    emit: async (name: string, payload: unknown) => { active.emit(name, payload); },
  }));
  const window = () => ({
    label: 'main', setTitle: async () => {},
    listen: (name: string, callback: Callback) => active.listen(name, callback, true),
    onCloseRequested: (callback: (event: { preventDefault: () => void }) => void) => active.onCloseRequested(callback),
    onFocusChanged: (callback: Callback) => active.listen('tauri://focus', callback, true),
  });
  vi.doMock('@tauri-apps/api/window', () => ({ getCurrentWindow: window }));
  vi.doMock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: window }));
  vi.doMock('@tauri-apps/plugin-dialog', () => ({
    ask: async () => active.answerDialog('ask'),
    message: async () => active.answerDialog('message'),
    save: async () => active.answerDialog('save'),
    open: async () => active.answerDialog('open'),
  }));
  vi.doMock('@tauri-apps/plugin-updater', () => ({ check: async () => null }));
  vi.doMock('@tauri-apps/plugin-process', () => ({ relaunch: async () => {} }));
}
