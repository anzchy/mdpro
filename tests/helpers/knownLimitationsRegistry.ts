/** Validate row-local known limitations before a characterization PR can land. */
export function validateKnownLimitations(row: string, value: unknown): string[] {
  if (!Array.isArray(value)) return ['registry: array'];
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      errors.push(`record ${index}: object`);
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : `record ${index}`;
    if (typeof record.id !== 'string' || !new RegExp(`^${row}-KL[1-9][0-9]*$`).test(record.id) || ids.has(record.id)) {
      errors.push(`${id}: id`);
    }
    ids.add(id);
    for (const field of ['clause', 'current', 'desired', 'reason']) {
      if (typeof record[field] !== 'string' || !record[field].trim()) errors.push(`${id}: ${field}`);
    }
    if (typeof record.clause === 'string' && record.clause.trim() &&
      !new RegExp(`^${row}-C(?:[1-9][0-9]*|S)$`).test(record.clause)) errors.push(`${id}: clause`);
    if (typeof record.ref !== 'string' || !/^(?:#[1-9][0-9]*|D[1-9][0-9]*)$/.test(record.ref)) errors.push(`${id}: ref`);
    if (record.strictModeOnly !== undefined && typeof record.strictModeOnly !== 'boolean') errors.push(`${id}: strictModeOnly`);
    if (record.observable !== undefined && typeof record.observable !== 'boolean') errors.push(`${id}: observable`);
  }
  return errors;
}
