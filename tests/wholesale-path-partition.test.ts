// @vitest-environment node
/**
 * WI-3.5.5 — matrix case W5: the wholesale / ordinary partition is derived from the
 * source tree, not recalled from memory.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260918-214500.md` §W, case W5.
 *
 * Why this file exists, stated plainly: the plan's original call-site table listed
 * **four** content-mutating sites and asserted that "every actual replacement funnels
 * through `handleReloadFile`". Both claims were false — there are **fifteen**, of which
 * **eight** are wholesale. A hand-written table cannot notice when it goes stale, which
 * is exactly how that happened. This case re-derives the site list from `src/**` on every
 * run, so a sixteenth site added later fails the suite until someone classifies it.
 *
 * **15 → 16 (D15 WI-2, 2026-09-22).** The sixteenth site is the WYSIWYG keystroke
 * serialize in `plugins/milkdown/editSync/controller.ts`. It is not a new write path:
 * `MilkdownEditor.tsx` already wrote keystrokes through
 * `const { updateDocumentContent: update } = …; update(id, markdown)`, an aliased call
 * this scanner could not see. The D15 fix moved that write into the edit-sync
 * controller and spells it `updateDocumentContent(` literally, so the hidden site became
 * a discoverable one. It is `ordinary` (an incremental edit), and its behavioural case
 * is W8-e / W8-e-table in `tests/toc-wholesale-reset.test.ts`. The wholesale set is
 * unchanged.
 *
 * **16 → 14 (D20 / ADR-0028 decision 4, 2026-09-24).** ADR-0028 routes every open path
 * (`openDocumentFromPath`, `openDocumentFromDialog`, `openDocumentWithEncoding`) through
 * one guard, `commitOpenedDocument` in `utils/openWriteGuard.ts`, so a dirty tab is
 * focused instead of reloaded. The three `useDocument.ts` `upsertDocument(result.document)`
 * sites were deleted and replaced by that guard's single `upsertDocument(decoded)` site:
 * three rows out, one in, so the count drops by two and the wholesale keys go 8 → 6.
 * This deliberately edits recorded assertions (policy rule 12); the specification
 * changed, and the reason is decision 4's "one write site" requirement. The behaviour
 * behind the site is unchanged for clean targets (`toc-wholesale-reset` W1/W6 pass as-is).
 *
 * **File moved, count unchanged (D35 WI-1, 2026-09-30).** `processTableActionEvent` moved
 * verbatim from `hooks/useMcpEvents.ts` to `hooks/mcpTableAction.ts` (re-exported from the
 * hook) so the hook stays under the 300-line limit. The key embeds the file path, so the
 * table-action row is re-keyed to the new file; its class (`ordinary`), enclosing function,
 * and the site count (14) are unchanged. This edits a recorded key (policy rule 12): the
 * site did not change, only where it lives.
 *
 * **Insert site moved and reclassified wholesale, count unchanged (D35 WI-4, 2026-09-30).**
 * `handleInsertContent`'s body moved from `hooks/useMcpEvents.ts` to
 * `processInsertContentEvent` in `hooks/mcpInsertContent.ts`, and an insert into the
 * document that is active in WYSIWYG now runs `prepareWholesaleReplace(id, "mcp-insert")`
 * (ADR-0044): the Milkdown editor is rebuilt and the TOC coordination reset. The row is
 * re-keyed to the new file and reclassified `ordinary` → `wholesale` (the conservative
 * class, since source-mode and non-active inserts stay incremental and the scanner cannot
 * tell them apart), so the wholesale keys go 6 → 7. The site count stays 14. This edits
 * recorded assertions (policy rule 12): the specification changed by locked decision (a).
 *
 * **14 → 15 (D58 / ADR-0065, 2026-10-09).** `processTableActionEvent` now commits a
 * WYSIWYG table edit to the Milkdown editor before the store. When the editor throws after
 * its view advanced, the store is aligned to the editor through a second, separate line,
 * `deps.updateDocumentContent(event.document_id, reconciledMarkdown)`, so the success line
 * keeps its key. The new site is `ordinary` (table cells only), with the behavioural row
 * "MCP table_action reconcile" in `tests/toc-wholesale-reset.test.ts`. The wholesale set is
 * unchanged. This edits a recorded assertion (policy rule 12, the count 14 → 15): the
 * specification changed by plan D58 amendment A §A4 and the test matrix's WI-4 constraints.
 *
 * Key shape is `` `${relPath}::${trimmedLine}::${ordinal}` `` and deliberately **not**
 * `file:line`: line numbers churn on unrelated edits above the call, which would turn
 * this case into a maintenance tax that eventually gets deleted. The trimmed call text
 * plus an ordinal among identical trimmed lines in that file is stable under everything
 * except editing the call itself — which is precisely when the classification should be
 * re-read.
 *
 * Precedent for asserting against source text in this repo: `tests/focus-trap.test.ts`.
 *
 * Constraints honoured (matrix §0): no new dependency (real `node:fs`), no mocks.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.resolve(__dirname, "../src");

/** The two documentStore mutators that can change a document's *content*. */
const CALL_PATTERN = /\b(?:upsertDocument|updateDocumentContent)\s*\(/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Every content-mutating call site in `src/`, keyed as described in this file's header. */
function discoverSiteKeys(): string[] {
  const keys: string[] = [];
  for (const file of walk(SRC).sort()) {
    const relPath = path.relative(SRC, file).split(path.sep).join("/");
    const seen = new Map<string, number>();
    for (const rawLine of fs.readFileSync(file, "utf-8").split("\n")) {
      const line = rawLine.trim();
      if (!CALL_PATTERN.test(line)) continue;
      const ordinal = seen.get(line) ?? 0;
      seen.set(line, ordinal + 1);
      keys.push(`${relPath}::${line}::${ordinal}`);
    }
  }
  return keys;
}

interface ClassifiedSite {
  key: string;
  enclosingFunction: string;
  class: "wholesale" | "ordinary";
  why: string;
}

/**
 * The partition. One row per content-mutating call site in `src/`.
 *
 * `wholesale` = the buffer is replaced as a whole, so every heading identity from the
 * previous revision is void and `tocStore.resetCoordination` must be called.
 * `ordinary`  = an incremental edit; the heading matcher must keep coordinating, and
 * calling `resetCoordination` here would re-introduce the defect WI-3.5 exists to fix.
 */
const CLASSIFIED_SITES: readonly ClassifiedSite[] = [
  {
    key: "App.tsx::updateDocumentContent(currentDoc.id, nextContent);::0",
    enclosingFunction: "handleImageDrop (wysiwyg branch)",
    class: "ordinary",
    why: "appends an image link to existing content",
  },
  {
    key: "App.tsx::updateDocumentContent(currentDoc.id, nextContent);::1",
    enclosingFunction: "handleImageDrop (editor-not-mounted fallback)",
    class: "ordinary",
    why: "same edit by another route",
  },
  {
    key: "plugins/milkdown/editSync/controller.ts::useDocumentStore.getState().updateDocumentContent(documentId, markdown);::0",
    enclosingFunction: "createEditSyncController → write",
    class: "ordinary",
    why: "WYSIWYG keystroke serialize — incremental edit",
  },
  // D20 / ADR-0028 decision 4 (2026-09-24): the three `hooks/useDocument.ts`
  // `upsertDocument(result.document)` rows (openDocumentFromPath / FromDialog /
  // WithEncoding) were removed. All three entry points now write through the single
  // guarded site below, so the three rows collapsed into one.
  {
    key: "utils/openWriteGuard.ts::useDocumentStore.getState().upsertDocument(decoded);::0",
    enclosingFunction: "commitOpenedDocument",
    class: "wholesale",
    why: "the one open-path write (ADR-0028 decision 4): reopen-in-place under a path-derived id, reached only when every candidate is clean and the flush did not fail",
  },
  {
    key: "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(document);::0",
    enclosingFunction: "createDocument",
    class: "wholesale",
    why: "upsertDocument overwrites in place on an id collision",
  },
  {
    key: "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(document);::1",
    enclosingFunction: "upsertAndActivateDocument",
    class: "wholesale",
    why: "whole-document replacement by definition; the draft-recovery entry point",
  },
  {
    key: "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(document);::2",
    enclosingFunction: "replaceDocument",
    class: "wholesale",
    why: "the file-reload leg, including the external file-watcher route",
  },
  {
    key: "hooks/useDocument.ts::useDocumentStore.getState().updateDocumentContent(activeDocument.id, content);::0",
    enclosingFunction: "updateActiveDocumentContent",
    class: "ordinary",
    why: "the keystroke path — the whole point of the feature",
  },
  // D19: the save paths moved their post-await upsert into applySaveResult; same
  // ordinary (non-wholesale) classification, new location.
  {
    key: "services/saveService.ts::store.upsertDocument(resolution.next);::0",
    enclosingFunction: "applySaveResult",
    class: "ordinary",
    why: "save applied: changes only path/isModified/lastSaved, plus formatAllTables content that never touches a heading line",
  },
  {
    key: "services/saveService.ts::store.upsertDocument(resolution.next);::1",
    enclosingFunction: "applySaveResult",
    class: "ordinary",
    why: "edited during save: keeps the current store content and changes only path/lastSaved",
  },
  {
    key: "hooks/mcpTableAction.ts::deps.updateDocumentContent(event.document_id, newContent);::0",
    enclosingFunction: "processTableActionEvent",
    class: "ordinary",
    why: "table cells only",
  },
  // D58 / ADR-0065 (2026-10-09): the reconcile write, a second site in the same function.
  {
    key: "hooks/mcpTableAction.ts::deps.updateDocumentContent(event.document_id, reconciledMarkdown);::0",
    enclosingFunction: "processTableActionEvent",
    class: "ordinary",
    why: "store aligned to the editor's own doc after a post-dispatch throw — table cells only",
  },
  {
    key: "hooks/useMcpEvents.ts::updateDocumentContent(event.document_id, event.content);::0",
    enclosingFunction: "handleWriteDocument",
    class: "wholesale",
    why: "MCP write_document replaces the buffer",
  },
  // D35 / ADR-0044 (2026-09-30): moved out of the hook and reclassified ordinary → wholesale.
  {
    key: "hooks/mcpInsertContent.ts::deps.updateDocumentContent(event.document_id, newContent);::0",
    enclosingFunction: "processInsertContentEvent",
    class: "wholesale",
    why: "MCP insert_content is wholesale when the target is active in WYSIWYG (D35): the " +
      "Milkdown editor is rebuilt via prepareWholesaleReplace. It stays ordinary in source " +
      "mode and for non-active documents, which the classifier cannot distinguish " +
      "statically; the conservative class wins",
  },
  {
    key: "hooks/useMcpEvents.ts::upsertDocument(newDoc);::0",
    enclosingFunction: "handleCreateDocument",
    class: "wholesale",
    why: "MCP create_document, upsert-in-place on an id collision",
  },
];

/**
 * The seven the plan commits to wiring. Spelled out so a silent reclassification fails.
 * Was eight: D20 / ADR-0028 decision 4 replaced the three `useDocument.ts`
 * `result.document` keys with the one `openWriteGuard.ts` key.
 * Was six; D35 / ADR-0044 made the insert site wholesale.
 */
const EXPECTED_WHOLESALE_KEYS: readonly string[] = [
  "utils/openWriteGuard.ts::useDocumentStore.getState().upsertDocument(decoded);::0",
  "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(document);::0",
  "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(document);::1",
  "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(document);::2",
  "hooks/useMcpEvents.ts::updateDocumentContent(event.document_id, event.content);::0",
  "hooks/useMcpEvents.ts::upsertDocument(newDoc);::0",
  "hooks/mcpInsertContent.ts::deps.updateDocumentContent(event.document_id, newContent);::0",
];

function symmetricDifference(a: readonly string[], b: readonly string[]): string[] {
  const setA = new Set(a);
  const setB = new Set(b);
  return [
    ...a.filter((k) => !setB.has(k)).map((k) => `only in source: ${k}`),
    ...b.filter((k) => !setA.has(k)).map((k) => `only in table:  ${k}`),
  ].sort();
}

describe("W5 — the wholesale/ordinary partition is derived from src/, not from memory", () => {
  const found = discoverSiteKeys();

  it("every content-mutating call site in src/ is classified exactly once", () => {
    const classified = CLASSIFIED_SITES.map((s) => s.key);
    expect(
      symmetricDifference(found, classified),
      "an unclassified (or stale) content-mutating call site — classify it in CLASSIFIED_SITES " +
        "and give it a behavioural case in tests/toc-wholesale-reset.test.ts",
    ).toEqual([]);
    expect(new Set(found)).toEqual(new Set(classified));
    expect(found.length, "duplicate keys would hide a site").toBe(new Set(found).size);
  });

  // Was 16 ("the site count is sixteen — …"); see the 16 → 14 paragraph in the header.
  // Was 14 ("the site count is fourteen — …"); see the 14 → 15 paragraph in the header.
  it("the site count is fifteen — D58/ADR-0065 added the table-action reconcile write", () => {
    expect(found.length).toBe(15);
  });

  // Was "exactly the eight wholesale sites"; D20/ADR-0028 decision 4, 8 → 6.
  // Was "exactly the six wholesale sites"; D35 / ADR-0044, 6 → 7.
  it("exactly the seven wholesale sites are classified wholesale", () => {
    expect(
      CLASSIFIED_SITES.filter((s) => s.class === "wholesale")
        .map((s) => s.key)
        .sort(),
      "a row was reclassified; behavioural cases alone would not catch this",
    ).toEqual([...EXPECTED_WHOLESALE_KEYS].sort());
  });

  it("every row carries an enclosing function and a reason", () => {
    for (const site of CLASSIFIED_SITES) {
      expect(site.enclosingFunction.length, site.key).toBeGreaterThan(0);
      expect(site.why.length, site.key).toBeGreaterThan(0);
    }
  });
});
