/**
 * Purpose: Make runtime-generated test registrations fail during collection when no case exists.
 * @coordinates-with scripts/lint/conditional-tests.mjs, tests/tooling/adr128-vanishing-registration.test.ts
 */
export function collectionCases<T>(name: string, items: Iterable<T>): T[] {
  const cases = Array.from(items);
  if (cases.length === 0) throw Error(`empty collection: ${name}`);
  return cases;
}
