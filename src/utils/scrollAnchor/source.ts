/**
 * Purpose: the Source (CodeMirror) adapter of the WI-8 scroll anchor. Capture
 * reads the spy probe's top line; restore consumes the one-shot slot and
 * dispatches one `scrollIntoView` that puts the anchored line back at the probe.
 * Thin: all mapping arithmetic is in `anchor.ts`.
 *
 * Key decisions:
 *   - **Same probe as the TOC spy and TOC navigation** — `readSpyLineRange`'s
 *     top line on capture, `yMargin: SPY_ANCHOR_OFFSET_PX` on restore — so the
 *     TOC highlight agrees with the restored position by construction.
 *   - **Above the WYSIWYG threshold, no full parse.** Capture returns null (the
 *     guard sends such a document straight back to Source anyway). Restore uses
 *     the heading tier only: the frontmatter prefix's headings (tiny parse) plus
 *     the already-populated tocStore lines for this document. tocStore strips
 *     frontmatter; Milkdown renders it as a setext h2 — the prefix parse is what
 *     makes the two heading sequences line up.
 *   - No `requestAnimationFrame`: CodeMirror applies a scroll target in its own
 *     measure pass, so the call is safe from `onCreateEditor`.
 *   - **Never throws**; one log line per restore (a mode switch, not a hot path).
 *
 * @module src/utils/scrollAnchor/source
 * @coordinates-with src/utils/scrollAnchor/anchor.ts
 * @coordinates-with src/utils/codemirrorViewportLine.ts (the shared probe)
 * @coordinates-with src/components/Editor/Editor.tsx (restore call site, onCreateEditor)
 */
import { EditorView } from "@codemirror/view";
import { loggingService } from "../../services/loggingService";
import { stripFrontmatter } from "../../services/exportService";
import { useTOCStore } from "../../stores/tocStore";
import { readSpyLineRange, SPY_ANCHOR_OFFSET_PX } from "../codemirrorViewportLine";
import { decideLargeDocumentGuard } from "../largeDocumentGuard";
import {
  anchorFromSourceLine,
  buildSourceModel,
  consumePendingScrollAnchor,
  sourceLineFromAnchor,
  type ScrollAnchor,
  type SourceModel,
} from "./anchor";

function isAboveWysiwygThreshold(content: string): boolean {
  return decideLargeDocumentGuard({ viewMode: "wysiwyg", content }).action !== "allow";
}

function countLines(content: string): number {
  let lines = 1;
  for (let i = content.indexOf("\n"); i !== -1; i = content.indexOf("\n", i + 1)) lines++;
  return lines;
}

/** Capture the anchor at the Source view's probe line. Null on any failure. */
export function captureSourceScrollAnchor(
  view: EditorView,
  documentId: string,
): ScrollAnchor | null {
  try {
    const range = readSpyLineRange(view);
    if (!range) return null;
    const content = view.state.doc.toString();
    if (isAboveWysiwygThreshold(content)) return null;
    return anchorFromSourceLine(buildSourceModel(content), range.topLine, documentId);
  } catch {
    return null;
  }
}

/** The model a restore resolves against — heading-only above the threshold. */
export function sourceModelForRestore(content: string, documentId: string): SourceModel {
  if (!isAboveWysiwygThreshold(content)) return buildSourceModel(content);
  const prefix = content.slice(0, content.length - stripFrontmatter(content).length);
  const frontmatterHeadings = prefix ? buildSourceModel(prefix).headingLines : [];
  const toc = useTOCStore.getState();
  const tocLines = toc.documentId === documentId ? toc.entries.map((e) => e.lineNumber) : [];
  return {
    lineCount: countLines(content),
    blocks: null,
    headingLines: tocLines.length > 0 ? [...frontmatterHeadings, ...tocLines] : [],
  };
}

/**
 * Consume the slot for `documentId` and scroll the anchored line to the probe.
 * Returns true iff a scroll was dispatched. Call once per Source mount.
 */
export function restoreSourceScrollAnchor(
  view: EditorView,
  documentId: string | null,
): boolean {
  const anchor = consumePendingScrollAnchor(documentId);
  if (!anchor) return false;
  try {
    const doc = view.state.doc;
    const resolved = sourceLineFromAnchor(sourceModelForRestore(doc.toString(), anchor.documentId), anchor);
    if (!resolved) {
      logRestore(anchor, "cancel", null);
      return false;
    }
    const line = Math.min(Math.max(resolved.line, 1), doc.lines);
    view.dispatch({
      effects: EditorView.scrollIntoView(doc.line(line).from, {
        y: "start",
        yMargin: SPY_ANCHOR_OFFSET_PX,
      }),
    });
    logRestore(anchor, "success", resolved.tier);
    return true;
  } catch (error) {
    logRestore(anchor, "fail", null, error instanceof Error ? error.message : String(error));
    return false;
  }
}

function logRestore(
  anchor: ScrollAnchor,
  status: "success" | "cancel" | "fail",
  tier: string | null,
  error?: string,
): void {
  loggingService.logEventSync({
    level: status === "fail" ? "error" : "info",
    event: "editor.scroll_anchor.restore",
    status,
    actionId: loggingService.generateActionId(),
    context: { surface: "source", documentId: anchor.documentId, tier },
    error,
  });
}
