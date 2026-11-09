import { expect, it } from 'vitest';
import { classifyLinkActivation } from './support/corpus/linkActivationEffects.ts';
import type { LinkEffects } from './support/corpus/linkActivationEffects.ts';
const blocked = { event: 'editor.milkdown.link.blocked', context: { reason: 'scheme' } };
const inDocument = { event: 'editor.milkdown.link.in_document' };
const base: LinkEffects = { hrefPresent: true, defaultPrevented: true, propagated: true, openerCalls: [], events: [] };
it.each([
  ['scheme refusal', { ...base, propagated: false, events: [blocked] }, { outcome: 'refused', reason: 'scheme', defaultPrevented: true, propagated: false, openerCalls: [] }],
  ['resolved refusal', { ...base, propagated: false, events: [{ ...blocked, context: { reason: 'resolved-mismatch' } }] }, { outcome: 'refused', reason: 'resolved-mismatch', defaultPrevented: true, propagated: false, openerCalls: [] }],
  ['external', { ...base, openerCalls: ['https://example.test/x'] }, { outcome: 'external', defaultPrevented: true, propagated: true, openerCalls: ['https://example.test/x'] }],
  ['same app', { ...base, events: [inDocument] }, { outcome: 'same-app', defaultPrevented: true, propagated: true, openerCalls: [] }],
  ['missing href', { ...base, hrefPresent: false }, { outcome: 'no-href', defaultPrevented: true, propagated: true, openerCalls: [] }],
] as const)('classifies exact observed %s effects', (_name, effects, expected) => {
  expect(classifyLinkActivation('j-effects', effects)).toEqual(expected);
});
it.each([
  ['blocked yet propagated', { ...base, events: [blocked] }],
  ['in document plus opener', { ...base, events: [inDocument], openerCalls: ['https://example.test'] }],
  ['not cancelled', { ...base, defaultPrevented: false }],
  ['both events', { ...base, events: [blocked, inDocument] }],
  ['duplicate blocked', { ...base, propagated: false, events: [blocked, blocked] }],
  ['duplicate in document', { ...base, events: [inDocument, inDocument] }],
  ['two opener calls', { ...base, openerCalls: ['https://example.test', 'https://example.test'] }],
  ['unknown reason', { ...base, propagated: false, events: [{ ...blocked, context: { reason: 'unknown' } }] }],
  ['unknown event', { ...base, events: [{ event: 'editor.milkdown.link.open', status: 'fail' }] }],
  ['href and no effects', base],
  ['missing href yet opener', { ...base, hrefPresent: false, openerCalls: ['https://example.test'] }],
  ['missing href yet log', { ...base, hrefPresent: false, events: [inDocument] }],
  ['missing href stopped', { ...base, hrefPresent: false, propagated: false }],
  ['external stopped', { ...base, propagated: false, openerCalls: ['https://example.test'] }],
] as const)('fails closed for %s', (_name, effects) => {
  expect(() => classifyLinkActivation('j-impossible', effects)).toThrow(/j-impossible: unclassified activation/);
});
