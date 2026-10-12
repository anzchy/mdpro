/**
 * Purpose: the frontend close rule for watch holds (D173, ADR-0086 decision 3). A window
 * releases its hold on a path with `release_watch_hold({ path, gen })` once no document
 * in it holds that path and no in-flight open or Save As has reserved it, carrying the
 * latest gen it saw, so a release that races a reopen is `stale` in Rust and changes
 * nothing. `close_document` no longer unwatches.
 *
 * Pipeline: a `documents` change → every path a document held before and none holds now
 *   becomes a candidate (`watchHoldLedger.markCandidate`) → `releaseUnheld` → each
 *   releasable path → `fileService.releaseWatchHold` (fire-and-forget). A capture
 *   (`reserveWatchHold`) defers its path until it settles, then runs the same check.
 *
 * Key decisions:
 * - **Decided after the store change, never from a snapshot before it.** One
 *   documentStore subscription runs after every close, path move and open, so two
 *   same-path tabs closing in one tick release once, and a close cannot release a
 *   reopen's newer hold.
 * - **Never throws.** A rejected release is logged as `file.watch.release` `fail` (warn)
 *   and dropped: the watch is then kept too long, never too short.
 * - Wired by import: `fileChangeCapture.ts` (and so `useDocument`, which every window
 *   mounts through App) imports this module, whose subscription installs at load, the
 *   way `externalChangeStore` prunes.
 * - Logs carry the gen and Rust's outcome, never the path.
 *
 * @coordinates-with src/utils/watchHoldLedger.ts — the gens, reservations and candidates
 * @coordinates-with src/utils/fileChangeCapture.ts — reserves each open / Save As path
 * @coordinates-with src/services/fileService.ts — `releaseWatchHold`
 * @coordinates-with src-tauri/src/commands/watch_hold.rs — `release_watch_hold`
 * @module utils/watchHolds
 */
import { fileService } from "../services/fileService";
import { loggingService } from "../services/loggingService";
import { useDocumentStore } from "../stores/documentStore";
import type { Document } from "../types/document";
import { markCandidate, reservePath, takeReleasable, unreservePath } from "./watchHoldLedger";

const RELEASE_EVENT = "file.watch.release";

function heldPaths(documents: Document[]): Set<string> {
  const held = new Set<string>();
  for (const doc of documents) if (doc.path) held.add(doc.path);
  return held;
}

async function release(path: string, gen: number): Promise<void> {
  try {
    const outcome = await fileService.releaseWatchHold(path, gen);
    loggingService.logEventSync({
      level: "info",
      event: RELEASE_EVENT,
      status: "success",
      context: { source: "frontend", gen, outcome },
    });
  } catch (error: unknown) {
    loggingService.logEventSync({
      level: "warn",
      event: RELEASE_EVENT,
      status: "fail",
      context: { source: "frontend", gen },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Release every candidate path this window holds a gen for and no document holds. */
export function releaseUnheld(): void {
  const held = heldPaths(useDocumentStore.getState().documents);
  for (const { path, gen } of takeReleasable((p) => held.has(p))) void release(path, gen);
}

/**
 * Reserve `path` (null: every path) for an in-flight open or Save As. Call the returned
 * function once it settled; later calls do nothing.
 */
export function reserveWatchHold(path: string | null): () => void {
  reservePath(path);
  let settled = false;
  return () => {
    if (settled) return;
    settled = true;
    unreservePath(path);
    releaseUnheld();
  };
}

useDocumentStore.subscribe((state, previous) => {
  if (state.documents === previous.documents) return;
  const now = heldPaths(state.documents);
  for (const path of heldPaths(previous.documents)) if (!now.has(path)) markCandidate(path);
  releaseUnheld();
});
