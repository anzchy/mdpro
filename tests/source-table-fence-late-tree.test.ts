// @vitest-environment node
/**
 * @module source-table-fence-late-tree.test
 * D12 WI-6 (ADR-0043 Decision 4): the fence check runs BEFORE span reuse,
 * and it reads the syntax tree as it is at each transaction — so a fence
 * that the initial parse had not reached yet is honoured as soon as the
 * tree catches up, even when a stale span would otherwise be reused.
 *
 * `EditorState.create` parses only up to `Work.InitViewport` (3,000
 * chars). A fenced GFM-table-like block placed well past that is absent
 * from the tree at create time, so the field reports a table span there.
 * After `ensureSyntaxTree` completes the parse, the next transaction adopts
 * the complete tree (`LanguageState.apply`), and a selection-only move to
 * another offset in the same fenced table must give `{ span: null, cell:
 * null }`. With the fence check moved after the reuse check, the reuse
 * path would keep the stale span and this test fails.
 *
 * Deterministic: the partial tree comes from the viewport limit, not the
 * time budget, and is asserted rather than assumed.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";

import {
  getActiveTableCell,
  getTableContext,
  isPositionInFencedCode,
  tableDetectionExtension,
} from "../src/plugins/codemirror/sourceTableDetection";
import { FULL_PARSE_MS } from "./support/completeTreeState";

const EXTENSIONS = [markdown(), tableDetectionExtension()];
/** Well past `Work.InitViewport` (3,000) so the fence is outside the initial parse. */
const PREFIX_PARAGRAPHS = 200;

const PREFIX = Array.from(
  { length: PREFIX_PARAGRAPHS },
  (_, i) => `Plain paragraph number ${i} with ordinary prose and no table syntax.\n\n`,
).join("");
const FENCE = "```\n| a | b |\n| - | - |\n| 1 | 2 |\n```\n";
const DOC = PREFIX + FENCE;

/** Offset inside the fenced "table" row starting with `rowText`, at column `col`. */
function offsetIn(rowText: string, col: number): number {
  const at = DOC.indexOf(rowText, PREFIX.length);
  if (at < 0) throw new Error(`row ${rowText} not found`);
  return at + col;
}

const IN_HEADER = offsetIn("| a | b |", 2); // on "a"
const IN_BODY = offsetIn("| 1 | 2 |", 6); // on "2"

function field(s: EditorState) {
  return { span: getTableContext(s), cell: getActiveTableCell(s) };
}

/** A created state whose tree has NOT reached the fence; its field holds a span. */
function lateTreeState(): EditorState {
  const state = EditorState.create({ doc: DOC, selection: { anchor: IN_HEADER }, extensions: EXTENSIONS });
  expect(PREFIX.length).toBeGreaterThan(3_000 * 2);
  expect(syntaxTreeAvailable(state, IN_HEADER)).toBe(false);
  expect(isPositionInFencedCode(state, IN_HEADER)).toBe(false);
  const span = getTableContext(state);
  expect(span).not.toBeNull();
  expect(span?.delimiterIsCandidate).toBe(true);
  return state;
}

describe("D12 WI-6 — fence check sees a tree that completed after create", () => {
  it("a selection-only move inside the fence gives null/null once the full tree is in", () => {
    const state = lateTreeState();
    expect(ensureSyntaxTree(state, state.doc.length, FULL_PARSE_MS)).not.toBeNull();

    const next = state.update({ selection: { anchor: IN_BODY } }).state;

    // The move stays inside the stale span's rows: only the fence check
    // (run before reuse) can null it.
    expect(isPositionInFencedCode(next, IN_BODY)).toBe(true);
    expect(field(next)).toEqual({ span: null, cell: null });
  });

  it("characterisation (legacy-equivalent, not a desired property): a transaction with no doc or selection change keeps the old value", () => {
    const state = lateTreeState();
    const before = field(state);
    expect(ensureSyntaxTree(state, state.doc.length, FULL_PARSE_MS)).not.toBeNull();

    const idle = state.update({}).state;

    // The idle transaction adopted the complete tree, yet the field only
    // recomputes on doc or selection changes, so it keeps the stale span.
    expect(isPositionInFencedCode(idle, IN_HEADER)).toBe(true);
    expect(field(idle).span).toBe(before.span);
    expect(field(idle).span).not.toBeNull();

    // The next selection move then clears it.
    const moved = idle.update({ selection: { anchor: IN_BODY } }).state;
    expect(field(moved)).toEqual({ span: null, cell: null });
  });
});
