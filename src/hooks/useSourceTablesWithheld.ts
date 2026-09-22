/**
 * @module useSourceTablesWithheld
 * Purpose: a subscribing boolean — is the ACTIVE document's Source table
 * verdict "withheld"? Editor.tsx feeds it into its extensions memo so the
 * table extensions are removed or restored with one reconfigure per change
 * (plan-20260922-113723 WI-4, ADR-0022).
 *
 * Key decisions:
 * - **A subscription, not a `getState()` read.** App's guard effect records
 *   the verdict after Editor has mounted (effects run after children), so a
 *   plain read would never re-run and the extensions would stay installed.
 * - **The id comes from `useDocumentStore`**, the source of truth for the
 *   active document; `useEditorStore.activeDocumentId` is not.
 * - **Primitive selectors only**, so an unrelated store write re-renders
 *   nothing (no `useShallow` needed).
 * - Tests `"withheld"`, not verdict presence: an `"allowed"` verdict keeps the
 *   tools on.
 *
 * @coordinates-with src/stores/editorStore.ts — `isSourceTablesWithheld`.
 * @coordinates-with src/stores/documentStore.ts — `activeDocumentId`.
 * @coordinates-with src/components/Editor/Editor.tsx — the caller.
 */
import { useDocumentStore } from "../stores/documentStore";
import { isSourceTablesWithheld, useEditorStore } from "../stores/editorStore";

/** Whether the active document's Source table tools are withheld. */
export function useSourceTablesWithheld(): boolean {
  const activeDocumentId = useDocumentStore((state) => state.activeDocumentId);
  return useEditorStore((state) => isSourceTablesWithheld(state, activeDocumentId));
}
