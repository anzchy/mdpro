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
 * Scope note (WI-3.1): this module ships the types and the written `headingKey`
 * contract below. It ships **no matcher** — `tocStore.setEntries` gains that in WI-3.5,
 * and the coordination law becomes executable there (plan M "测试分三层", first layer).
 * `TOCEntry` deliberately stays in `src/stores/tocStore.ts` until WI-3.5 changes its
 * shape; moving it now would be pure-churn rewiring.
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
 *   (c) any revision the matcher cannot attribute unambiguously.
 * In all three the affected headings are treated as **new** headings with default
 * state. Guessing and transferring state to the wrong heading is worse than resetting,
 * because the user cannot see that it happened.
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
