/**
 * Purpose: The Milkdown/ProseMirror side of WYSIWYG edit sync (D15/D18). One plugin
 * instance per editor instance, bound to the document the editor was mounted for. It
 * feeds doc changes into the pure edit-sync controller and exposes the controller's
 * synchronous flush through `milkdownEditorStore.registerFlusher`.
 *
 * Pipeline: view init → capture serializer + baseline → createEditSyncController →
 * registerFlusher(documentId, flush, discard). Each view update whose doc changed (`!prev.doc.eq(doc)`,
 * which also covers appended transactions) → controller.onDocChanged({ userEdit }).
 * View destroy → controller.destroy("unmount") → the registry cleanup.
 *
 * Key decisions:
 * - Change tracking lives inside the ProseMirror view lifecycle, not in a React effect.
 *   The old Milkdown listener-plugin registration sat in an effect keyed on
 *   `useEditor`'s per-render wrapper, so the first re-render disposed it for good (D15).
 * - `userEdit` is true when any transaction in the update batch lacks
 *   `addToHistory === false`. Plugin state counts those transactions; the update
 *   compares the count before and after, so a mixed batch (a user keystroke plus the
 *   history-less heading-id sync it triggers) is a user edit.
 * - The serializer is read from ctx once at view init (ctx is ready there) and reused.
 *   Destroy never calls `ctx.get`: Milkdown tears its ctx down around the view, and a
 *   late `ctx.get(editorViewCtx)` is the D18 "Context editorView not found" error.
 * - A null `documentId` (no active document) attaches nothing.
 *
 * @coordinates-with src/plugins/milkdown/editSync/controller.ts — the timer / revision /
 *   flush semantics
 * @coordinates-with src/stores/milkdownEditorStore.ts — registerFlusher; its
 *   `reloadEditor` calls `discard` when the document is replaced wholesale
 * @coordinates-with src/components/Editor/MilkdownEditor.tsx — `.use(...)` per editor
 * @module plugins/milkdown/editSync/plugin
 */
import { serializerCtx } from "@milkdown/kit/core";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { loggingService } from "../../../services/loggingService";
import { useDocumentStore } from "../../../stores/documentStore";
import { useMilkdownEditorStore } from "../../../stores/milkdownEditorStore";
import { createEditSyncController } from "./controller";

const UNMOUNT_REASON = "unmount";

/** Serialize the loaded doc. If the serializer throws this early, fall back to the
 *  stored content so the editor still mounts; the controller reports the failure on
 *  the first flush instead. */
function baselineOf(documentId: string, getMarkdown: () => string): string {
  try {
    return getMarkdown();
  } catch {
    const owner = useDocumentStore.getState().documents.find((d) => d.id === documentId);
    return owner?.content ?? "";
  }
}

/** Build the edit-sync plugin for the editor instance mounted for `documentId`. */
export function editSyncMilkdownPlugin(documentId: string | null) {
  return $prose((ctx) => {
    // Counts history-carrying doc changes; compared across an update to classify it.
    const key = new PluginKey<number>("mdpro-edit-sync");
    return new Plugin<number>({
      key,
      state: {
        init: () => 0,
        apply: (tr, count) =>
          tr.docChanged && tr.getMeta("addToHistory") !== false ? count + 1 : count,
      },
      view: (editorView) => {
        if (!documentId) return {};
        const serializer = ctx.get(serializerCtx);
        const getMarkdown = () => serializer(editorView.state.doc);
        const controller = createEditSyncController({
          documentId,
          getMarkdown,
          baselineMarkdown: baselineOf(documentId, getMarkdown),
        });
        const unregister = useMilkdownEditorStore
          .getState()
          .registerFlusher(documentId, (reason) => controller.flush(reason), controller.discard);
        loggingService.logEventSync({
          level: "info",
          event: "editor.milkdown.editSync.attached",
          status: "success",
          actionId: loggingService.generateActionId(),
          context: { documentId },
        });
        return {
          update: (view, prevState) => {
            if (prevState.doc.eq(view.state.doc)) return;
            const userEdit = key.getState(view.state) !== key.getState(prevState);
            controller.onDocChanged({ userEdit });
          },
          destroy: () => {
            controller.destroy(UNMOUNT_REASON);
            unregister();
          },
        };
      },
    });
  });
}
