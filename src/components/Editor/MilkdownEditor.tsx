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
  // Note: We intentionally depend only on activeDocumentId here because
  // Milkdown creates a fresh editor instance when the document changes.
  // Including activeDocument would cause unnecessary re-renders during typing.
  const initialMarkdown = useMemo(
    () => activeDocument?.content ?? "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeDocumentId],
  );

  // Debug logging for black screen issue
  console.log("[DEBUG] MilkdownEditorInner - activeDocumentId:", activeDocumentId, "initialMarkdown length:", initialMarkdown.length);

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
