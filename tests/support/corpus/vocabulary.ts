/** Closed corpus vocabulary from approved MIG-001 r5; additions require user approval. */
export const FIDELITY_TAGS = ['immutable', 'semantic-roundtrip', 'known-limitation'] as const;
export const ACTION_GROUPS = ['no-edit', 'edited', 'interaction'] as const;
export const CATEGORIES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'] as const;
export const PLATFORMS = ['any', 'mac', 'win'] as const;
export const STATUSES = ['active', 'retired'] as const;
export const CI_MODES = ['shards', 'local-only'] as const;
export const ACTION_KINDS = ['type', 'delete', 'toggleMark', 'clearFormat', 'setListKind', 'paste', 'undo',
  'insertTableRow', 'insertTableColumn', 'find', 'replace', 'modeSwitch', 'activateLink'] as const;
export const OBSERVATION_KINDS = ['toc', 'largeDocGuard', 'find', 'pasteSafety', 'linkActivation', 'renderedMath', 'imageSources', 'selection'] as const;
export const DRIVER_OBSERVATION_KINDS = ['find', 'pasteSafety', 'linkActivation', 'renderedMath', 'imageSources', 'selection'] as const;
export const NEGATIVE_KINDS = ['dropText', 'alterByte', 'corruptSerialized', 'wrongObservation', 'matchDesiredOnBaseline'] as const;
export const NORMALIZATION_IDS = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8'] as const;
/** Sources accompany ids; reference transforms are implemented independently of engines. */
export const NORMALIZATIONS = {
  N1: { description: 'Two-space hard break to backslash', source: 'd188-empty-paragraph-read D1' },
  N2: { description: 'Blank-line pairs encode empty paragraphs; whitespace-only lines count', source: 'ADR-0091; d188 B1/B3' },
  N3: { description: 'Strip leading and trailing empty paragraphs', source: 'ADR-0091; D188 edge serializer; d188 B5' },
  N4: { description: 'Add trailing newline', source: 'd188 B5' },
  N5: { description: 'Legacy br-only paragraph to blank lines', source: 'ADR-0091; d188 E1' },
  N6: { description: 'Absent list marker defaults to - or .; syntactic Markdown is identity', source: 'ADR-0099' },
  N7: { description: 'Rewrite table delimiter and pad cells', source: 'ADR-0067; table-empty-cell-serialize' },
  N8: { description: 'Widen ragged tables with blank cells', source: 'ADR-0067; table-empty-cell-serialize' },
} as const;
