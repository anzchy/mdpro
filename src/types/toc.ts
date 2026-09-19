/**
 * Purpose: the three heading identity concepts, kept *mutually non-interchangeable*
 * at the type level — `AnchorSlug`, `HeadingKey`, and `HeadingPosition`.
 *
 * Why three types and not one `id`: plan M
 * (`docs/plans/20260912-plan-markdown-source-consolidation.md:425-431`) records that a
 * single `id` cannot carry three different stability promises at once. Verbatim:
 *
 *   | 概念 | 作用 | 稳定性要求 |
 *   |---|---|---|
 *   | `anchorSlug` | 导出 HTML 锚点 | 同输入确定、文档内唯一 |
 *   | `headingKey` | 编辑过程中关联同一标题 | 约定范围内跨修订协调 |
 *   | 位置 | 导航到源码或 PM 节点 | 随修订更新，不充当稳定身份 |
 *
 * The brands exist so the compiler refuses the mistake the single-`id` model invited:
 * handing a slug to something that wanted a coordination key, or treating a position
 * as an identity. Both are silent bugs at runtime and compile errors here.
 *
 * Scope note (WI-3.1, amended by WI-3.5.1 and WI-3.5.7): this module ships the types
 * and the written `headingKey` contract below — the contract, not its implementation.
 * The matcher that executes it is `coordinateHeadingKeys` in
 * `src/utils/headingCoordination.ts` (WI-3.5.2); `tocStore.setEntries` calls it on
 * every revision, and `tocStore.resetCoordination` is its other half, the
 * wholesale-replacement path of RESET clause (b). The split is deliberate: a types
 * module that could also match would be a types module able to quietly redefine what
 * "the same heading" means. WI-3.5.1 moved `TOCEntry` here from
 * `src/stores/tocStore.ts`, because the interface now names two of the three branded
 * types this module owns; leaving it in a store would make that store a second home for
 * identity types. {@link ParsedTOCEntry} is its parser-side companion.
 *
 * ---------------------------------------------------------------------------
 * The `headingKey` coordination contract (defined here, implemented by WI-3.5)
 * ---------------------------------------------------------------------------
 * `headingKey` is an opaque, document-scoped identity for "the same heading across
 * revisions". It is not derived from text alone (that would be `anchorSlug`) and not
 * from position alone (that would be `HeadingPosition`).
 *
 *   | Edit kind | headingKey | Collapse / active state |
 *   |---|---|---|
 *   | Edit to non-heading text before/after/between headings | preserved for every heading | preserved; positions updated |
 *   | Rename — text changes, level and ordinal among headings unchanged | preserved | preserved (the `anchorSlug` changes; this is the case that proves key ≠ slug) |
 *   | Insert — a new heading appears | new key for the new heading; all pre-existing headings keep theirs despite shifted ordinals | new heading starts expanded, never inherits a neighbour's state |
 *   | Move — heading relocates, text and level unchanged | preserved, state travels with it | preserved |
 *   | Delete | key retired | state dropped, never reassigned to a neighbour |
 *   | Duplicate headings (identical text + level) | independent keys | independent state; the second never inherits the first's |
 *   | Document switch | keys are scoped to a document id | state cleared; two documents both containing `intro` share nothing |
 *
 * **Out of the agreed range — RESET, do not guess.** The contract explicitly refuses
 * best-effort transfer in three cases:
 *   (a) a revision in which text *and* relative order both change for the same heading;
 *   (b) a wholesale content replacement (file reload, external file-watcher change,
 *       MCP `write_document` / `create_document`);
 *   (c) any heading the matcher cannot attribute — with exactly one named exception, the
 *       *same-ordinal, same-level continuity policy*: when an unmatched previous heading
 *       and an unmatched new heading sit at the same ordinal among headings and share a
 *       level, the revision is read as a **rename** and the key is preserved. That input
 *       is indistinguishable from a delete followed by an unrelated insertion in the same
 *       slot, so the consequence is recorded rather than hidden: such an insertion
 *       inherits the deleted heading's key and, with it, its collapse / active state.
 *       Every other unattributable heading resets.
 * Outside that one policy the affected headings are treated as **new** headings with
 * default state. Guessing and transferring state to the wrong heading is worse than
 * resetting, because the user cannot see that it happened — which is precisely why (c)
 * carves out one policy, states it and its cost in the open, and admits no others.
 */

declare const anchorSlugBrand: unique symbol;
declare const headingKeyBrand: unique symbol;

/**
 * An HTML anchor id for a heading — the `#fragment` an exported document links to.
 *
 * Stability promise (plan M, verbatim): 同输入确定、文档内唯一 — deterministic for the
 * same input, unique within one document. It is **not** stable across renames: change
 * the heading text and the slug changes. Anything that must survive a rename needs
 * {@link HeadingKey}.
 *
 * Mint with {@link asAnchorSlug}, or let `createAnchorSlugAllocator` produce one —
 * that allocator is the only thing that can promise document uniqueness.
 */
export type AnchorSlug = string & { readonly [anchorSlugBrand]: "AnchorSlug" };

/**
 * An opaque, document-scoped identity used to recognise the same heading across
 * revisions while the document is being edited.
 *
 * Stability promise (plan M, verbatim): 约定范围内跨修订协调 — coordinated across
 * revisions *within the agreed range*, which the contract in this file's header pins
 * edit-kind by edit-kind, including the three conditions that reset rather than guess.
 *
 * Deliberately opaque: nothing may parse it, derive it from heading text, or order by
 * it. A key that could be recomputed from text would be an {@link AnchorSlug} and
 * would break under rename — the exact failure the three-concept split exists to stop.
 */
export type HeadingKey = string & { readonly [headingKeyBrand]: "HeadingKey" };

/**
 * Where a heading currently sits in the source document.
 *
 * Stability promise (plan M, verbatim): 随修订更新，不充当稳定身份 — updated on every
 * revision, and it **must never be used as a stable identity**. Two revisions apart,
 * the same offset is a different heading; using it as a key is how "clicking the
 * second duplicate heading jumps to the first" gets built.
 *
 * `offsetUtf16` is a UTF-16 code-unit offset (what `String.prototype.slice` and
 * CodeMirror positions use — not a byte offset and not a code-point count).
 * `line` is 1-indexed.
 */
export interface HeadingPosition {
  offsetUtf16: number;
  line: number;
}

/**
 * Mint an {@link AnchorSlug} from a string that is already a valid slug.
 *
 * Identity at runtime — the brand is erased by the compiler and costs nothing. A mint
 * that normalized or trimmed would silently change every exported anchor, so it
 * deliberately does not.
 */
export function asAnchorSlug(value: string): AnchorSlug {
  return value as AnchorSlug;
}

/**
 * Mint a {@link HeadingKey} from a string the caller has already generated as an
 * opaque key. Identity at runtime, for the same reason as {@link asAnchorSlug}.
 */
export function asHeadingKey(value: string): HeadingKey {
  return value as HeadingKey;
}

/**
 * One heading as the TOC displays it.
 *
 * Carries the identity concepts *separately* on purpose. The field this replaced was a
 * single `id: string` doing double duty — the export anchor and the thing collapse and
 * active state hung off — which is exactly the confusion this file's header exists to
 * make a compile error:
 *
 *   - {@link anchorSlug} is the `#fragment`. It changes when the heading text changes.
 *   - {@link key} is the coordination identity. It survives a rename, and nothing may
 *     derive it from text.
 *
 * `lineNumber` / `offset` are the heading's current position. They are deliberately
 * **not** a {@link HeadingPosition} yet (WI-3.5.1 deferred that; WI-3.6 rewrites the
 * scroll paths that read them), and the rule in {@link HeadingPosition}'s doc applies to
 * them all the same: never use a position as an identity.
 *
 * There is no `isActive`. The active heading is one value on the store
 * (`activeEntryId: HeadingKey | null`), not a flag repeated on every entry — a
 * per-entry copy is a second source of truth that can disagree with the first.
 */
export interface TOCEntry {
  /** Coordination identity; minted only by `tocStore.setEntries`. */
  key: HeadingKey;

  /** HTML anchor id — what the sidebar's `href` and an export link point at. */
  anchorSlug: AnchorSlug;

  /** Heading level (1-6 for H1-H6). */
  level: 1 | 2 | 3 | 4 | 5 | 6;

  /** Heading text content. */
  text: string;

  /** Line number in the source document (1-indexed). */
  lineNumber: number;

  /** Character offset from the start of the source document. */
  offset: number;

  /** Child entries, populated by `buildTOCHierarchy`. */
  children: TOCEntry[];
}

/**
 * A heading as the *parser* knows it: everything a {@link TOCEntry} has except the two
 * fields the parser has no business producing.
 *
 * `key` is omitted so that a caller **structurally cannot** mint one. Identity across
 * revisions is the store's job; a parser that minted keys would be deriving them from
 * the text it just parsed, which is an {@link AnchorSlug} wearing the wrong name and
 * breaks on the first rename. `children` is omitted because nesting is
 * `buildTOCHierarchy`'s output, not the parser's input.
 */
export type ParsedTOCEntry = Omit<TOCEntry, "key" | "children">;
