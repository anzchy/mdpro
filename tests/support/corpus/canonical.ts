/** Canonical JSON uses alphabetical keys recursively, array order intact, two spaces and one final LF. */
export function canonicalJson(value: unknown): string {
  function ordered(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(ordered);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered((item as Record<string, unknown>)[key])]));
    }
    return item;
  }
  return JSON.stringify(ordered(value), null, 2) + '\n';
}
