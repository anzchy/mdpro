/** Plain-text inline projection. Protected code spans retain literal whitespace, while prose whitespace collapses. */
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] !== '#') return entities[entity] ?? whole;
    const point = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}
export function inlineProjection(raw: string): { text: string; protectedRanges: [number, number][] } {
  const protectedText: string[] = [], codeProtection: boolean[] = [];
  const protect = (text: string, code = false) => { codeProtection.push(code); return `\uE000${protectedText.push(text) - 1}\uE001`; };
  let text = raw.replace(/(`+)([\s\S]*?)\1(?!`)/g, (_all, _ticks, body: string) => protect(body, true));
  text = text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, (_all, character: string) => protect(character));
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1').replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  text = text.replace(/<\/?(?:u|strong|em|s|del|mark|span|a|img)\b[^>]*>/gi, '');
  text = text.replace(/<br\s*\/?\s*>/gi, '\n').replace(/\\\n/g, '\n');
  text = text.replace(/^ {0,3}#{1,6}[ \t]+/gm, '').replace(/[ \t]+#+[ \t]*$/gm, '');
  text = text.replace(/\n(?:=+|-+)[ \t]*$/g, '').replace(/(?:\*\*|__|~~|==|\*|_)/g, '');
  text = decodeEntities(text).replace(/\s+/g, ' ').trim();
  const ranges: [number, number][] = [];
  let output = '', previous = 0;
  for (const match of text.matchAll(/\uE000(\d+)\uE001/g)) {
    output += text.slice(previous, match.index);
    const content = protectedText[Number(match[1])];
    if (codeProtection[Number(match[1])]) ranges.push([output.length, output.length + content.length]);
    output += content; previous = match.index! + match[0].length;
  }
  output += text.slice(previous);
  return { text: output, protectedRanges: ranges };
}
