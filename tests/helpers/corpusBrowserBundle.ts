/**
 * Test-only proof seam for MIG-003c0 AC-3: bundles one corpus module for the browser with Vite's own esbuild and
 * evaluates it in a fresh VM realm that has no `process`, `Buffer`, `require` or `node:crypto`. A `node:` import fails
 * the bundle by itself. Not part of the corpus graph; nothing under tests/support/corpus imports it.
 */
import { createRequire } from 'node:module';
import vm from 'node:vm';

interface EsbuildResult { outputFiles: { text: string }[]; metafile: { inputs: Record<string, unknown> } }
interface Esbuild { build(options: Record<string, unknown>): Promise<EsbuildResult> }
interface WindowRealm { window: Record<string, unknown>; getInternalVMContext(): vm.Context }
type JsdomConstructor = new (html: string, options: Record<string, unknown>) => WindowRealm;
const localRequire = createRequire(import.meta.url);
// jsdom ships no type declarations; the two members used here are typed locally.
const { JSDOM } = localRequire('jsdom') as { JSDOM: JsdomConstructor };
// esbuild is Vite's dependency, not ours; resolving it through Vite adds no dependency and no config.
const esbuild = createRequire(localRequire.resolve('vite'))('esbuild') as Esbuild;
const GLOBAL_NAME = '__corpusBrowserModule';
// `in` reads no getter, so a test that counts reads of an accessor global sees only the module's own reads.
const NODE_ONLY_PROBE = '["process", "Buffer", "require"].filter(name => name in globalThis).join(",")';
export const NODE_ONLY_ABSENT = '';

export interface BrowserBundle { code: string; inputs: string[] }
export interface BrowserModule<T> { exports: T; nodeOnlyGlobals: string; inputs: string[] }

export async function bundleForBrowser(entry: string): Promise<BrowserBundle> {
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, platform: 'browser', format: 'iife', globalName: GLOBAL_NAME,
    write: false, metafile: true, logLevel: 'silent',
    // A browser build injects stylesheets; the proof needs only the module graph to evaluate.
    loader: { '.css': 'empty' },
  });
  return { code: result.outputFiles[0].text, inputs: Object.keys(result.metafile.inputs) };
}

/** A bare realm: only the JS built-ins plus the encoding globals and structuredClone every browser has. */
export async function loadInBareRealm<T>(entry: string): Promise<BrowserModule<T>> {
  const bundle = await bundleForBrowser(entry);
  const context = vm.createContext({ TextEncoder, TextDecoder, structuredClone });
  vm.runInContext(bundle.code, context);
  return { exports: context[GLOBAL_NAME] as T, nodeOnlyGlobals: vm.runInContext(NODE_ONLY_PROBE, context) as string, inputs: bundle.inputs };
}

/** A fresh jsdom window realm, for modules whose graph reaches the editor and needs DOM globals at import. */
export async function loadInWindowRealm<T>(entry: string, prepare?: (window: Record<string, unknown>) => void): Promise<BrowserModule<T>> {
  const bundle = await bundleForBrowser(entry);
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const context = dom.getInternalVMContext();
  // jsdom's window lacks the WHATWG encoding globals and structuredClone that every browser realm provides.
  Object.assign(dom.window, { TextEncoder, TextDecoder, structuredClone });
  prepare?.(dom.window);
  vm.runInContext(bundle.code, context);
  return { exports: dom.window[GLOBAL_NAME] as T, nodeOnlyGlobals: vm.runInContext(NODE_ONLY_PROBE, context) as string, inputs: bundle.inputs };
}

/** Settles a load so a refused bundle (a `node:` import) reaches the test as data, asserted like any other outcome. */
export async function settle<T>(loading: Promise<BrowserModule<T>>): Promise<{ module?: BrowserModule<T>; failure?: string }> {
  try { return { module: await loading }; } catch (error) { return { failure: error instanceof Error ? error.message : String(error) }; }
}
