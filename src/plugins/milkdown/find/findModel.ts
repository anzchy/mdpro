/**
 * Purpose: find literal text in rendered ProseMirror text blocks without crossing excluded content.
 * @coordinates-with findPlugin.ts
 */
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface FindRange {
  from: number;
  to: number;
}

interface TextRun {
  text: string;
  positions: number[];
}

const wordBefore = /[\p{L}\p{N}_]$/u;
const wordAfter = /^[\p{L}\p{N}_]/u;
const excludedNames = new Set(["code_block", "inlineCode", "code", "math", "math_inline", "math_block", "inline_math", "block_math"]);

/** Return exact document offsets for literal, eligible visible text. */
export function findMatches(doc: ProseMirrorNode, query: string, options: FindOptions): FindRange[] {
  if (!query) return [];
  const runs: TextRun[] = [];
  let run: TextRun | null = null;
  const flush = () => {
    if (run?.text) runs.push(run);
    run = null;
  };
  const visit = (node: ProseMirrorNode, pos: number, excluded: boolean) => {
    const blocked = excluded || excludedNames.has(node.type.name) || node.marks.some((mark) => excludedNames.has(mark.type.name));
    if (blocked) { flush(); return; }
    if (node.isText) {
      const value = node.text ?? "";
      if (!run || run.positions[run.positions.length - 1] + 1 !== pos) flush();
      if (!run) run = { text: "", positions: [] };
      run.text += value;
      for (let index = 0; index < value.length; index += 1) run.positions.push(pos + index);
      return;
    }
    if (node.isTextblock) flush();
    if (node.isLeaf) { flush(); return; }
    node.forEach((child, offset) => visit(child, pos + offset + 1, blocked));
    if (node.isTextblock) flush();
  };
  visit(doc, -1, false);
  flush();

  const fold = (value: string) => [...value].map((character) => character.toLocaleUpperCase()).join("");
  const needle = options.caseSensitive ? query : fold(query);
  const found: FindRange[] = [];
  for (const item of runs) {
    let haystack = item.text;
    const starts: number[] = [];
    const ends: number[] = [];
    const boundaries = new Set<number>([0]);
    if (options.caseSensitive) {
      for (let index = 0; index < item.text.length; index += 1) {
        starts.push(index); ends.push(index + 1); boundaries.add(index + 1);
      }
    } else {
      haystack = "";
      let original = 0;
      for (const character of item.text) {
        const folded = character.toLocaleUpperCase();
        for (let index = 0; index < folded.length; index += 1) {
          starts.push(original); ends.push(original + character.length);
        }
        haystack += folded;
        original += character.length;
        boundaries.add(haystack.length);
      }
    }
    let start = 0;
    while ((start = haystack.indexOf(needle, start)) !== -1) {
      const end = start + needle.length;
      const fromIndex = starts[start];
      const toIndex = ends[end - 1];
      const accepted = boundaries.has(start) && boundaries.has(end) && (!options.wholeWord ||
        (!wordBefore.test(item.text.slice(0, fromIndex)) && !wordAfter.test(item.text.slice(toIndex))));
      if (accepted) {
        found.push({ from: item.positions[fromIndex], to: item.positions[toIndex - 1] + 1 });
      }
      start = accepted ? end : start + 1;
    }
  }
  return found;
}
