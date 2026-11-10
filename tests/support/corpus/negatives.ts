/** Declarative negatives corrupt one observed dimension; they never update fixture data or original actual values. */
import type { MountingRecord, Observations } from './types.ts';
import { compareCase, type ComparisonActual, type ComparisonExpected } from './comparator.ts';
// ignoreBOM keeps a leading U+FEFF in the decoded text, as the byte path has always done (category l has BOM cases).
const UTF8_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });
const UTF8_ENCODER = new TextEncoder();
function alterByte(text: string, offset = 0, replacement?: string): string {
  const bytes = UTF8_ENCODER.encode(text);
  if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.length) throw new Error('negative byte offset out of bounds');
  const inserted = UTF8_ENCODER.encode(replacement ?? (bytes[offset] === 88 ? 'Y' : 'X'));
  if (inserted.length !== 1) throw new Error('negative replacement must be exactly one UTF-8 byte');
  bytes[offset] = inserted[0]; return UTF8_DECODER.decode(bytes);
}
export function applyNegative(record: MountingRecord, expected: ComparisonExpected, actual: ComparisonActual): ComparisonActual {
  try {
    const changed = structuredClone(actual), negative = record.negative;
    switch (negative.kind) {
      case 'dropText': {
        const text = negative.text ?? Array.from(changed.serialized).find(char => !/\s/.test(char));
        if (!text || !changed.serialized.includes(text)) throw new Error('negative dropText target missing');
        changed.serialized = changed.serialized.replace(text, ''); break;
      }
      case 'alterByte': changed.serialized = alterByte(changed.serialized, negative.offset, negative.with); break;
      case 'corruptSerialized':
        changed.serialized = negative.offset !== undefined || negative.with !== undefined
          ? alterByte(changed.serialized, negative.offset, negative.with) : changed.serialized + '\n__CORRUPTED_SERIALIZED__\n';
        break;
      case 'wrongObservation':
        changed.observation = negative.value === undefined
          ? { ...changed.observation, selection: { text: `__negative__${changed.observation?.selection?.text ?? ''}` } }
          : structuredClone(negative.value) as Observations;
        break;
      case 'matchDesiredOnBaseline':
        if (expected.desired === undefined) throw new Error('negative desired bytes missing');
        changed.serialized = expected.desired; break;
      default: { const exhaustive: never = negative; throw new Error(`unsupported negative ${String(exhaustive)}`); }
    }
    return changed;
  } catch (error) { throw new Error(`${record.caseId}: ${error instanceof Error ? error.message : String(error)}`); }
}
export function assertNegative(record: MountingRecord, expected: ComparisonExpected, actual: ComparisonActual, engine = 'milkdown'): void {
  const changed = applyNegative(record, expected, actual);
  try { compareCase(record, expected, changed, record.negative.kind === 'matchDesiredOnBaseline' ? 'milkdown' : engine); }
  catch (error) {
    if (error instanceof Error && error.message.includes(record.caseId)) return;
    throw new Error(`${record.caseId}: negative failed without a case-named comparison diagnostic`);
  }
  throw new Error(`${record.caseId}: negative unexpectedly passed the comparison`);
}
