/** Content-level observations call production functions and expose only the closed corpus DTOs. */
import { decideLargeDocumentGuard } from '../../../src/utils/largeDocumentGuard';
import type { ObservationMap, ViewMode } from './types.ts';
export async function observeContent<K extends 'toc' | 'largeDocGuard'>(kind: K, serialized: string, viewMode: ViewMode): Promise<ObservationMap[K]> {
  if (kind === 'largeDocGuard') return decideLargeDocumentGuard({ content: serialized, viewMode }) as ObservationMap[K];
  // tocService imports Tauri through exportService. The driver boundary must be installed before this import.
  const { parseHeadingsFromContent } = await import('../../../src/services/tocService');
  return parseHeadingsFromContent(serialized).map(({ level, text, id }) => ({ level, text, id })) as ObservationMap[K];
}
