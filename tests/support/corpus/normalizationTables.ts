/** GFM table cells, delimiters and end-padding, implemented as plain text reference transforms. */
function cells(line: string): string[] {
  let content = line.trim();
  if (content.startsWith('|')) content = content.slice(1);
  if (content.endsWith('|') && !content.endsWith('\\|')) content = content.slice(0, -1);
  const result: string[] = [];
  let current = '';
  let escaped = false;
  for (const char of content) {
    if (char === '|' && !escaped) { result.push(current.trim()); current = ''; }
    else current += char;
    escaped = char === '\\' && !escaped;
  }
  result.push(current.trim());
  return result;
}
const delimiter = (line: string) => line.includes('|') && cells(line).every(cell => /^:?-+:?$/.test(cell));
export function normalizeTables(text: string, widen: boolean): string {
  const lines = text.split('\n');
  for (let start = 0; start + 1 < lines.length; start++) {
    if (!lines[start].includes('|') || !delimiter(lines[start + 1])) continue;
    let end = start + 2;
    while (end < lines.length && lines[end].includes('|') && lines[end].trim()) end++;
    const matrix = lines.slice(start, end).map(cells);
    const alignment = matrix[1].map(cell => ({ left: cell.startsWith(':'), right: cell.endsWith(':') }));
    const width = Math.max(...matrix.filter((_, index) => index !== 1).map(row => row.length));
    const sizes = Array.from({ length: width }, (_, col) => {
      const a = alignment[col] ?? { left: false, right: false };
      return Math.max(1 + Number(a.left) + Number(a.right), ...matrix.filter((_, index) => index !== 1).map(row => (row[col] ?? '').length));
    });
    const formatted = matrix.map((row, rowIndex) => {
      const count = widen ? width : row.length;
      return '| ' + Array.from({ length: count }, (_, col) => {
        const a = alignment[col] ?? { left: false, right: false };
        if (rowIndex === 1) return (a.left ? ':' : '') + '-'.repeat(Math.max(1, sizes[col] - Number(a.left) - Number(a.right))) + (a.right ? ':' : '');
        const value = row[col] ?? '';
        const padding = sizes[col] - value.length;
        if (a.left && a.right) return ' '.repeat(Math.ceil(padding / 2)) + value + ' '.repeat(Math.floor(padding / 2));
        return a.right ? ' '.repeat(padding) + value : value + ' '.repeat(padding);
      }).join(' | ') + ' |';
    });
    lines.splice(start, end - start, ...formatted);
    start += formatted.length - 1;
  }
  return lines.join('\n');
}
