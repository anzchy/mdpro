/**
 * @module tests/support/tokenDocs
 * Purpose: read design/DESIGN.md § Tokens for the token-parity gate
 * (tests/design-token-parity.test.ts, D278): the slice, its rows, the
 * Planned / Interim markers, and the P2, P4 and P5 checks. Pure functions
 * over text.
 */

/** The § Tokens slice of DESIGN.md, the same slice the other token tests read. Throws rather than pass empty. */
export function tokensSlice(design: string): string {
  const start = design.indexOf("\n## Tokens");
  const end = design.indexOf("\n## Layout");
  if (start < 0 || end < 0 || end < start) throw new Error("DESIGN.md has no `## Tokens` … `## Layout` slice");
  return design.slice(start, end);
}

/** token → its whole table row, for every row whose first cell opens with a backticked token. */
export function tableRows(design: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of tokensSlice(design).split("\n")) {
    const m = /^\|\s*`(--[\w-]+)`/.exec(line);
    if (m) rows.set(m[1], line);
  }
  return rows;
}

export const MARKER = /\b(Planned|Interim) \((WI-[^)]+)\)/;

/** P2: rows naming an undeclared token without a `Planned` marker. */
export function undeclaredRows(design: string, tokens: ReadonlySet<string>): string[] {
  return [...tableRows(design)]
    .filter(([t, row]) => !tokens.has(t) && MARKER.exec(row)?.[1] !== "Planned")
    .map(([t]) => t)
    .sort();
}

/** P4: declared tokens nothing consumes. `sources` are app source texts, comments blanked. */
export function unconsumed(tokens: Iterable<string>, sources: string[]): string[] {
  const text = sources.join("\n");
  return [...tokens]
    .filter((t) => !text.includes(`var(${t}`) && !text.includes(`"${t}"`) && !text.includes(`'${t}'`))
    .sort();
}

/** P5: marker defects, and required Interim markers that are missing. */
export function markerDefects(design: string, tokens: ReadonlySet<string>, interim: Record<string, string>): string[] {
  const out: string[] = [];
  const rows = tableRows(design);
  for (const [t, row] of rows) {
    const m = MARKER.exec(row);
    if (!m) continue;
    if (m[1] === "Planned" && tokens.has(t)) out.push(`${t}: Planned but declared`);
    if (m[1] === "Interim" && !tokens.has(t)) out.push(`${t}: Interim but not declared`);
  }
  for (const [t, wi] of Object.entries(interim)) {
    const m = MARKER.exec(rows.get(t) ?? "");
    if (!m || m[1] !== "Interim" || m[2] !== wi) out.push(`${t}: needs Interim (${wi})`);
  }
  return out.sort();
}
