export function phaseRunnerSource(runnersUrl, getFnUrl) {
  return `
import { VitestTestRunner } from ${JSON.stringify(runnersUrl)};
import { getCurrentTest, getFn, test as baseTest } from ${JSON.stringify(getFnUrl)};
import { AsyncLocalStorage } from "node:async_hooks";
const attemptContext = new AsyncLocalStorage();
const phaseContext = new AsyncLocalStorage();
const attemptTask = new WeakMap();
const patched = new WeakSet();
const trackedResults = new WeakSet();
const errorOwners = new WeakMap();
const originalPush = Array.prototype.push;
Array.prototype.push = function(...incoming) {
  const test = errorOwners.get(this);
  const attempt = test?.meta.__unitRed?.attempts.at(-1);
  const origin = phaseContext.getStore();
  if (attempt) {
    if (origin?.attempt === attempt) {
      if (origin.phase === "body") attempt.bodyFailure = true;
      else attempt.nonBody = true;
    } else if (attempt.pendingBodyThrown > 0) {
      attempt.pendingBodyThrown -= incoming.length;
      attempt.bodyFailure = true;
    } else if (attempt.pendingCountThrown > 0) {
      attempt.pendingCountThrown -= incoming.length;
      attempt.countFailure = true;
    } else attempt.nonBody = true;
  }
  return Reflect.apply(originalPush, this, incoming);
};
function trackErrors(test) {
  const result = test.result;
  if (trackedResults.has(result)) return;
  trackedResults.add(result);
  let value = result.errors;
  Object.defineProperty(result, "errors", {
    configurable: true, enumerable: true,
    get() { return value; },
    set(next) { value = next; if (Array.isArray(next)) errorOwners.set(next, test); },
  });
  if (Array.isArray(value)) errorOwners.set(value, test);
}
function instrumentTest(api) {
  const target = api.fn || api; if (patched.has(target)) return api; patched.add(target);
  const extend = target.extend, guardedExtend = function(fixtures) {
    const wrapped = Object.fromEntries(Object.entries(fixtures).map(([name, value]) => {
      const array = Array.isArray(value), fn = array ? value[0] : value; if (typeof fn !== "function") return [name, value];
      const guarded = function(context, use) {
        const attempt = attemptContext.getStore() || (context?.task || getCurrentTest())?.meta?.__unitRed?.attempts?.at(-1);
        const task = attemptTask.get(attempt) || context?.task || getCurrentTest();
        const errors = () => task?.result?.errors?.length || 0;
        const setupStart = errors();
        let teardownStart;
        const mark = () => { if (attempt) attempt.nonBody = true; };
        const guardedUse = async (fixtureValue) => {
          if (errors() > setupStart) mark();
          await use(fixtureValue);
          teardownStart = errors();
        };
        try {
          return Promise.resolve(phaseContext.run({ attempt, phase: "fixture" }, () => fn.call(this, context, guardedUse))).then((result) => {
            if (errors() > (teardownStart ?? setupStart)) mark();
            return result;
          }, (error) => { mark(); throw error; });
        }
        catch (error) { mark(); throw error; }
      };
      guarded.toString = () => fn.toString(); if ("__VITEST_FIXTURE_INDEX__" in fn) guarded.__VITEST_FIXTURE_INDEX__ = fn.__VITEST_FIXTURE_INDEX__;
      return [name, array ? [guarded, value[1]] : guarded]; }));
    return instrumentTest(extend.call(this, wrapped));
  };
  target.extend = guardedExtend; api.extend = guardedExtend;
  return api;
}
export default class PhaseRunner extends VitestTestRunner {
  constructor(config) { super(config); instrumentTest(baseTest); } current(test) { return test.meta.__unitRed?.attempts.at(-1); }
  finish(test) {
    const attempt = this.current(test);
    if (attempt?.boundary !== undefined && (test.result.errors?.length || 0) > attempt.boundary) attempt.nonBody = true;
  }
  onBeforeTryTask(test, info) {
    this.finish(test);
    const attempt = { retry: info.retry, repeats: info.repeats, preHookErrors: test.result.errors?.length || 0 };
    (test.meta.__unitRed ??= { attempts: [] }).attempts.push(attempt);
    attemptTask.set(attempt, test);
    trackErrors(test);
    return super.onBeforeTryTask(test, info);
  }
  async runTask(test) {
    const attempt = this.current(test);
    if ((test.result.errors?.length || 0) > attempt.preHookErrors) attempt.nonBody = true;
    attempt.started = true;
    const fn = getFn(test);
    if (!fn) { attempt.nonBody = true; throw Error("Test function missing"); }
    const timeout = Number(test.timeout);
    let timer;
    const deadline = new Promise((_, reject) => {
      if (Number.isFinite(timeout) && timeout > 0) timer = setTimeout(() => { attempt.nonBody = true; reject(Error("Test body timed out")); }, timeout);
    });
    try { const body = phaseContext.run({ attempt, phase: "body" }, () => attemptContext.run(attempt, () => fn())); if (timer) await Promise.race([deadline, body]); else await body; }
    catch (error) {
      if (test.context?.signal?.aborted && test.context.signal.reason === error) attempt.nonBody = true;
      else if (!attempt.nonBody) { attempt.bodyFailure = true; attempt.pendingBodyThrown = Array.isArray(error) ? error.length : 1; }
      throw error;
    }
    finally { clearTimeout(timer); attempt.completed = true; }
  }
  onAfterTryTask(test, info) {
    try { return super.onAfterTryTask(test, info); }
    catch (error) { const attempt = this.current(test); attempt.countFailure = true; attempt.pendingCountThrown = 1; throw error; }
  }
  onTaskFinished(test) {
    const attempt = this.current(test);
    if (!attempt) return;
    if (!attempt.started) attempt.nonBody = true;
    attempt.boundary = test.result.errors?.length || 0;
  }
  onAfterRunTask(test) { this.finish(test); return super.onAfterRunTask(test); }
}
`;
}
