/**
 * Purpose: pure word/character/reading-time counting for the status bar.
 *
 * Counting model (CJK-correct, per DR5):
 * - chars: total Unicode code points ([...text].length) so emoji and CJK
 *   characters each count as one — not the UTF-16 surrogate-pair length.
 * - words: whitespace-delimited non-CJK tokens each count as one word, plus
 *   each individual CJK character counts as one word-unit. (A Chinese sentence
 *   has no spaces, so per-character counting is the conventional CJK word count.)
 * - readingTimeMinutes: ceil(words / WORDS_PER_MINUTE) — round UP so a partial
 *   minute still shows "1 min".
 *
 * Frontmatter/code stripping mirror the export pipeline so the count matches
 * the visible prose.
 */
import { stripFrontmatter } from "../services/exportService";

/** Average reading speed (words per minute) used for the reading-time estimate. */
export const WORDS_PER_MINUTE = 200;

export interface CountOptions {
  excludeFrontmatter?: boolean;
  excludeCode?: boolean;
}

export interface CountResult {
  words: number;
  chars: number;
  readingTimeMinutes: number;
}

// Unicode scripts treated as per-character word units (no whitespace
// segmentation): Han (Chinese), Hiragana/Katakana (Japanese), Hangul (Korean),
// plus CJK fullwidth/halfwidth forms.
const CJK_CHAR =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}＀-￯]/u;
const CJK_CHAR_GLOBAL = new RegExp(CJK_CHAR.source, "gu");

/** Remove fenced ``` code blocks before counting. */
function stripFencedCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ");
}

/**
 * Count words, characters (code points), and reading-time minutes for a
 * Markdown string.
 */
export function countText(text: string, options: CountOptions): CountResult {
  let counted = text;
  if (options.excludeFrontmatter) {
    counted = stripFrontmatter(counted);
  }
  if (options.excludeCode) {
    counted = stripFencedCode(counted);
  }

  const chars = [...counted].length;

  // Each CJK character is its own word unit.
  const cjkMatches = counted.match(CJK_CHAR_GLOBAL);
  const cjkWords = cjkMatches ? cjkMatches.length : 0;

  // Remove CJK characters, then count remaining whitespace-delimited tokens.
  const nonCjk = counted.replace(CJK_CHAR_GLOBAL, " ");
  const latinTokens = nonCjk.match(/\S+/g);
  const latinWords = latinTokens ? latinTokens.length : 0;

  const words = cjkWords + latinWords;
  const readingTimeMinutes = words === 0 ? 0 : Math.ceil(words / WORDS_PER_MINUTE);

  return { words, chars, readingTimeMinutes };
}
