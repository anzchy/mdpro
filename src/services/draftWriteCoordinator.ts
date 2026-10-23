/** Coordinates autosave writes with an explicit window Discard. */
const pending = new Map<string, Set<Promise<unknown>>>();
const suspended = new Map<string, number>();

export function draftWritesSuspended(documentId: string): boolean {
  return (suspended.get(documentId) ?? 0) > 0;
}

export async function trackDraftWrite(documentId: string, write: () => Promise<unknown>): Promise<void> {
  if (draftWritesSuspended(documentId)) return;
  const task = write();
  const writes = pending.get(documentId) ?? new Set<Promise<unknown>>();
  writes.add(task);
  pending.set(documentId, writes);
  try { await task; }
  finally {
    writes.delete(task);
    if (writes.size === 0) pending.delete(documentId);
  }
}

/** Block new timer writes, then wait for every write already accepted for these IDs. */
export async function suspendAndDrainDrafts(documentIds: Iterable<string>): Promise<void> {
  const ids = [...documentIds];
  for (const id of ids) suspended.set(id, (suspended.get(id) ?? 0) + 1);
  await Promise.all(ids.flatMap((id) => [...(pending.get(id) ?? [])].map((task) => task.catch(() => undefined))));
}

/** Restore drafting if consent is vetoed or the close is cancelled. */
export function resumeDrafts(documentIds: Iterable<string>): void {
  for (const id of documentIds) {
    const count = suspended.get(id) ?? 0;
    if (count <= 1) suspended.delete(id);
    else suspended.set(id, count - 1);
  }
}
