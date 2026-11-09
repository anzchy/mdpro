/** Read-only record validation over an explicit relative-path file inventory, usable by Node CLI and Vitest. */
import { ACTION_GROUPS, CATEGORIES, CI_MODES, FIDELITY_TAGS, NEGATIVE_KINDS, NORMALIZATION_IDS, PLATFORMS, STATUSES } from './vocabulary.ts';
import { canonicalJson } from './canonical.ts';
import { observationsValid } from './metadataObservations.ts';
import { guardRecordErrors } from './metadataGuard.ts';
import { actionErrors, actionMutates, isObject } from './metadataActions.ts';
export interface ValidationContext { files: Readonly<Record<string, string>>; directory?: string; canonicalSource?: string }
export function safeRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\') && !value.startsWith('/') &&
    value.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');
}
export function validateRecord(value: unknown, context: ValidationContext): string[] {
  if (!isObject(value)) return ['<unknown>: record must be an object'];
  const r = value;
  const id = typeof r.caseId === 'string' ? r.caseId : '<unknown>';
  const errors: string[] = [];
  const fail = (rule: string) => errors.push(`${id}: ${rule}`);
  const closed = (field: string, options: readonly unknown[], optional = false) => {
    if (optional && r[field] === undefined) return;
    if (!options.includes(r[field])) fail(field + ' outside closed list');
  };
  const line = (field: string, optional = false) => {
    if (optional && r[field] === undefined) return;
    if (typeof r[field] !== 'string' || !r[field].trim() || /[\r\n]/.test(r[field])) fail(field + ' must be one nonempty line');
  };
  const file = (path: unknown, field: string, group?: unknown): string | undefined => {
    if (!safeRelativePath(path)) { fail(field + ' path must be relative and contained'); return; }
    const parts = path.split('/');
    if (group !== undefined && (parts[0] !== group || parts[1] !== r.category)) fail(field + ' directory must match actionGroup/category');
    if (!Object.hasOwn(context.files, path)) { fail(field + ' missing file ' + path); return; }
    return context.files[path];
  };
  closed('category', CATEGORIES); closed('status', STATUSES); closed('ci', CI_MODES, true);
  if (!/^[a-n]-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id[0] !== r.category) fail('caseId must match category and kebab slug');
  line('rationale'); line('derivedFrom', true);
  if (typeof r.baselineSha !== 'string' || !/^[a-fA-F0-9]{40}$/.test(r.baselineSha)) fail('baselineSha must be a 40-hex commit');
  for (const name of ['consumers', 'externalEvidence']) {
    if (name === 'externalEvidence' && r[name] === undefined) continue;
    if (!Array.isArray(r[name]) || !r[name].every(item => typeof item === 'string' && item.trim().length > 0)) fail(name + ' must be a string array');
  }
  if (!Array.isArray(r.guardedPaths) || r.guardedPaths.length === 0 || !r.guardedPaths.every(item => isObject(item) && safeRelativePath(item.path) && typeof item.receipt === 'string' && item.receipt.length > 0)) fail('guardedPaths requires path and receipt');
  if (r.caseKind === 'guard-only') return errors.concat(guardRecordErrors(r, context.files).map(rule => `${id}: ${rule}`));
  if (r.caseKind !== undefined && r.caseKind !== 'mounting') fail('caseKind outside closed list');
  for (const field of ['recipe', 'viewMode']) if (field in r) fail(field + ' is guard-only');
  closed('actionGroup', ACTION_GROUPS); closed('fidelityTag', FIDELITY_TAGS); closed('platform', PLATFORMS);
  if (context.directory !== undefined && context.directory !== `${r.actionGroup}/${r.category}`) fail('directory must match actionGroup/category');
  const input = file(r.input, 'input', r.actionGroup);
  const expected = isObject(r.expected) ? r.expected : {};
  const serialized = file(expected.serialized, 'expected.serialized', r.actionGroup);
  if (r.actionGroup === 'interaction' && expected.observation === undefined) fail('expected.observation required for interaction');
  if (expected.observation !== undefined) {
    const bytes = file(expected.observation, 'expected.observation', r.actionGroup);
    if (bytes !== undefined) {
      try {
        const observation: unknown = JSON.parse(bytes);
        if (!observationsValid(observation)) fail('expected.observation requires a nonempty map of complete observation DTOs');
      } catch { fail('expected.observation must contain JSON'); }
    }
  }
  const actions = Array.isArray(r.action) ? r.action : [r.action];
  if (r.actionGroup === 'no-edit' && actions.length > 0) fail('no-edit action must be empty');
  if (actions.length === 0 && r.actionGroup !== 'no-edit') fail('action cannot be empty for edited/interaction');
  for (const action of actions) for (const error of actionErrors(action)) fail(error);
  if (!Array.isArray(r.normalizations) || !r.normalizations.every(n => (NORMALIZATION_IDS as readonly unknown[]).includes(n)) || new Set(r.normalizations).size !== r.normalizations.length) fail('normalizations must be unique closed ids');
  if (!isObject(r.negative) || !(NEGATIVE_KINDS as readonly unknown[]).includes(r.negative.kind)) fail('negative requires closed kind');
  if (r.fidelityTag === 'immutable') {
    if (r.actionGroup === 'edited' || (r.actionGroup === 'interaction' && actions.some(actionMutates))) fail('immutable cannot mutate');
    if (Array.isArray(r.normalizations) && r.normalizations.length !== 0) fail('immutable normalizations must be empty');
    if (input !== undefined && serialized !== undefined && input !== serialized) fail('immutable serialized must equal input');
  }
  if (r.fidelityTag === 'semantic-roundtrip' && r.actionGroup === 'no-edit' && Array.isArray(r.normalizations) && r.normalizations.length === 0) fail('normalizations required for no-edit semantic-roundtrip');
  if (r.limitRef === 'pending') fail('limitRef pending classification');
  if (r.fidelityTag === 'known-limitation') {
    line('limitRef'); line('reason');
    const desired = file(r.desired, 'desired', r.actionGroup);
    if (desired !== undefined && desired === serialized) fail('desired must differ from expected.serialized');
  } else for (const name of ['desired', 'reason', 'limitRef']) if (r[name] !== undefined) fail(name + ' requires known-limitation');
  return errors;
}
/** Manifest inventory is exactly the union of referenced data paths; callers exclude shard/list metadata files. */
export function validateManifest(values: unknown[], context: ValidationContext): string[] {
  const errors: string[] = [];
  if (context.canonicalSource !== undefined && context.canonicalSource !== canonicalJson(values)) errors.push('manifest: canonical key order and formatting required');
  const ids = new Set<unknown>();
  const listed = new Set<string>();
  for (const value of values) {
    errors.push(...validateRecord(value, context));
    if (!isObject(value)) continue;
    if (ids.has(value.caseId)) errors.push(`${value.caseId}: duplicate caseId`);
    ids.add(value.caseId);
    const expected = isObject(value.expected) ? value.expected : {};
    const recipe = isObject(value.recipe) ? value.recipe : {};
    for (const path of [value.input, expected.serialized, expected.observation, value.desired, recipe.path]) if (typeof path === 'string') listed.add(path);
  }
  for (const path of Object.keys(context.files).sort()) if (!listed.has(path)) errors.push(`${path}: unlisted fixture`);
  return errors;
}
