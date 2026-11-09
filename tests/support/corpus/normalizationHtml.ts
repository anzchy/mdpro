/** Reference tag stripping preserves block boundaries and literal preformatted whitespace. */
export function htmlText(html: string): string {
  const block = /^(?:p|div|section|article|blockquote|li|h[1-6]|pre|tr)$/;
  const stack: { name: string; content: boolean }[] = [];
  let result = '';
  let separator = 0;
  const append = (value: string) => {
    if (!value) return;
    if (result && separator) result += '\n'.repeat(separator);
    separator = 0;
    result += value;
    for (const item of stack) item.content = true;
  };
  for (const token of html.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+|</g) ?? []) {
    if (token.startsWith('<!--')) continue;
    const tag = token.match(/^<\s*(\/?)\s*([a-z][\w-]*)\b[^>]*>$/i);
    if (!tag) { append(decodeEntities(token)); continue; }
    const name = tag[2].toLowerCase();
    if (name === 'br' && !tag[1]) { append('\n'); continue; }
    if (!block.test(name)) continue;
    if (!tag[1]) {
      if (result && stack.length === 0) separator = Math.max(separator, 2);
      stack.push({ name, content: false });
    } else {
      const at = stack.map(item => item.name).lastIndexOf(name);
      const item = at >= 0 ? stack.splice(at)[0] : undefined;
      separator = item && !item.content ? separator + 2 : Math.max(separator, 2);
    }
  }
  return result;
}
function decodeEntities(text: string): string {
  const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return text.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (original, entity: string) => {
    if (entity[0] !== '#') return names[entity.toLowerCase()] ?? original;
    const value = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '\ufffd';
  });
}
