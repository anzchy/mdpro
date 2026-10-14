interface DraftMetadata {
  id: string;
  originalPath: string | null;
  lastModified: string;
  recovered: boolean;
  title: string;
}

import { loggingService } from "../../services/loggingService";
import { draftTimeLabel } from "../../utils/platformLabels";

interface RecoveryDialogProps {
  drafts: DraftMetadata[];
  onRecover: (draftId: string) => void;
  onDiscard: (draftId: string) => void;
}

export function RecoveryDialog({ drafts, onRecover, onDiscard }: RecoveryDialogProps) {
  if (drafts.length === 0) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-card" role="dialog" aria-modal="true" aria-label="Recover drafts">
        <h3 className="dialog-title">Recover drafts</h3>
        <p className="dialog-message">
          We found unsaved drafts. Recover or discard them before continuing.
        </p>
        <div className="recovery-list">
          {drafts.map((draft) => (
            <div key={draft.id} className="recovery-item">
              <div className="recovery-info">
                <div className="recovery-title">{draft.title}</div>
                <div className="recovery-path">
                  {draft.originalPath ? draft.originalPath : "Unsaved document"}
                </div>
                <div className="recovery-time">{draftTimeLabel(draft.lastModified)}</div>
              </div>
              <div className="recovery-actions">
                <button
                  className="toolbar-button"
                  type="button"
                  onClick={() => {
                    loggingService.logDialogAction("dialog.recovery.recover", "success", {
                      draftId: draft.id,
                    });
                    onRecover(draft.id);
                  }}
                >
                  Recover
                </button>
                <button
                  className="toolbar-button"
                  type="button"
                  onClick={() => {
                    loggingService.logDialogAction("dialog.recovery.discard", "cancel", {
                      draftId: draft.id,
                    });
                    onDiscard(draft.id);
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
