/** Executable fidelity comparison: baseline equality never bypasses the independent semantic action model. */
import type { MountingRecord, NormalizationId, Observations } from './types.ts';
import { NORMALIZATION_IDS } from './vocabulary.ts';
import { applyNormalizations } from './normalizations.ts';
import { assertSemanticActions } from './textModel.ts';
import { canonicalJson } from './canonical.ts';
import { actionMutates } from './metadataActions.ts';
export interface ComparisonExpected { input: string; expectedSerialized: string; desired?: string; expectedObservation?: Observations }
export interface ComparisonActual { untouched: string; serialized: string; observation?: Observations }
export interface ComparisonReport { improvement?: boolean; normalizations?: NormalizationId[]; caseId?: string }
function equivalent(a: string, b: string, ids: readonly NormalizationId[]): boolean {
  return applyNormalizations(a, ids) === applyNormalizations(b, ids);
}
function differenceNormalizations(a: string, b: string): NormalizationId[] {
  let ids: NormalizationId[] = [...NORMALIZATION_IDS];
  for (const id of NORMALIZATION_IDS) {
    const without = ids.filter(candidate => candidate !== id);
    if (equivalent(a, b, without)) ids = without;
  }
  return ids;
}
export function compareCase(record: MountingRecord, expected: ComparisonExpected, actual: ComparisonActual, engine = 'milkdown'): ComparisonReport {
  try {
    const input = expected.input, output = actual.serialized, baseline = expected.expectedSerialized;
    if (typeof input !== 'string' || typeof output !== 'string' || typeof baseline !== 'string') throw new Error('missing serialized bytes');
    if (actual.untouched !== input) throw new Error('untouched output must equal input bytes');
    if (canonicalJson(expected.expectedObservation) !== canonicalJson(actual.observation)) throw new Error('observation differs');
    const baselineEngine = engine === 'milkdown';
    if (baselineEngine && output !== baseline) throw new Error('baseline serialized bytes differ from expectation');
    const actions = Array.isArray(record.action) ? record.action : [record.action];
    if (record.actionGroup === 'no-edit' && actions.length > 0) throw new Error('no-edit cannot have actions');
    if (!Array.isArray(record.normalizations) || record.normalizations.some(id => !(NORMALIZATION_IDS as readonly unknown[]).includes(id))) throw new Error('unknown normalization');
    switch (record.fidelityTag) {
      case 'immutable':
        if (record.actionGroup === 'edited' || (record.actionGroup === 'interaction' && actions.some(actionMutates))) throw new Error('immutable action mutates document');
        if (record.normalizations.length || output !== input || baseline !== input) throw new Error('immutable must preserve input with no normalizations');
        return {};
      case 'known-limitation':
        if (!record.desired || !record.reason?.trim() || !record.limitRef?.trim() || record.limitRef === 'pending' || typeof expected.desired !== 'string' || expected.desired === baseline) throw new Error('known-limitation requires distinct desired, reason and limitRef');
        if (output === baseline) return {};
        if (!baselineEngine && output === expected.desired) return { improvement: true, caseId: record.caseId };
        throw new Error('known-limitation matches neither allowed side');
      case 'semantic-roundtrip': {
        const normalized = applyNormalizations(input, record.normalizations);
        if (record.actionGroup === 'no-edit') {
          if (!record.normalizations.length || normalized !== baseline) throw new Error('no-edit normalizations do not reproduce baseline');
          for (let index = 0; index < record.normalizations.length; index++) if (applyNormalizations(input, record.normalizations.filter((_, i) => i !== index)) === baseline) throw new Error('normalizations are not minimal');
        } else assertSemanticActions(normalized, output, actions);
        if (output === baseline) return {};
        if (!baselineEngine && equivalent(baseline, output, NORMALIZATION_IDS)) return { normalizations: differenceNormalizations(baseline, output), caseId: record.caseId };
        throw new Error('semantic serialized output differs beyond closed normalizations');
      }
      default: throw new Error('unknown fidelity tag');
    }
  } catch (error) {
    throw new Error(`${record.caseId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
