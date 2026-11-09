/** Engine-private observations read real plugin state, schema source and live rendered surfaces. */
import { act } from '@testing-library/react';
import { getMarkdown } from '@milkdown/kit/utils';
import { CellSelection } from '@milkdown/kit/prose/tables';
import { getFindState } from '../../../src/plugins/milkdown/find/findPlugin';
import { isSafeHref } from '../../../src/services/linkSafety';
import type { DriverObservationKind, ObservationMap } from './types.ts';
import type { MilkdownDriverRuntime } from './milkdownDriverTypes.ts';
export async function observeDriver<K extends DriverObservationKind>(runtime: MilkdownDriverRuntime, kind: K): Promise<ObservationMap[K]> {
  const view = runtime.view();
  let result: unknown;
  switch (kind) {
    case 'selection': {
      const selection = view.state.selection, { from, to } = selection;
      const text = selection instanceof CellSelection
        ? [...selection.ranges].sort((a, b) => a.$from.pos - b.$from.pos)
          .map(range => view.state.doc.textBetween(range.$from.pos, range.$to.pos, '\n')).join('\n')
        : from === to ? '' : view.state.doc.textBetween(from, to, '\n');
      result = { text }; break;
    }
    case 'find': {
      const find = getFindState(view.state);
      result = { query: find.query, options: { caseSensitive: find.caseSensitive, wholeWord: find.wholeWord },
        matches: find.matches.map(({ from, to }, index) => ({ text: view.state.doc.textBetween(from, to, '\n'),
          occurrence: index + 1, block: view.state.doc.resolve(from).index(0) + 1 })) }; break;
    }
    case 'pasteSafety': result = scanPasteSafety(runtime.editor().action(getMarkdown()), view.dom); break;
    case 'renderedMath': result = { count: view.dom.querySelectorAll('.katex, .MathJax, math').length }; break;
    case 'imageSources': {
      // Production useMilkdownImages resolves initial sources on a real 100ms timer.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
      const sources: string[] = [];
      view.state.doc.descendants(node => { if (node.type.name === 'image') sources.push(String(node.attrs.src)); });
      const images = [...view.dom.querySelectorAll('img:not(.ProseMirror-separator)')];
      if (images.length !== sources.length) throw new Error(`${runtime.caseId}: image schema/DOM count mismatch ${sources.length}/${images.length}`);
      result = sources.map((markdownSrc, index) => {
        const rendered = images[index].getAttribute('src') ?? '';
        const resolvedKind = /^(asset|tauri):\/\//.test(rendered) ? 'asset'
          : /^(https?:\/\/|data:)/.test(rendered) ? 'url' : 'unresolved';
        return { markdownSrc, resolvedKind };
      }); break;
    }
    case 'linkActivation': throw new Error(`${runtime.caseId}: link activation requires the WI5 click observer`);
    default: { const exhaustive: never = kind; throw new Error(`${runtime.caseId}: unknown observation ${exhaustive}`); }
  }
  return result as ObservationMap[K];
}
/** Both inputs are observed surfaces. Parsing a detached copy never executes scripts or event handlers. */
export function scanPasteSafety(serialized: string, root: ParentNode): { forbiddenFound: string[] } {
  const found = new Set<string>();
  const safeURL = (value: string, image: boolean, rendered: boolean) =>
    (image && /^data:image\//i.test(value)) || (image && rendered && /^(asset|tauri):\/\//.test(value)) || isSafeHref(value);
  const scan = (surface: ParentNode, label: string) => {
    for (const element of surface.querySelectorAll('*')) {
      if (element.tagName.toLowerCase() === 'script') found.add(`${label}:script`);
      for (const attribute of element.attributes) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on')) found.add(`${label}:${name}`);
        if (['href', 'src', 'xlink:href'].includes(name) && !safeURL(attribute.value, element.tagName.toLowerCase() === 'img' && name === 'src', label === 'dom')) {
          found.add(`${label}:${name}:${attribute.value}`);
        }
      }
    }
  };
  scan(new DOMParser().parseFromString(serialized, 'text/html'), 'serialized'); scan(root, 'dom');
  // Markdown destinations do not become DOM attributes when parsed as HTML.
  for (const match of serialized.matchAll(/(!?)\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)) {
    const value = match[2] ?? match[3];
    if (!safeURL(value, match[1] === '!', false)) found.add(`serialized:${match[1] ? 'src' : 'href'}:${value}`);
  }
  return { forbiddenFound: [...found].sort() };
}
