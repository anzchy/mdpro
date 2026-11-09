/** Engine-neutral corpus contract. No editor positions, node types or engine imports cross this seam. */
import type { ACTION_GROUPS, CATEGORIES, CI_MODES, FIDELITY_TAGS, NORMALIZATION_IDS, PLATFORMS, STATUSES } from './vocabulary.ts';
export type ActionGroup = typeof ACTION_GROUPS[number];
export type Category = typeof CATEGORIES[number];
export type FidelityTag = typeof FIDELITY_TAGS[number];
export type NormalizationId = typeof NORMALIZATION_IDS[number];
export type Platform = typeof PLATFORMS[number];
export type ViewMode = 'source' | 'wysiwyg';
export type TextSelection = { text: string; occurrence?: number };
export type Caret = TextSelection & { edge: 'before' | 'after' };
export type Cell = { cell: { table: number; row: number; col: number } };
export type CellRange = { cells: { table: number; from: [number, number]; to: [number, number] } };
export type Mark = 'strong' | 'emphasis' | 'code' | 'strike' | 'highlight' | 'underline';
export type FindOptions = { caseSensitive: boolean; wholeWord: boolean };
export type CorpusAction =
  | { kind: 'type'; at: Caret; text: string }
  | { kind: 'delete'; range: TextSelection }
  | { kind: 'toggleMark'; range: TextSelection; mark: Mark }
  | { kind: 'clearFormat'; range: TextSelection }
  | { kind: 'setListKind'; at: Caret; to: 'bullet' | 'ordered' }
  | { kind: 'paste'; at: Caret | CellRange; html?: string; text?: string }
  | { kind: 'undo' }
  | { kind: 'insertTableRow'; at: Cell; side: 'above' | 'below' }
  | { kind: 'insertTableColumn'; at: Cell; side: 'left' | 'right' }
  | ({ kind: 'find'; query: string } & FindOptions)
  | ({ kind: 'replace'; query: string; with: string; all: boolean } & FindOptions)
  | { kind: 'modeSwitch'; to: ViewMode }
  | { kind: 'activateLink'; link: TextSelection };
/** Complete structural copy of production guard's decision contract; keep all decision fields. */
export type LargeDocGuardDecision =
  | { action: 'allow' }
  | { action: 'degrade-to-source'; message: string; elements: number; longestLine: number; trigger: 'structure' | 'line-length' | 'both' }
  | { action: 'withhold-table-extensions'; message: string; tableRows: number };
export type LinkActivation = {
  outcome: 'refused' | 'external' | 'same-app' | 'no-href';
  reason?: 'scheme' | 'resolved-mismatch'; defaultPrevented: boolean; propagated: boolean; openerCalls: string[];
};
export interface ObservationMap {
  toc: { level: number; text: string; id: string }[];
  largeDocGuard: LargeDocGuardDecision;
  find: { query: string; options: FindOptions; matches: { text: string; occurrence: number; block: number }[] };
  pasteSafety: { forbiddenFound: string[] };
  linkActivation: LinkActivation;
  renderedMath: { count: number };
  imageSources: { markdownSrc: string; resolvedKind: 'asset' | 'url' | 'unresolved' }[];
  selection: { text: string };
}
export type ObservationKind = keyof ObservationMap;
export type DriverObservationKind = Exclude<ObservationKind, 'toc' | 'largeDocGuard'>;
/** A mounting expected.json is a nonempty map of observation kinds to these DTOs. */
export type Observations = Partial<ObservationMap>;
export type CorpusNegative =
  | { kind: 'dropText'; text?: string }
  | { kind: 'alterByte'; offset?: number; with?: string }
  | { kind: 'corruptSerialized'; offset?: number; with?: string }
  | { kind: 'wrongObservation'; value?: unknown }
  | { kind: 'matchDesiredOnBaseline' };
export interface CommonRecord {
  caseId: string; category: Category; status: typeof STATUSES[number]; baselineSha: string; rationale: string;
  ci?: typeof CI_MODES[number]; guardedPaths: { path: string; receipt: string }[];
  consumers: string[]; derivedFrom?: string; externalEvidence?: string[];
}
export interface MountingRecord extends CommonRecord {
  negative: CorpusNegative;
  caseKind?: 'mounting'; actionGroup: ActionGroup; fidelityTag: FidelityTag; input: string;
  expected: { serialized: string; observation?: string }; desired?: string;
  action: CorpusAction | CorpusAction[]; platform: Platform; normalizations: NormalizationId[];
  limitRef?: string; reason?: string;
}
export interface GuardOnlyRecord extends CommonRecord {
  caseKind: 'guard-only'; category: 'm'; recipe: { path: string; sha256: string }; viewMode: ViewMode;
  expected: { observation: LargeDocGuardDecision }; negative: { kind: 'wrongObservation' };
}
export type CorpusRecord = MountingRecord | GuardOnlyRecord;
export interface CorpusDriver {
  mount(input: string, platform: Platform): Promise<void>;
  untouched(): Promise<string>;
  serialize(): Promise<string>;
  runAction(action: CorpusAction): Promise<void>;
  observe<K extends DriverObservationKind>(kind: K): Promise<ObservationMap[K]>;
  cleanup(): Promise<void>;
}
