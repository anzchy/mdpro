import { useCallback, useMemo } from "react";
import { Milkdown, MilkdownProvider } from "@milkdown/react";
import { useMilkdown } from "../../hooks/useMilkdown";
import { useDocumentStore } from "../../stores/documentStore";

function MilkdownEditorInner() {
  const { documents, activeDocumentId, updateDocumentContent } = useDocumentStore(
    (state) => ({
      documents: state.documents,
      activeDocumentId: state.activeDocumentId,
      updateDocumentContent: state.updateDocumentContent,
    }),
  );

  const activeDocument = useMemo(
    () => documents.find((doc) => doc.id === activeDocumentId) ?? null,
    [documents, activeDocumentId],
  );
  // Depend on activeDocument?.content to ensure content is available when document switches.
  // This is safe because useMilkdown only recreates the editor when documentId changes,
  // not when initialMarkdown changes during typing.
  const initialMarkdown = useMemo(
    () => activeDocument?.content ?? "",
    [activeDocument?.content],
  );

  const handleMarkdownChange = useCallback(
    (markdown: string) => {
      if (!activeDocumentId) return;
      updateDocumentContent(activeDocumentId, markdown);
    },
    [activeDocumentId, updateDocumentContent],
  );

  // Content sync is handled by markdownUpdated listener in useMilkdown
  useMilkdown({
    markdown: initialMarkdown,
    documentId: activeDocumentId,
    onMarkdownChange: handleMarkdownChange,
  });

  return <Milkdown />;
}

export function MilkdownEditor() {
  return (
    <div className="milkdown-editor">
      <MilkdownProvider>
        <MilkdownEditorInner />
      </MilkdownProvider>
    </div>
  );
}
