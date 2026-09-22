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
  {
    key: "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(result.document);::0",
    enclosingFunction: "openDocumentFromPath",
    class: "wholesale",
    why: "reopen-in-place: ids are path-derived and upsertDocument replaces in place",
  },
  {
    key: "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(result.document);::1",
    enclosingFunction: "openDocumentFromDialog",
    class: "wholesale",
    why: "same, via the native dialog",
  },
  {
    key: "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(result.document);::2",
    enclosingFunction: "openDocumentWithEncoding",
    class: "wholesale",
    why: "same id, whole buffer re-decoded under a different encoding",
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
  {
    key: "hooks/useDocument.ts::upsertDocument({::0",
    enclosingFunction: "saveActiveDocumentAs",
    class: "ordinary",
    why: "spreads ...activeDocument and changes only path/isModified/lastSaved",
  },
  {
    key: "hooks/useDocument.ts::upsertDocument({::1",
    enclosingFunction: "saveActiveDocument",
    class: "ordinary",
    why: "same shape; content differs only via formatAllTables, which never touches a heading line",
  },
  {
    key: "hooks/useMcpEvents.ts::deps.updateDocumentContent(event.document_id, newContent);::0",
    enclosingFunction: "processTableActionEvent",
    class: "ordinary",
    why: "table cells only",
  },
  {
    key: "hooks/useMcpEvents.ts::updateDocumentContent(event.document_id, event.content);::0",
    enclosingFunction: "handleWriteDocument",
    class: "wholesale",
    why: "MCP write_document replaces the buffer",
  },
  {
    key: "hooks/useMcpEvents.ts::updateDocumentContent(event.document_id, newContent);::0",
    enclosingFunction: "handleInsertContent",
    class: "ordinary",
    why: "MCP insert_content is incremental",
  },
  {
    key: "hooks/useMcpEvents.ts::upsertDocument(newDoc);::0",
    enclosingFunction: "handleCreateDocument",
    class: "wholesale",
    why: "MCP create_document, upsert-in-place on an id collision",
  },
];

/** The eight the plan commits to wiring. Spelled out so a silent reclassification fails. */
const EXPECTED_WHOLESALE_KEYS: readonly string[] = [
  "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(result.document);::0",
  "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(result.document);::1",
  "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(result.document);::2",
  "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(document);::0",
  "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(document);::1",
  "hooks/useDocument.ts::useDocumentStore.getState().upsertDocument(document);::2",
  "hooks/useMcpEvents.ts::updateDocumentContent(event.document_id, event.content);::0",
  "hooks/useMcpEvents.ts::upsertDocument(newDoc);::0",
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

  it("the site count is sixteen — the plan's original table of four was wrong; D15 surfaced the aliased WYSIWYG site", () => {
    expect(found.length).toBe(16);
  });

  it("exactly the eight wholesale sites are classified wholesale", () => {
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
