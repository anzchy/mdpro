/** Validate engine-neutral expected observation DTOs; execution still compares them with actual production results. */
import { isObject, positiveIndex } from './metadataActions.ts';
import { guardDecisionValid } from './metadataGuard.ts';
import { OBSERVATION_KINDS } from './vocabulary.ts';
const count = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
function shape(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  return isObject(value) && required.every(key => key in value) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function observationValid(kind: string, value: unknown): boolean {
  switch (kind) {
    case 'toc': return Array.isArray(value) && value.every(item => shape(item, ['level', 'text', 'id']) && positiveIndex(item.level) && item.level <= 6 && typeof item.text === 'string' && typeof item.id === 'string');
    case 'largeDocGuard': return guardDecisionValid(value);
    case 'selection': return shape(value, ['text']) && typeof value.text === 'string';
    case 'renderedMath': return shape(value, ['count']) && count(value.count);
    case 'pasteSafety': return shape(value, ['forbiddenFound']) && strings(value.forbiddenFound);
    case 'imageSources': return Array.isArray(value) && value.every(item => shape(item, ['markdownSrc', 'resolvedKind']) && typeof item.markdownSrc === 'string' && ['asset', 'url', 'unresolved'].includes(String(item.resolvedKind)));
    case 'find': return shape(value, ['query', 'options', 'matches']) && typeof value.query === 'string' &&
      shape(value.options, ['caseSensitive', 'wholeWord']) && typeof value.options.caseSensitive === 'boolean' && typeof value.options.wholeWord === 'boolean' &&
      Array.isArray(value.matches) && value.matches.every(item => shape(item, ['text', 'occurrence', 'block']) && typeof item.text === 'string' && positiveIndex(item.occurrence) && positiveIndex(item.block));
    case 'linkActivation': {
      if (!shape(value, ['outcome', 'defaultPrevented', 'propagated', 'openerCalls'], ['reason']) || typeof value.defaultPrevented !== 'boolean' || typeof value.propagated !== 'boolean' || !strings(value.openerCalls)) return false;
      if (!['refused', 'external', 'same-app', 'no-href'].includes(String(value.outcome))) return false;
      return value.outcome === 'refused' ? value.reason === 'scheme' || value.reason === 'resolved-mismatch' : value.reason === undefined;
    }
    default: return false;
  }
}
export function observationsValid(value: unknown): boolean {
  return isObject(value) && Object.keys(value).length > 0 && Object.entries(value).every(([kind, observation]) =>
    (OBSERVATION_KINDS as readonly string[]).includes(kind) && observationValid(kind, observation));
}
