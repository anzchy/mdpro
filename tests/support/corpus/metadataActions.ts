/** Validate structural action/anchor payloads before any driver mutation. Runtime matching remains driver-owned. */
import { ACTION_KINDS } from './vocabulary.ts';
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export const positiveIndex = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;
export function actionErrors(value: unknown): string[] {
  const errors: string[] = [];
  const fail = (field: string) => errors.push(`action.${field}`);
  function selection(anchor: unknown, field: string, caret = false) {
    if (!isObject(anchor)) { fail(field + ' anchor'); return; }
    if (typeof anchor.text !== 'string' || anchor.text.length === 0 || (caret && anchor.text.includes('\n'))) fail(field + '.text anchor');
    if (anchor.occurrence !== undefined && !positiveIndex(anchor.occurrence)) fail(field + '.occurrence anchor');
    if (caret && anchor.edge !== 'before' && anchor.edge !== 'after') fail(field + '.edge anchor');
  }
  function cells(anchor: unknown, field: string, range: boolean) {
    const a = isObject(anchor) ? anchor[range ? 'cells' : 'cell'] : undefined;
    if (!isObject(a)) { fail(field + ' anchor'); return; }
    if (!positiveIndex(a.table)) fail(field + '.table anchor');
    if (range) {
      for (const end of ['from', 'to']) {
        if (!Array.isArray(a[end]) || a[end].length !== 2 || !a[end].every(positiveIndex)) fail(field + '.' + end + ' anchor');
      }
      if (Array.isArray(a.from) && Array.isArray(a.to) && (a.from[0] > a.to[0] || a.from[1] > a.to[1])) fail(field + ' reversed anchor');
    } else for (const name of ['row', 'col']) if (!positiveIndex(a[name])) fail(field + '.' + name + ' anchor');
  }
  if (!isObject(value) || !(ACTION_KINDS as readonly unknown[]).includes(value.kind)) return ['action.kind'];
  const a = value;
  const str = (field: string) => { if (typeof a[field] !== 'string') fail(field); };
  const bool = (field: string) => { if (typeof a[field] !== 'boolean') fail(field); };
  switch (a.kind) {
    case 'type': selection(a.at, 'at', true); str('text'); break;
    case 'delete': case 'clearFormat': selection(a.range, 'range'); break;
    case 'toggleMark':
      selection(a.range, 'range');
      if (!['strong', 'emphasis', 'code', 'strike', 'highlight', 'underline'].includes(String(a.mark))) fail('mark');
      break;
    case 'setListKind': selection(a.at, 'at', true); if (!['bullet', 'ordered'].includes(String(a.to))) fail('to'); break;
    case 'paste':
      if (isObject(a.at) && 'cells' in a.at) cells(a.at, 'at', true); else selection(a.at, 'at', true);
      if (typeof a.html !== 'string' && typeof a.text !== 'string') fail('html/text');
      if (a.html !== undefined && typeof a.html !== 'string') fail('html');
      if (a.text !== undefined && typeof a.text !== 'string') fail('text');
      break;
    case 'undo': break;
    case 'insertTableRow': case 'insertTableColumn':
      cells(a.at, 'at', false);
      if (!(a.kind === 'insertTableRow' ? ['above', 'below'] : ['left', 'right']).includes(String(a.side))) fail('side');
      break;
    case 'find': case 'replace':
      str('query'); bool('caseSensitive'); bool('wholeWord');
      if (a.kind === 'replace') { str('with'); bool('all'); }
      break;
    case 'modeSwitch': if (!['source', 'wysiwyg'].includes(String(a.to))) fail('to'); break;
    case 'activateLink': selection(a.link, 'link'); break;
    default: fail('kind');
  }
  return errors;
}
export function actionMutates(value: unknown): boolean {
  return !isObject(value) || !['find', 'modeSwitch', 'activateLink'].includes(String(value.kind));
}
