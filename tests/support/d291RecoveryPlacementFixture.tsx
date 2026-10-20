/** D291 round-two recovery placement harness: real App callback sequence and stores. */
import { useState } from "react";
import { RecoveryDialog } from "../../src/components/common/RecoveryDialog";
import { Toast } from "../../src/components/common/Toast";
import { useDocument } from "../../src/hooks/useDocument";
import { recoverDraft, discardRecoveryDraft, type DraftMetadata } from "../../src/services/draftService";
import { useToastStore } from "../../src/stores/toastStore";
import { draftRecoveryOutcome, type DraftActionOutcome } from "../../src/utils/draftRecoveryOutcome";
import { applyRecoveredDocument } from "../../src/utils/recoverIntoOpenTab";

export const draft = (id: string, path: string | null = "/x/b.md"): DraftMetadata => ({
  id, originalPath: path, title: id, lastModified: "2026-10-20 12:00", recovered: false,
});

/** Mirrors App.applyDraftOutcome, handleRecoverDraft and handleDiscardDraft. */
export function RecoveryPlacementHarness({ rows }: { rows: DraftMetadata[] }) {
  const [drafts, setDrafts] = useState(rows);
  const { upsertAndActivateDocument } = useDocument();
  const toastMessage = useToastStore((state) => state.message);
  const showToast = useToastStore((state) => state.showToast);
  const applyOutcome = (id: string, input: DraftActionOutcome) => {
    const { dropRow, upsert, toast } = draftRecoveryOutcome(id, input);
    if (upsert) {
      void applyRecoveredDocument(id, upsert, {
        upsertAndActivate: upsertAndActivateDocument,
        showToast,
      }).catch(() => {}); // Keep a deliberate placement fault inside the test case.
    }
    if (dropRow) setDrafts((prev) => prev.filter((row) => row.id !== id));
    if (toast) showToast(toast);
  };
  const handleRecover = async (id: string) => {
    applyOutcome(id, { action: "recover", outcome: await recoverDraft(id) });
  };
  const handleDiscard = async (id: string) => {
    applyOutcome(id, { action: "discard", outcome: await discardRecoveryDraft(id) });
  };
  return <>
    <RecoveryDialog drafts={drafts} onRecover={handleRecover} onDiscard={handleDiscard} />
    <Toast message={toastMessage ?? ""} visible={Boolean(toastMessage)} />
  </>;
}
