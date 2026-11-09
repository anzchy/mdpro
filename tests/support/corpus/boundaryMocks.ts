/** Install only process-boundary doubles, before dynamically importing the real editor and stores. */
import { vi } from 'vitest';
import type { BoundaryEvent, FakeTauriBoundary } from './fakeBoundary.ts';
let active: FakeTauriBoundary;
const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();
export function installCorpusBoundary(boundary: FakeTauriBoundary): void {
  active = boundary; listeners.clear();
  vi.doMock('@tauri-apps/api/core', () => ({
    invoke: (command: string, args?: Record<string, unknown>) => active.invoke(command, args),
    isTauri: () => true,
    convertFileSrc: (path: string) => active.convertFileSrc(path),
  }));
  vi.doMock('@tauri-apps/api/event', () => ({
    listen: async (name: string, callback: (event: { payload: unknown }) => void) => {
      const group = listeners.get(name) ?? new Set(); group.add(callback); listeners.set(name, group);
      return () => { group.delete(callback); if (!group.size) listeners.delete(name); };
    },
    emit: async (name: string, payload: unknown) => {
      for (const callback of listeners.get(name) ?? []) callback({ payload });
    },
  }));
  vi.doMock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main' }) }));
  vi.doMock('@tauri-apps/plugin-opener', () => ({ openUrl: (href: string) => active.openUrl(href) }));
  vi.doMock('../../../src/services/loggingService', () => ({ loggingService: {
    generateActionId: () => 'corpus-action',
    logEventSync: (event: BoundaryEvent) => { active.events.push(structuredClone(event)); },
    logEvent: async (event: BoundaryEvent) => { active.events.push(structuredClone(event)); },
  } }));
}
