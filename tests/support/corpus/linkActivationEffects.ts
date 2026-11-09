/** Classify observed effects only. URL policy and resolution belong exclusively to the real production guard. */
import type { LinkActivation } from './types.ts';
export interface LinkEffectEvent { readonly event: string; readonly context?: Readonly<Record<string, unknown>>; readonly status?: string }
export interface LinkEffects {
  readonly hrefPresent: boolean; readonly defaultPrevented: boolean; readonly propagated: boolean;
  readonly events: readonly LinkEffectEvent[]; readonly openerCalls: readonly string[];
}
export function classifyLinkActivation(caseId: string, effects: LinkEffects): LinkActivation {
  const { hrefPresent, defaultPrevented, propagated, openerCalls, events } = effects;
  const reject = (): never => { throw new Error(`${caseId}: unclassified activation`); };
  if (!defaultPrevented) return reject();
  const observed = { defaultPrevented, propagated, openerCalls: [...openerCalls] };
  if (!hrefPresent) {
    if (propagated && !events.length && !openerCalls.length) return { outcome: 'no-href', ...observed };
    return reject();
  }
  if (events.length === 1 && !openerCalls.length) {
    const event = events[0];
    if (event.event === 'editor.milkdown.link.blocked' && !propagated) {
      const reason = event.context?.reason;
      if (reason === 'scheme' || reason === 'resolved-mismatch') return { outcome: 'refused', reason, ...observed };
    }
    if (event.event === 'editor.milkdown.link.in_document' && propagated) return { outcome: 'same-app', ...observed };
  }
  if (!events.length && propagated && openerCalls.length === 1) return { outcome: 'external', ...observed };
  return reject();
}
