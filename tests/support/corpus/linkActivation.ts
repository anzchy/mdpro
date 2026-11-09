/** Observe a plain click through the mounted production hook, using only per-click boundary effects. */
import type { FakeTauriBoundary } from './fakeBoundary.ts';
import type { MilkdownDriverRuntime } from './milkdownDriverTypes.ts';
import type { LinkActivation, TextSelection } from './types.ts';
import { resolveTextAnchor } from './driverAnchors.ts';
import { classifyLinkActivation } from './linkActivationEffects.ts';
export async function clickLink(runtime: MilkdownDriverRuntime, boundary: FakeTauriBoundary, selection: TextSelection): Promise<LinkActivation> {
  const view = runtime.view(), { from, to } = resolveTextAnchor(runtime, selection);
  // Positions remain private. Resolve the actual rendered link enclosing the entire named selection.
  const links = [...view.dom.querySelectorAll('a')].filter(anchor =>
    view.posAtDOM(anchor, 0) <= from && view.posAtDOM(anchor, anchor.childNodes.length) >= to);
  if (links.length !== 1) throw new Error(`${runtime.caseId}: link anchor does not name exactly one rendered link`);
  const anchor = links[0], container = view.dom.closest('#milkdown-container');
  const ancestor = container?.parentElement;
  if (!ancestor) throw new Error(`${runtime.caseId}: link guard container has no bubble ancestor`);
  const hrefPresent = anchor.hasAttribute('href');
  const startEvent = boundary.events.length, startOpen = boundary.openerCalls.length;
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  let propagated = false;
  const onBubble = (event: Event) => { if (event === click) propagated = true; };
  ancestor.addEventListener('click', onBubble);
  try {
    anchor.dispatchEvent(click);
    // The guard imports this same native boundary asynchronously. Await it before reading the log.
    await import('@tauri-apps/plugin-opener');
    await new Promise(resolve => setTimeout(resolve, 0));
  } finally { ancestor.removeEventListener('click', onBubble); }
  return classifyLinkActivation(runtime.caseId, {
    hrefPresent, defaultPrevented: click.defaultPrevented, propagated,
    events: boundary.events.slice(startEvent).filter(event => event.event.startsWith('editor.milkdown.link.')),
    openerCalls: boundary.openerCalls.slice(startOpen),
  });
}
