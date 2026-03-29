export interface HighlightMatch {
  openStart: number;
  openEnd: number;
  innerStart: number;
  innerEnd: number;
  closeStart: number;
  closeEnd: number;
}

function isEscaped(text: string, index: number): boolean {
  if (index <= 0) return false;
  let slashCount = 0;
  let i = index - 1;
  while (i >= 0 && text[i] === "\\") {
    slashCount += 1;
    i -= 1;
  }
  return slashCount % 2 === 1;
}

export function findHighlightMatches(text: string): HighlightMatch[] {
  const matches: HighlightMatch[] = [];

  let i = 0;
  while (i < text.length - 1) {
    if (text[i] === "=" && text[i + 1] === "=" && !isEscaped(text, i)) {
      let close = i + 2;
      let foundClose = -1;
      while (close < text.length - 1) {
        if (text[close] === "=" && text[close + 1] === "=" && !isEscaped(text, close)) {
          foundClose = close;
          break;
        }
        close += 1;
      }

      if (foundClose !== -1 && foundClose > i + 2) {
        matches.push({
          openStart: i,
          openEnd: i + 2,
          innerStart: i + 2,
          innerEnd: foundClose,
          closeStart: foundClose,
          closeEnd: foundClose + 2,
        });
        i = foundClose + 2;
        continue;
      }
    }

    i += 1;
  }

  return matches;
}

function isInsideIgnoredTag(node: Node | null): boolean {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const tag = (current as Element).tagName.toLowerCase();
      if (tag === "code" || tag === "pre" || tag === "script" || tag === "style") {
        return true;
      }
    }
    current = current.parentNode;
  }
  return false;
}

/**
 * Convert ==text== syntax in an HTML string to <mark> elements.
 *
 * Operates on individual DOM text nodes, so highlight spans that cross
 * element boundaries (e.g. ==**bold**==) are not converted here.
 * Those are handled by the Milkdown remark plugin in WYSIWYG mode, and by
 * the Rust pre-pass (preprocess_highlight) in preview/split mode.
 */
export function renderHighlightSyntaxInHtml(html: string): string {
  if (!html.includes("==")) return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.nodeValue ?? "";
    if (!text.includes("==")) continue;
    if (isInsideIgnoredTag(textNode.parentNode)) continue;

    const matches = findHighlightMatches(text);
    if (matches.length === 0) continue;

    const fragment = doc.createDocumentFragment();
    let cursor = 0;

    for (const match of matches) {
      if (cursor < match.openStart) {
        fragment.appendChild(doc.createTextNode(text.slice(cursor, match.openStart)));
      }

      const markEl = doc.createElement("mark");
      markEl.textContent = text.slice(match.innerStart, match.innerEnd);
      fragment.appendChild(markEl);
      cursor = match.closeEnd;
    }

    if (cursor < text.length) {
      fragment.appendChild(doc.createTextNode(text.slice(cursor)));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return body.innerHTML;
}
