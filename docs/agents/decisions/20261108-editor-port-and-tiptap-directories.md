# 2026-11-08: The editor port lives in src/services/editor/, Tiptap extensions in src/plugins/tiptap/

- **Decided:** 2026-11-07, by the user. In the planner's MIG-004 session (#687, map #678), the user answered all eight
  questions "(Recommended)". Items 5 and 6 of
  [the resolution](https://github.com/anzchy/mdpro/issues/687#issuecomment-6713613391) are the source; DEC-003 is #688.
  The plan is `docs/plans/20261107-mdpro_tiptap_windows_plan_v1-3.md` (§4.1, review finding MM4).
- **Decision:** rule 50 gains two directories.
  - **`src/services/editor/`** holds the editor port: `WysiwygEditorPort`, `MarkdownCodec`, `EditorTransaction` and
    `editorCoordinator`.
    - It imports no React and no engine package (`@milkdown/*`, `@tiptap/*`, `prosemirror-*`), type-only imports
      included. A contract that needs a ProseMirror type takes it by a generic type parameter or by a structural type, as plan §4.3
      says for the pipeline.
    - MIG-005 moves the host's direct engine calls (plan §4.2's eleven `getEditor` sites) onto it; until then they
      stay where they are.
    - Each engine's adapter implements the port from its own plugin directory.
  - **`src/plugins/tiptap/`** holds the Tiptap 3 extensions, which mirror Milkdown's:
    - each module exports a `*TiptapExtension`;
    - `TiptapEditor.tsx` imports them directly, not through `pluginRegistry`;
    - `src/plugins/tiptap/` and `src/plugins/milkdown/` never import each other.
  - Stores stay in `src/stores/`, and tests in `tests/`.
- **Why:**
  - Rule 50 names only `core/`, `milkdown/` and `codemirror/` under `src/plugins/`, and has no home for a host contract.
    A first Tiptap module or port file would break the rule it is reviewed against.
  - `src/services/` already holds non-IPC coordinators and is High tier by path (ADR-0121). The port's callers are
    save, close, draft and MCP, which are exactly the paths that tier protects.
  - Keeping the two engines apart lets Milkdown stay the production writer until MIG-025 and be deleted cleanly later.
- **Costs:**
  - `src/services/` now holds two kinds of thing: IPC wrappers and the port. CLAUDE.md's one-liner says so.
  - "No engine imports" is a convention until MIG-007b's dependency-cruiser rule enforces it.
  - `src/plugins/tiptap/` is Medium tier by path. ADR-0121 decision 1's behaviour clause makes any extension that
    changes document content High wherever it lives, and the delegator names High for every migration range, per plan
    §15.
- **changes:**
  - `.claude/rules/50-codebase-conventions.md` § 3: the heading and intro name four directories, a table row, the
    Milkdown/CodeMirror export sentence is scoped to those two, and two new paragraphs.
  - `CLAUDE.md` § Architecture: "`services/` = typed `invoke()` wrappers and the editor port" and
    "`plugins/` = Milkdown/Tiptap/CodeMirror".
- **supersedes:** none.
- **gate-sensitive:** yes, because doubt means review. It sets where High-tier code lands, and which import boundary
  MIG-007b's ratchet will enforce. Classified by herdr-delegator, 2026-11-08.
