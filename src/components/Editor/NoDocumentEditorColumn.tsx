import { useEffect, useRef } from "react";
import { loggingService } from "../../services/loggingService";

/** Blank editor state until a document is active; no child can receive text input. */
export function NoDocumentEditorColumn() {
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    loggingService.logEventSync({
      level: "info",
      event: "ui.editor.no_document",
      status: "success",
      actionId: loggingService.generateActionId(),
      context: { state: "no_document" },
    });
  }, []);
  return null;
}
