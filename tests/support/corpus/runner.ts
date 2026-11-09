/** Read-only orchestration: validate inputs, execute one fresh driver, compare both outputs and prove its negative. */
import type { CorpusDriver, CorpusRecord, LargeDocGuardDecision, MountingRecord, ObservationKind, Observations, Platform, ViewMode } from './types.ts';
import { compareCase, type ComparisonActual, type ComparisonExpected, type ComparisonReport } from './comparator.ts';
import { canonicalJson } from './canonical.ts';
import { validateRecord } from './metadata.ts';
import { observationsValid } from './metadataObservations.ts';
import { assertNegative } from './negatives.ts';
import { observeContent } from './contentObservations.ts';
import { expandRecipe } from './recipes.ts';
import { createCorpusDriver } from './defaultDriverFactory.ts';
import { OBSERVATION_KINDS } from './vocabulary.ts';
export interface RunOptions { engine?: string; driverFactories?: Readonly<Record<string, (record: MountingRecord) => CorpusDriver | Promise<CorpusDriver>>>; mode?: 'check' | 'write'; env?: Readonly<Record<string, string | undefined>>; observationKinds?: readonly ObservationKind[] }
export type CaseResult = { caseId: string; caseKind: 'mounting'; actual: ComparisonActual; report: ComparisonReport } | { caseId: string; caseKind: 'guard-only'; actual: { observation: LargeDocGuardDecision }; report: ComparisonReport };
export interface SelectionOptions { caseIds?: readonly string[]; platform?: Platform; includeLocalOnly?: boolean }
export function selectCases(records: readonly CorpusRecord[], options: SelectionOptions = {}): CorpusRecord[] {
  for (const id of options.caseIds ?? []) if (!records.some(record => record.caseId === id)) throw new Error(`${id}: selected case does not exist`);
  return records.filter(record => record.status === 'active' && (!options.caseIds || options.caseIds.includes(record.caseId)) &&
    (options.includeLocalOnly || record.ci !== 'local-only') &&
    (!options.platform || record.caseKind === 'guard-only' || record.platform === 'any' || record.platform === options.platform));
}
function read(files: Readonly<Record<string, string>>, path: string): string {
  if (!Object.hasOwn(files, path)) throw new Error(`missing file ${path}`);
  return files[path];
}
function expectedObservation(record: MountingRecord, files: Readonly<Record<string, string>>, options: RunOptions): { value?: Observations; kinds: ObservationKind[] } {
  const path = record.expected.observation;
  if (!path) return { kinds: [] };
  if (!Object.hasOwn(files, path) && options.mode === 'write') {
    // Bootstrap keys are caller input, not inferred from filenames or added to the closed record schema.
    if (!options.observationKinds?.length || new Set(options.observationKinds).size !== options.observationKinds.length ||
        options.observationKinds.some(kind => !(OBSERVATION_KINDS as readonly unknown[]).includes(kind))) {
      throw new Error('missing expected observation needs unique closed observationKinds in write mode');
    }
    return { kinds: [...options.observationKinds] };
  }
  const value: unknown = JSON.parse(read(files, path));
  if (!observationsValid(value)) throw new Error('invalid expected observation');
  return { value: value as Observations, kinds: Object.keys(value as Observations) as ObservationKind[] };
}
function logicalMode(record: MountingRecord): ViewMode {
  let mode: ViewMode = 'wysiwyg';
  for (const action of Array.isArray(record.action) ? record.action : [record.action]) if (action.kind === 'modeSwitch') mode = action.to;
  return mode;
}
export async function runCase(record: CorpusRecord, files: Readonly<Record<string, string>>, options: RunOptions = {}): Promise<CaseResult> {
  try {
    const env = options.env ?? process.env;
    if (options.mode === 'write' && Object.hasOwn(env, 'CI')) throw new Error('write mode refused while CI is set');
    if (record.caseKind === 'guard-only') {
      const errors = validateRecord(record, { files }); if (errors.length) throw new Error(errors.join('; '));
      const content = expandRecipe(read(files, record.recipe.path), record.recipe.sha256, record.caseId);
      const observation = await observeContent('largeDocGuard', content, record.viewMode);
      const baseline = options.mode === 'write' ? observation : record.expected.observation;
      if (canonicalJson(observation) !== canonicalJson(baseline)) throw new Error('guard observation differs');
      const wrong = observation.action === 'allow' ? { action: 'withhold-table-extensions', message: 'negative', tableRows: 0 } : { action: 'allow' };
      if (canonicalJson(wrong) === canonicalJson(baseline)) throw new Error('guard negative unexpectedly passed');
      return { caseId: record.caseId, caseKind: 'guard-only', actual: { observation }, report: {} };
    }
    if (options.mode !== 'write') {
      const errors = validateRecord(record, { files }); if (errors.length) throw new Error(errors.join('; '));
    }
    const input = read(files, record.input), observed = expectedObservation(record, files, options);
    const desired = record.desired === undefined ? undefined : read(files, record.desired);
    const baseline = options.mode === 'write' ? undefined : read(files, record.expected.serialized);
    const engine = options.engine ?? env.CORPUS_ENGINE ?? 'milkdown';
    const factories = options.driverFactories ?? { milkdown: createCorpusDriver };
    const factory = Object.hasOwn(factories, engine) ? factories[engine] : undefined;
    if (!factory) throw new Error(`unknown corpus engine ${engine}`);
    const driver = await factory(record);
    try {
      await driver.mount(input, record.platform);
      const untouched = await driver.untouched();
      for (const action of Array.isArray(record.action) ? record.action : [record.action]) await driver.runAction(action);
      const serialized = await driver.serialize();
      const observation: Observations = {};
      for (const kind of observed.kinds) {
        const value = kind === 'toc' || kind === 'largeDocGuard'
          ? await observeContent(kind, serialized, logicalMode(record)) : await driver.observe(kind);
        Object.assign(observation, { [kind]: value });
      }
      if (observation.pasteSafety?.forbiddenFound.length) throw new Error('pasteSafety found forbidden content');
      const actual: ComparisonActual = { untouched, serialized, ...(observed.kinds.length ? { observation } : {}) };
      const expected: ComparisonExpected = { input, expectedSerialized: baseline ?? serialized, ...(desired === undefined ? {} : { desired }),
        ...(observed.kinds.length ? { expectedObservation: options.mode === 'write' ? observation : observed.value } : {}) };
      if (options.mode === 'write') {
        const generated = { ...files, [record.expected.serialized]: serialized, ...(record.expected.observation ? { [record.expected.observation]: canonicalJson(observation) } : {}) };
        const errors = validateRecord(record, { files: generated }); if (errors.length) throw new Error(errors.join('; '));
      }
      const report = compareCase(record, expected, actual, engine);
      assertNegative(record, expected, actual, engine);
      return { caseId: record.caseId, caseKind: 'mounting', actual, report };
    } finally { await driver.cleanup(); }
  } catch (error) { throw new Error(`${record.caseId}: ${error instanceof Error ? error.message : String(error)}`); }
}
