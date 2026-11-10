/** Guard-only metadata is independent from editor fidelity and verifies the committed recipe checksum. */
import { isObject } from './metadataActions.ts';
import { sha256Hex } from './sha256.ts';
export function guardDecisionValid(value: unknown): boolean {
  if (!isObject(value)) return false;
  const exact = (keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => key in value);
  const count = (key: string) => typeof value[key] === 'number' && Number.isInteger(value[key]) && value[key] >= 0;
  switch (value.action) {
    case 'allow': return exact(['action']);
    case 'degrade-to-source': return exact(['action', 'message', 'elements', 'longestLine', 'trigger']) &&
      typeof value.message === 'string' && value.message.length > 0 && count('elements') && count('longestLine') &&
      ['structure', 'line-length', 'both'].includes(String(value.trigger));
    case 'withhold-table-extensions': return exact(['action', 'message', 'tableRows']) &&
      typeof value.message === 'string' && value.message.length > 0 && count('tableRows');
    default: return false;
  }
}
export function guardRecordErrors(r: Record<string, unknown>, files: Readonly<Record<string, string>>): string[] {
  const errors: string[] = [];
  if (r.category !== 'm') errors.push('category guard-only must be m');
  for (const field of ['actionGroup', 'fidelityTag', 'action', 'platform', 'normalizations', 'desired', 'limitRef', 'reason', 'input']) {
    if (field in r) errors.push(field + ' forbidden on guard-only');
  }
  if (r.viewMode !== 'source' && r.viewMode !== 'wysiwyg') errors.push('viewMode required');
  const recipe = isObject(r.recipe) ? r.recipe : {};
  if (typeof recipe.path !== 'string' || !/^guard-only\/m\/[^\\]+$/.test(recipe.path) || recipe.path.split('/').some(part => !part || part === '..' || part === '.')) errors.push('recipe path must be under guard-only/m');
  if (typeof recipe.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(recipe.sha256)) errors.push('recipe sha256 required');
  if (typeof recipe.path === 'string') {
    const bytes = files[recipe.path];
    if (!Object.hasOwn(files, recipe.path)) errors.push('recipe missing file');
    else if (sha256Hex(bytes) !== recipe.sha256) errors.push('recipe sha256 mismatch');
  }
  if (!isObject(r.expected)) errors.push('expected.observation required');
  else {
    if ('serialized' in r.expected) errors.push('expected.serialized forbidden on guard-only');
    if (!guardDecisionValid(r.expected.observation)) errors.push('expected.observation must be complete guard decision');
  }
  if (!isObject(r.negative) || r.negative.kind !== 'wrongObservation' || Object.keys(r.negative).length !== 1) errors.push('negative must be exactly wrongObservation');
  return errors;
}
