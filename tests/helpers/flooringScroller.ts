/**
 * Purpose: model WebKit's integer `scrollTop` snapping on a `scriptedScrollGeometry`
 * scroller — every write (the `scrollTop` setter and `scrollTo`) is floored before the
 * fixture clamps it. Wraps the fixture from outside because `scriptedScrollGeometry.ts`
 * is fingerprinted by the D17-WI-3 receipt and must not change.
 *
 * Why it matters: a heading at a fractional content offset, landed by
 * `scrollTop + rel − 40` and then floored, sits at 40.x px — past the spy's `top <= 40`
 * line — so the spy picks the previous heading.
 */

/** Floor every write to `scroller`'s scripted `scrollTop`. Call after `mountScriptedSurface`. */
export function floorScrollWrites(scroller: HTMLElement): void {
  const desc = Object.getOwnPropertyDescriptor(scroller, "scrollTop");
  const get = desc?.get;
  const set = desc?.set;
  if (!get || !set) throw new Error("floorScrollWrites: scroller has no scripted scrollTop");
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get,
    set: (v: number) => set.call(scroller, Math.floor(v)),
  });
  const scrollTo = scroller.scrollTo.bind(scroller);
  scroller.scrollTo = ((arg?: ScrollToOptions | number, y?: number) => {
    if (typeof arg === "number") scrollTo(arg, Math.floor(y ?? 0));
    else scrollTo({ ...arg, top: arg?.top === undefined ? undefined : Math.floor(arg.top) });
  }) as HTMLElement["scrollTo"];
}
