/** D178 slot transition for a watcher event, extracted to keep the store small. */
import type { Document } from "../types/document";
import type { FileChangedEvent, PendingFileChange } from "../types/fileChange";

/** A slot that is only a rename not yet followed. */
export function pendingRenameTarget(slot: PendingFileChange | undefined): string | undefined {
  return slot?.event.changeType === "renamed" ? slot.event.newPath : undefined;
}

/** The slot `event` leaves for `doc`, and the path it moves to now, if any. */
export function nextSlot(
  doc: Document & { path: string },
  prior: PendingFileChange | undefined,
  event: FileChangedEvent,
  base: Omit<PendingFileChange, "path" | "event">,
): { slot: PendingFileChange; moveTo?: string } {
  const newPath = event.changeType === "renamed" ? event.newPath : undefined;
  if (newPath !== undefined && prior && pendingRenameTarget(prior) === undefined) {
    const carried: FileChangedEvent = { path: newPath, changeType: "modified", timestamp: event.timestamp };
    return {
      slot: { ...base, path: newPath, event: carried, receivedAt: prior.receivedAt, source: prior.source },
      moveTo: newPath,
    };
  }
  if (doc.path !== event.path) {
    if (newPath !== undefined) return { slot: { ...base, path: doc.path, event: { ...event, path: doc.path } } };
    return { slot: { ...base, path: event.path, event }, moveTo: event.path };
  }
  return { slot: { ...base, path: event.path, event } };
}
