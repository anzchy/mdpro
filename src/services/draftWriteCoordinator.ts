/** Coordinates autosave writes with an explicit window Discard. */
const pending = new Map<string, Set<Promise<unknown>>>();
const suspended = new Map<string, number>();
const revisions = new Map<string, { revision: string; saveOrder: number }>();

/** The last completed save for this document in this window. */
export function lastSavedDraftRevision(documentId: string): string | undefined {
  return revisions.get(documentId)?.revision;
}

/** Record a successful draft write; callers outside autosave may use this too. */
export function rememberDraftRevision(documentId: string, revision: string): void {
  if (revision) revisions.set(documentId, { revision, saveOrder: -1 });
}

export function forgetDraftRevision(documentId: string): void {
  revisions.delete(documentId);
}

export function draftWritesSuspended(documentId: string): boolean {
  return (suspended.get(documentId) ?? 0) > 0;
}

export async function trackDraftWrite(documentId: string, write: () => Promise<{ revision: string; saveOrder?: number }>): Promise<void> {
  if (draftWritesSuspended(documentId)) return;
  const task = write();
  const writes = pending.get(documentId) ?? new Set<Promise<unknown>>();
  writes.add(task);
  pending.set(documentId, writes);
  try {
    const result = await task;
    if (result?.revision) {
      const order = result.saveOrder ?? -1;
      const current = revisions.get(documentId);
      if (!current || order >= current.saveOrder) revisions.set(documentId, { revision: result.revision, saveOrder: order });
    }
  }
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
