/** Text-only container traversal and literal shielding for the approved reference transforms. */
function htmlClosingMarker(line: string): RegExp | undefined {
  if (/^ {0,3}<!--/.test(line)) return /-->/;
  if (/^ {0,3}<\?/.test(line)) return /\?>/;
  if (/^ {0,3}<!\[CDATA\[/.test(line)) return /\]\]>/;
  const tag = line.match(/^ {0,3}<(div|pre|script|style|textarea|table|section|article|aside|details|blockquote|ul|ol)\b/i);
  return tag ? new RegExp(`</${tag[1]}\\s*>`, 'i') : undefined;
}
export function mapContainerText(text: string, transform: (text: string) => string): string {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const output: string[] = [];
  const literals: string[] = [];
  const marker = '\u0000MIG001block';
  if (text.includes(marker)) throw new Error('reference transform: reserved block sentinel');
  let plain = '';
  const flush = () => { output.push(plain); plain = ''; };
  const preserve = (value: string) => {
    const lf = value.endsWith('\n');
    const token = `${marker}${literals.length}\u0000`;
    literals.push(lf ? value.slice(0, -1) : value);
    output.push(token + (lf ? '\n' : ''));
  };
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    const html = htmlClosingMarker(line);
    if (fence || html || /^(?: {4}|\t)\S/.test(line)) {
      flush();
      const literal = [line]; i++;
      if (fence) {
        const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*(?:\\n)?$`);
        while (i < lines.length) { const next = lines[i++]; literal.push(next); if (close.test(next)) break; }
      } else if (html) {
        while (!html.test(literal.join('')) && i < lines.length) literal.push(lines[i++]);
      } else {
        while (i < lines.length && (/^(?: {4}|\t)/.test(lines[i]) || (/^[ \t]*\n$/.test(lines[i]) && /^(?: {4}|\t)/.test(lines[i + 1] ?? '')))) literal.push(lines[i++]);
      }
      preserve(literal.join('')); continue;
    }
    if (/^ {0,3}>/.test(line)) {
      flush();
      const quote: string[] = [];
      const original: string[] = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) { original.push(lines[i]); quote.push(lines[i++].replace(/^ {0,3}> ?/, '')); }
      const inner = mapContainerText(quote.join(''), transform);
      const changed = inner.match(/[^\n]*\n|[^\n]+$/g) ?? [];
      preserve(changed.length === original.length
        ? changed.map((body, index) => (original[index].match(/^ {0,3}> ?/)?.[0] ?? '> ') + body).join('')
        : inner.replace(/(^|\n)([^\n]+)/g, '$1> $2').replace(/\n(?=\n)/g, '\n>'));
      continue;
    }
    const item = line.match(/^( {0,3})(?:[-+*]|\d+[.)])([ \t]+)(.*?)(\n)?$/);
    if (item) {
      flush();
      const prefix = line.slice(0, line.length - item[3].length - (item[4]?.length ?? 0));
      const indent = prefix.length;
      const original = [line];
      const body = [item[3] + (item[4] ?? '')]; i++;
      while (i < lines.length) {
        if (/^[ \t]*\n$/.test(lines[i])) {
          let next = i;
          while (next < lines.length && /^[ \t]*\n$/.test(lines[next])) next++;
          if (next < lines.length && !lines[next].startsWith(' '.repeat(indent))) break;
          while (i < next) { original.push(lines[i]); body.push('\n'); i++; }
          continue;
        }
        if (lines[i].startsWith(' '.repeat(indent))) { original.push(lines[i]); body.push(lines[i++].slice(indent)); continue; }
        break;
      }
      const inner = mapContainerText(body.join(''), transform);
      if (inner === body.join('')) { preserve(original.join('')); continue; }
      const changed = inner.match(/[^\n]*\n|[^\n]+$/g) ?? [];
      if (changed.length === original.length) {
        preserve(changed.map((value, index) => index === 0 ? prefix + value : (/^[ \t]*\n$/.test(original[index]) ? original[index] : ' '.repeat(indent) + value)).join(''));
        continue;
      }
      const rebuilt = inner.replace(/\n(?=[^\n])/g, '\n' + ' '.repeat(indent));
      preserve(prefix + rebuilt); continue;
    }
    plain += line; i++;
  }
  flush();
  return transform(output.join('')).replace(/\u0000MIG001block(\d+)\u0000/g, (_, index: string) => literals[Number(index)]);
}

/** Shield inline code and tags without asking an editor or Markdown parser to interpret them. */
export function shieldInline(text: string, transform: (text: string) => string): string {
  const literals: string[] = [];
  const prefix = '\u0000MIG001literal';
  if (text.includes(prefix)) throw new Error('reference transform: reserved literal sentinel');
  const protectedText = text.replace(/(`+)([\s\S]*?)\1(?!`)|<(?!br\s*\/?\s*>)[^>]*>/gi, value => {
    const token = `${prefix}${literals.length}\u0000`; literals.push(value); return token;
  });
  return transform(protectedText).replace(/\u0000MIG001literal(\d+)\u0000/g, (_, index: string) => literals[Number(index)]);
}
