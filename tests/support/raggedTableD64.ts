/**
 * @module tests/support/raggedTableD64
 * Purpose: shared fixtures, oracles and editor helpers for the D64/D65 ragged-table
 * suites (ADR-0067). Not a `*.test.ts`, so vitest does not collect it.
 *
 * The expected widened text (`T_WIDE`) is the serializer's own load baseline measured
 * BEFORE the parse-time transformer existed: the ADR records that the serializer
 * already end-widens a ragged PM table correctly, so its output is an oracle that
 * does not depend on the code under test.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultValueCtx, Editor, editorViewCtx, rootCtx, serializerCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import { TableMap } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { tableParityPlugins } from "../../src/plugins/milkdown/table/parityPlugins";

/** tests/d64/fixture.md: T0 rectangular, T1-T3 ragged (short header, overflow rows). */
export const FIXTURE = readFileSync(resolve(__dirname, "../d64/fixture.md"), "utf8");

/** The widened text of fixture table Tn (n = 1..3), as the serializer writes it. */
export function tWide(n: number): string {
  return [
    "| h1 | h2 |     |     |",
    "| -- | -- | --- | --- |",
    `| e  | f  | X${n}a |     |`,
    `| g  | h  | X${n}b | X${n}c |`,
  ].join("\n");
}

/** Fixture T1 widened, as a cell matrix (header first). */
export const T1_CELLS = [
  ["h1", "h2", "", ""],
  ["e", "f", "X1a", ""],
  ["g", "h", "X1b", "X1c"],
];

/** Everything from `## T1 wide` to the end: the non-target tables of a T0 action. */
export function fromT1(markdown: string): string {
  const at = markdown.indexOf("## T1 wide");
  if (at < 0) throw new Error("## T1 wide not found");
  return markdown.slice(at);
}

/** Fixture tail (T1-T3 + last line) as the editor serializes it after widening. */
export const FIXTURE_TAIL_WIDE = [1, 2, 3]
  .map((n) => `## T${n} wide\n\n${tWide(n)}\n\n`)
  .join("")
  .concat("Last line.\n");

export interface TableShape {
  problems: unknown;
  width: number;
  cells: string[][];
  align: unknown[][];
}

/** Every table in `doc` (descending into containers), with its TableMap verdict. */
export function tableShapes(doc: PmNode): TableShape[] {
  const out: TableShape[] = [];
  doc.descendants((node) => {
    if (node.type.name !== "table") return true;
    const cells: string[][] = [];
    const align: unknown[][] = [];
    node.forEach((row) => {
      const r: string[] = [];
      const a: unknown[] = [];
      row.forEach((cell) => {
        r.push(cell.textContent);
        a.push(cell.attrs.alignment);
      });
      cells.push(r);
      align.push(a);
    });
    const map = TableMap.get(node);
    out.push({ problems: map.problems ?? null, width: map.width, cells, align });
    return false;
  });
  return out;
}

const editors: Editor[] = [];

/** Real Milkdown with the presets and the parity list MilkdownEditor.tsx registers. */
export async function mountParityEditor(md: string): Promise<Editor> {
  const root = document.body.appendChild(document.createElement("div"));
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, md);
    })
    .use(commonmark)
    .use(gfm)
    .use(tableParityPlugins)
    .use(history)
    .create();
  editors.push(editor);
  return editor;
}

export async function destroyParityEditors(): Promise<void> {
  for (const e of editors.splice(0)) await e.destroy();
  document.body.innerHTML = "";
}

export const viewOf = (e: Editor): EditorView => e.action((ctx) => ctx.get(editorViewCtx));
export const docOf = (e: Editor): PmNode => viewOf(e).state.doc;
export const serialize = (e: Editor): string =>
  e.action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc));

/** Position just after the first text occurrence of `needle`. */
export function posAfter(view: EditorView, needle: string): number {
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text?.includes(needle)) {
      found = pos + node.text.indexOf(needle) + needle.length;
    }
    return true;
  });
  if (found < 0) throw new Error(`text not found: ${needle}`);
  return found;
}

/** Type `text` right after `needle` (a history-recorded user edit). */
export function typeAfter(e: Editor, needle: string, text: string): void {
  const view = viewOf(e);
  view.dispatch(view.state.tr.insertText(text, posAfter(view, needle)));
}

/** Put the caret right after `needle`. */
export function caretAfter(e: Editor, needle: string): void {
  const view = viewOf(e);
  const pos = posAfter(view, needle);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

/** A user edit in the last textblock, outside any table. */
export function typeAtDocEnd(e: Editor, text: string): void {
  const view = viewOf(e);
  view.dispatch(view.state.tr.insertText(text, view.state.doc.content.size - 1));
}
