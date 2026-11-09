/** Plain-text reference normalizations from MIG-001 r5; independent from every editor parser. */
import type { NormalizationId } from './types.ts';
import { mapContainerText, shieldInline } from './normalizationText.ts';
import { normalizeTables } from './normalizationTables.ts';
export { htmlText } from './normalizationHtml.ts';
export function normalize(id: NormalizationId, text: string): string {
  if (id === 'N6') return text; // An absent marker is a node attribute, never syntactic Markdown.
  if (id === 'N4') return text.endsWith('\n') ? text : text + '\n';
  if (id === 'N7' || id === 'N8') return mapContainerText(text, value => normalizeTables(value, id === 'N8'));
  const transform = (input: string) => shieldInline(input, value => {
    switch (id) {
      case 'N1': return value.replace(/ {2,}\n/g, '\\\n');
      case 'N2': return value.replace(/\n(?:[ \t]*\n)+(?=[^\n])/g, run => '\n'.repeat(2 * Math.floor((run.match(/\n/g)?.length ?? 0) / 2)));
      case 'N3': return value.replace(/^(?:[ \t]*\n)+/, '').replace(/\n(?:[ \t]*\n)+$/, '\n');
      case 'N5': return value.replace(/^[ \t]*<br\s*\/?\s*>[ \t]*(?=\n|$)/gim, '');
      default: { const exhaustive: never = id; throw new Error(`Unknown normalization ${exhaustive}`); }
    }
  });
  return mapContainerText(text, transform);
}
export function applyNormalizations(text: string, ids: readonly NormalizationId[]): string {
  return ids.reduce((value, id) => normalize(id, value), text);
}
