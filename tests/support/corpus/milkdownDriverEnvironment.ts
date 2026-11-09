/** Supply only layout APIs absent in jsdom; editor/plugin logic remains production code. */
export function installDriverDOMBoundary(): () => void {
  const prototype = Range.prototype as unknown as Record<string, unknown>;
  const added: string[] = [];
  for (const name of ['getClientRects', 'getBoundingClientRect']) {
    if (typeof prototype[name] === 'function') continue;
    added.push(name);
    prototype[name] = name === 'getClientRects' ? () => [] : () => new DOMRect(0, 0, 0, 0);
  }
  return () => { for (const name of added) delete prototype[name]; };
}
