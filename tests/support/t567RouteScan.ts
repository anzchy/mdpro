/** Find active tracked references to the retired attack-prompt path. */
export function scanStalePromptPaths(entries: Record<string, string>): string[] {
  const oldSuffix = "templates/matrix-attack-prompt.md";
  return Object.entries(entries).filter(([file, text]) => text.includes(oldSuffix)
    && file !== "tests/tooling/t567-skill-contract.test.ts" // this scanner's own fixture mentions the retired suffix
    && file !== "tests/support/t567RouteScan.ts" // this scanner names its own search token
    && file !== "docs/reference/20261027-rules-70-71-history.md"
    && !/^docs\/specs\/567-tdd-skill\/r\d+\//.test(file)).map(([file]) => file);
}
