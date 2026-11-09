/** Guard fixtures commit authenticated UTF-8 JSON with exactly {text:string, repeat:nonnegative integer}. */
import { createHash } from 'node:crypto';
import { isObject } from './metadataActions.ts';
export function expandRecipe(bytes: string, sha256: string, caseId: string): string {
  try {
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('recipe sha256 mismatch');
    const value: unknown = JSON.parse(bytes);
    if (!isObject(value) || Object.keys(value).length !== 2 || typeof value.text !== 'string' ||
        typeof value.repeat !== 'number' || !Number.isSafeInteger(value.repeat) || value.repeat < 0 ||
        !Number.isSafeInteger(value.text.length * value.repeat)) throw new Error('recipe requires exactly text and a safe nonnegative integer repeat');
    return value.text.repeat(value.repeat);
  } catch (error) { throw new Error(`${caseId}: ${error instanceof Error ? error.message : String(error)}`); }
}
