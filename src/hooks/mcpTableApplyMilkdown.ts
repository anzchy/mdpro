/**
 * Purpose: the WYSIWYG phase of an MCP table action (D58). Commits a computed table
 * edit to the live Milkdown editor BEFORE the caller writes the store, and reports what
 * the editor actually did, so store and editor never silently disagree.
 *
 * Pipeline (one `editor.action`, one guarded region, matrix §0.10):
 *   view = editorViewCtx → `before` = view.state.doc → parsed = parserCtx(newContent)
 *   → no parse: refused → `parsed.eq(before)`: no-op (applied, no dispatch)
 *   → `replaceAll(newContent)` → doc identity unchanged: refused → applied.
 *   A throw anywhere in the region: if the view already advanced, the result is
 *   `reconciled` with the serializer's markdown of the view's doc (or `newContent` if
 *   the serializer throws too); otherwise `refused`.
 *
 * Key decisions:
 * - Pre-parse rather than trusting `replaceAll`: it returns silently without
 *   dispatching when the parser yields nothing, which used to leave the store ahead of
 *   the editor. The cost is a second parse of `newContent` on a normal apply.
 * - The no-op is decided on parsed docs (`Node.eq`), not on text, so a padding-only
 *   table change (same doc, different markdown) does not dispatch.
 * - The post-check is object identity: a dispatched replacement always yields a new doc.
 * - Never throws, and returns no cell text, so logs built from it cannot leak content.
 *
 * @coordinates-with src/hooks/mcpTableAction.ts — the only caller; it writes the store
 * @module hooks/mcpTableApplyMilkdown
 */
import { editorViewCtx, parserCtx, serializerCtx, type Editor } from "@milkdown/kit/core";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import { replaceAll } from "@milkdown/kit/utils";

export const REASON_THREW = "milkdown replaceAll threw";
export const REASON_NOT_APPLIED = "editor did not apply";

/** What the editor phase did. `applied` covers the legitimate no-op. */
export type MilkdownApplyOutcome =
  | { kind: "applied" }
  | { kind: "refused"; reason: string; error?: string }
  | { kind: "reconciled"; markdown: string; error: string };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Apply `newContent` to `editor`; see the module header for the phases. */
export function applyTableToMilkdown(editor: Editor, newContent: string): MilkdownApplyOutcome {
  let view: { state: { doc: PmNode } } | null = null;
  let before: PmNode | null = null;
  try {
    return editor.action((ctx): MilkdownApplyOutcome => {
      view = ctx.get(editorViewCtx);
      before = view.state.doc;
      const parsed = ctx.get(parserCtx)(newContent);
      if (!parsed) return { kind: "refused", reason: REASON_NOT_APPLIED };
      if (parsed.eq(before)) return { kind: "applied" };
      replaceAll(newContent)(ctx);
      return view.state.doc === before
        ? { kind: "refused", reason: REASON_NOT_APPLIED }
        : { kind: "applied" };
    });
  } catch (error) {
    const advanced = view as { state: { doc: PmNode } } | null;
    if (!advanced || before === null || advanced.state.doc === before) {
      return { kind: "refused", reason: REASON_THREW, error: message(error) };
    }
    return { kind: "reconciled", markdown: serializeOr(editor, advanced.state.doc, newContent), error: message(error) };
  }
}

/** The editor's own markdown for `doc`, or `fallback` when serializing throws. */
function serializeOr(editor: Editor, doc: PmNode, fallback: string): string {
  try {
    return editor.action((ctx) => ctx.get(serializerCtx)(doc));
  } catch {
    return fallback;
  }
}
