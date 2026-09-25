/**
 * Purpose: the one rule for naming a draft. A draft's title is the text of the
 * first ATX H1 (`# Title`) in the document, trimmed, or "Untitled" when there is
 * none. The quit backstop (ADR-0035) names its drafts with this.
 *
 * Key decisions:
 * - Moved unchanged out of `useAutoSave.ts` (ADR-0035 WI-6), so an autosave draft
 *   and a quit-backstop draft of the same document get the same title. The regex
 *   is multiline and requires whitespace after the `#`, so `#tag` and `## H2` are
 *   not titles.
 *
 * @coordinates-with src/hooks/useAutoSave.ts — the periodic draft writer
 */

/** The trimmed text of the first `# ` heading in `content`, or "Untitled". */
export function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "Untitled";
}
