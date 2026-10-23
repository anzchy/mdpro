# Vim-style prefix navigation for mdpro Source mode

Date: 2026-10-23  
Author: gpt-auditor (Codex), requested by the user

**Recommendation: Option C, with a prefix layer that first tries reusing `@replit/codemirror-vim` through a small, bounded adapter.** Keep ordinary typing and existing shortcuts outside that layer; consider full Vim as a separate opt-in later. The user's follow-up—whether integrating and slightly adapting this package can reduce coding—is promising: a scratch experiment successfully reused its word motion and word/sentence/paragraph selections without changing upstream code. This can remove substantial generic motion/text-object implementation. It does not remove mdpro's prefix state, command ownership, Markdown structure semantics, settings, IME or device verification work.

This is a research survey, not an audit or implementation grant. Web sources were checked on the date above. Repository inspection targeted `/Users/jack/Documents/mac-app/mdpro`, HEAD `f35136de5d199410e89735dd3920b962176e9ba5`; existing unrelated working-tree changes were left alone. No repository files were edited, dependencies installed, builds run, commits made or PR actions taken. A disposable package experiment ran under `/private/tmp/mdpro-vim-survey/`, using downloaded release files and existing local dependencies. It was not an mdpro integration test. Where no native Vim feature was found, the claim is limited to the reviewed documentation/configuration, not proof of permanent absence.

## 1. What herdr's model actually provides

herdr uses **Ctrl+B, release, then a command key**. Examples include `c` for a new tab, `v`/`-` for splits, `h/j/k/l` for pane focus, `w` for workspace navigation, `[` for copy mode and `?` for searchable key help. Copy mode is a separate modal surface with movement, search and selection commands; it is not the same as the one-command prefix state. [Keyboard documentation](https://herdr.dev/docs/keyboard/).

The configuration supports multiple prefix bindings and distinguishes prefixed commands from direct bindings; the primary prefix is displayed in the status bar. The inspected shell renders a visible `PREFIX` state with cancellation/help hints. In prefix dispatch, Escape cancels, repeating the prefix forwards that prefix to the terminal, a valid command executes and leaves the prefix state, and an unknown key cancels and is consumed. [Configuration](https://herdr.dev/docs/configuration/), [pinned input implementation](https://github.com/herdrdev/herdr/blob/5bd900d88c80d95f5b145397e45bbeea398b8165/src/client/shell/input.rs#L679), [pinned rendering](https://github.com/herdrdev/herdr/blob/5bd900d88c80d95f5b145397e45bbeea398b8165/src/client/shell/render.rs#L85).

**Timeout:** no numeric prefix timeout is documented in the reviewed pages. The inspected state enum and prefix dispatch do not show a deadline; they appear to wait for the next input/cancellation. This is source inspection, not a runtime timing test, and is not evidence for inventing a 1-second timeout. [Shell state](https://github.com/herdrdev/herdr/blob/5bd900d88c80d95f5b145397e45bbeea398b8165/src/client/shell/state.rs#L271).

Transfer these ideas: one explicit activation chord, a visible pending state, a compact mnemonic command family, immediate help, cancellation and commands scoped to the active surface. Do not copy terminal-specific behavior indiscriminately. Forwarding a prefix to a terminal has no direct equivalent in a text editor; swallowing an unknown printable key can lose intended input; pane movements are not text movements. Ctrl+B is already occupied in mdpro. herdr's optional ASCII input-source switching is explicitly experimental and platform-limited; mdpro should leave input-source selection with the user in v1. [Configuration reference](https://herdr.dev/docs/config-reference/).

**Proposed mdpro interaction:** ordinary Source typing → prefix pending → one recognized navigation/selection command → ordinary typing. A whole-word selection remains an ordinary CodeMirror selection, ready to copy or replace. Users need not learn Normal/Insert/Visual modes. That last requirement is the main difference from simply enabling a Vim extension.

## 2. Prior art in Markdown and writing editors

There are three useful families: full modal editing; a leader/menu that dispatches commands; and ordinary editor shortcuts. VSpaceCode/Spacemacs demonstrate discoverable leader menus, but their leaders generally supplement Vim editing rather than turn an otherwise nonmodal editor into a one-shot navigation layer. Logseq is particularly relevant because its navigation is adapted to the product's block model.

The comparison below records how to enable the feature and which surface it affects. A rendered Source/Live Preview editor is distinguished from a separate rich-text document engine.

| Editor | Availability and enablement | Interaction model | Markdown surface and lesson for mdpro |
|---|---|---|---|
| **Obsidian** | Built-in **Settings → Editor → Advanced → Vim key bindings**. [Settings](https://obsidian.md/help/settings) | Modal Vim bindings; not a stock herdr-style one-shot leader. | Editing view, including the source-backed Source/Live Preview family; not Reading view. Live Preview is an editing presentation, not evidence of a separate rich-text Vim implementation. [Editing modes](https://help.obsidian.md/Live%2Bpreview%2Bupdate) |
| **Typora** | No native Vim/leader toggle found in current official shortcut documentation. Users can customize ordinary shortcuts. [Shortcuts](https://support.typora.io/Shortcut-Keys/) | Conventional shortcuts; a user-posted DevTools injection is an unsupported workaround. | That workaround explicitly targets source mode, not WYSIWYG. Do not present it as a supported product capability. [Issue #6445](https://github.com/typora/typora-issues/issues/6445) |
| **VS Code + Markdown / VSCodeVim / VSpaceCode** | Install VSCodeVim for modal editing; install/configure VSpaceCode's extension pack for its leader menu. VSCodeVim exposes `vim.leader`, mapping controls and key delegation. [VSCodeVim](https://github.com/VSCodeVim/Vim), [VSpaceCode setup](https://vspacecode.github.io/docs/) | Full Vim emulation plus an optional Space-led which-key command tree in Normal/Visual mode. Standalone which-key can also be bound to a modified chord. | Applies to the Markdown text editor, not the rendered preview. Separate the navigation engine from the discoverability UI. [Which-key](https://vspacecode.github.io/docs/whichkey/), [Markdown views](https://code.visualstudio.com/Docs/languages/markdown) |
| **Zettlr** | **Preferences → Editor → Input mode → Vim**; Normal and Emacs are also listed. [Current English settings](https://docs.zettlr.com/en/reference/settings.html) | Modal input option, with a mode indication. | The source-backed editor can separately render Markdown or show raw text. Its status bar distinguishes input mode from rendering mode. Older translated documentation claiming Vim is disabled should not override current English docs. [Status bar](https://docs.zettlr.com/en/editor/statusbar.html) |
| **MarkText** | No native Vim/leader option found in reviewed current preferences/basic docs. [Basics](https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/end-user/BASICS.md), [preferences](https://github.com/marktext/marktext/blob/develop/packages/website/content/docs/end-user/PREFERENCES.md) | Conventional customizable shortcuts in the reviewed product. | Source and rich editing exist, but that alone does not establish Vim support in either. Do not infer current status from old feature requests or describe the project as abandoned. |
| **Logseq** | Built-in command sequences include `g h`, `g j`, `t l` and `t r`. Optional **Vim Shortcuts** plugin is installed from the marketplace, then restarted. [Official command list](https://logseq.io/page/d725f627-7fdf-4144-a8aa-3af618cf7886/184bd8ad-4d4e-4241-93c5-1344678d5a11), [plugin README](https://github.com/vipzhicheng/logseq-plugin-vim-shortcuts/blob/master/README.md) | Native prefix sequences for app operations; plugin adds an adapted modal block/cursor layer. | Plugin Normal mode focuses a block; `i/a` edit it, `j/k` navigate blocks, and cursor motions plus character Visual and whole-block Visual selections are documented. It is no longer accurate to describe this plugin as block-only. Not a claim of complete Vim compatibility. |
| **Joplin** | Current desktop setting `editor.keyboardMode`: Default / Emacs / Vim under advanced Editor settings. [Setting source](https://github.com/laurent22/joplin/blob/280954e58fc7c9e74200fd817272ac3fb80dcead/packages/lib/models/settings/builtInMetadata.ts#L1933) | Modal Vim in the CodeMirror Markdown editor; optional vimrc plugin supports limited remapping. | Source Markdown editor, not the separate rich-text editor. Joplin's integration customizes `o` for lists and `:w` for synchronization: real adoption still needs product adaptation. [Integration source](https://github.com/laurent22/joplin/blob/280954e58fc7c9e74200fd817272ac3fb80dcead/packages/editor/CodeMirror/utils/setupVim.ts#L7), [vimrc plugin](https://joplinapp.org/plugins/plugin/io.github.personalizedrefrigerator.joplin-vimrc/) |
| **iA Writer** | No native Vim/leader option found in reviewed settings and keyboard documentation. [Settings](https://ia.net/writer/support/basics/settings), [shortcuts](https://ia.net/writer/support/basics/shortcuts?platform=windows) | Conventional text navigation/selection and command/search navigation. | Markdown writing editor and preview, rather than a documented modal rich editor. Good evidence that word/paragraph access can be useful without Vim emulation. |
| **Bear** | No native Vim/leader toggle found in official Mac shortcut documentation. [Shortcuts](https://bear.app/faq/mac-keyboard-shortcuts/) | Conventional editing shortcuts. | Rich Markdown writing surface; no documented built-in Vim layer in the reviewed material. |
| **Zed** | Built-in welcome-screen choice or `"vim_mode": true`; can toggle Vim mode in the workspace. [Vim docs](https://zed.dev/docs/vim) | Adapted modal Vim; not intended to reproduce every Vim behavior. Custom keymaps can add command sequences. | Markdown source editor, with a separate preview. Semantic/editor features need explicit adaptations. [Markdown docs](https://zed.dev/docs/languages/markdown) |
| **Helix** | Modal editing is the default, not a plugin to enable. [Keymap](https://docs.helix-editor.com/keymap.html) | Selection-first modal model; `g`, `m`, `z` and Space open minor modes, usually returning after a command. Not a Vim emulator. | Terminal Markdown source editing. Particularly useful prior art for bounded transient command modes and explicit selections, not WYSIWYG. |
| **Emacs Evil / Spacemacs** | Install/enable Evil with `(evil-mode 1)`; Spacemacs selects Vim/hybrid/Emacs editing style. [Evil](https://evil.readthedocs.io/en/latest/overview.html), [Spacemacs quick start](https://www.spacemacs.org/doc/QUICK_START.html) | Evil supplies modal Vim states. Spacemacs supplies Space leader in Vim/hybrid, `M-m` in Emacs style, and a major-mode leader. | Markdown buffers; leader dispatch and which-key can be separated conceptually from the editing engine. [Spacemacs documentation](https://www.spacemacs.org/doc/DOCUMENTATION.html) |
| **JetBrains IdeaVim** | Install IdeaVim, restart, enable **Tools → Vim**; configure `.ideavimrc`, including `mapleader`. [JetBrains guide](https://www.jetbrains.com/help/idea/using-product-as-the-vim-editor.html), [IdeaVim README](https://github.com/JetBrains/ideavim) | Full modal emulation with user mappings/leader commands. | Markdown text-editor side, not the rendered preview. Existing IDE shortcuts require explicit delegation choices. |
| **VMark** | No native Vim/leader setting found in reviewed settings/shortcut docs. An external-editor value such as `vim` is not in-app Vim emulation. [Settings](https://vmark.app/guide/settings), [shortcuts](https://vmark.app/guide/shortcuts.html) | Conventional shortcuts plus product-specific navigation such as Smart Tab. | CodeMirror 6 Source and Tiptap WYSIWYG are separate implementations. Its two-engine architecture is relevant; it does not establish that one CM6 Vim extension covers both. [Repository](https://github.com/xiaolai/vmark) |

The closest precedents are **Joplin for adapting a CodeMirror Vim engine**, **VSpaceCode/Spacemacs for discoverable leaders**, and **Helix/Logseq for product-specific navigation semantics**. None of those examples establishes that mdpro's exact “prefix + one key, return to ordinary typing with an ordinary selection” contract is available merely by turning on Vim mode.

## 3. Feasibility in mdpro Source mode

### Existing integration boundaries

mdpro already has the necessary CM6 extension infrastructure, but keyboard ownership is deliberate:

- Plugin extensions are constructed against the applied-shortcut snapshot. View switching and table arrow bindings have highest precedence; table Tab has high precedence; app-owned bindings are removed from CodeMirror defaults. Multiple selections are enabled. [Editor.tsx:68](../../src/components/Editor/Editor.tsx), [Editor.tsx:91](../../src/components/Editor/Editor.tsx), [Editor.tsx:118](../../src/components/Editor/Editor.tsx), [Editor.tsx:149](../../src/components/Editor/Editor.tsx).
- An absent/failed snapshot or a suppressed/unassigned binding yields **no key**, not a hard-coded fallback. Keyboard customization currently applies on restart. Register the activation chord through this system; do not read freshly edited preferences in one listener while native menus use the run's snapshot. [appliedKeymap.ts:24](../../src/commands/appliedKeymap.ts), [appliedKeymap.ts:52](../../src/commands/appliedKeymap.ts), [ADR-0114:151](../../docs/adr/0114-the-menu-bar-and-default-keys-follow-one-command-table-and-vmark.md).
- Window-level shortcuts respect `defaultPrevented` and have logical/physical matching fallbacks. A handled suffix must not also trigger an app action; an unrelated Save or view-switch command must still work and cancel pending navigation. [useKeyboardShortcuts.ts:204](../../src/hooks/useKeyboardShortcuts.ts), [shortcutMatch.ts:84](../../src/utils/shortcutMatch.ts).
- The existing contentDOM capture guard stops printable AltGr events reaching editor keymaps while leaving browser text input intact. Any new capture listener must preserve that order and policy. [altGrGuard.ts:13](../../src/plugins/codemirror/altGrGuard.ts), [Editor.tsx:229](../../src/components/Editor/Editor.tsx).

The stored shortcut grammar represents **one chord**, not `prefix + w`. Store the activation as a configurable Source command and keep its suffix commands in a separate internal table. Do not expand the shared TS/Rust chord parser solely to encode a one-shot editor layer. [chord.ts:8](../../src/commands/chord.ts).

### Option A: enable full `@replit/codemirror-vim`

**Verified release:** npm latest was **6.4.0**, published 2026-07-29. It depends on the separate **`@replit/codemirror-vim-core` ^0.1.0**, whose current release was 0.1.0, published 2026-07-28. Both declare **MIT**. CM commands/language/search/state/view are 6.x peers. Account for both packages and retain required license notices. [Adapter release metadata](https://registry.npmjs.org/@replit%2fcodemirror-vim/6.4.0), [core release metadata](https://registry.npmjs.org/@replit%2fcodemirror-vim-core/0.1.0).

This is a maintained descendant of the CodeMirror Vim implementation, not native Vim/Neovim. The repository was not archived; inspected history included the July 2026 release and publishing changes. That supports practical reuse, not a promise that every bug will be fixed promptly. Pin/test the integration rather than trusting a moving branch. [Repository and history](https://github.com/replit/codemirror-vim), [inspected commit](https://github.com/replit/codemirror-vim/commit/8640966b6977f84d2197e6adfd521fb737184587).

The README calls for `vim()` ahead of other keymaps and recommends `drawSelection()` for Visual selections. Public APIs expose the CM adapter, key dispatch and custom Vim commands. `vim()` itself exposes a status option, not an “always ordinary typing with one-shot prefix” switch. Full Vim also brings operators, registers, search, counts and modal escape behavior. [Package README](https://github.com/replit/codemirror-vim/tree/8640966b6977f84d2197e6adfd521fb737184587/packages/codemirror-vim), [published adapter](https://unpkg.com/@replit/codemirror-vim@6.4.0/dist/index.js), [published types](https://unpkg.com/@replit/codemirror-vim@6.4.0/dist/index.d.ts).

**Size, measured from the published artifacts:**

| Artifact | npm compressed tarball | Unpacked npm package | Runtime ESM file, raw | Runtime file gzip-9 |
|---|---:|---:|---:|---:|
| Adapter 6.4.0 | 44,075 B | 204,849 B | 59,139 B | 14,178 B |
| Core 0.1.0 | 104,049 B | 520,487 B | 265,477 B | 60,607 B |
| Sum | 148,124 B | 725,336 B | 324,616 B | 74,785 B |

These are archive metadata and local measurements of the adapter's `dist/index.js` and core's `vim.js`. The approximately **73 KiB summed gzip** is **not** an mdpro production bundle delta: the files were not production-minified together, package archives contain nonruntime files, and existing CM peers must not be counted twice. Actual incremental bundle, startup cost and lazy-load behavior require a controlled build during implementation. [Adapter tarball](https://registry.npmjs.org/@replit/codemirror-vim/-/codemirror-vim-6.4.0.tgz), [core tarball](https://registry.npmjs.org/@replit/codemirror-vim-core/-/codemirror-vim-core-0.1.0.tgz).

Enabling full Vim is probably the shortest route to **full Vim behavior**. It is not the shortest validated route to the requested nonmodal product behavior. Its event handlers and input handling cannot be reconciled merely by rearranging one keymap array. mdpro must decide app-key priority, undo, table operations, search, native menu accelerators and IME behavior. Joplin's list-specific integration illustrates this adaptation cost; its historical CM6 `o` issue is an integration lesson, not a claim that current Joplin still has that bug. [Joplin discussion and linked fix](https://discourse.joplinapp.org/t/codemirror-6-vim-mode-issues/35135).

### Follow-up: can a small adapter reuse the package without exposing full Vim?

**Yes for a useful subset; the bounded experiment supports trying this before implementing generic motions ourselves.** Two approaches were examined:

1. **Permanent Vim, mostly Insert mode, prefix mapped to Ctrl+O.** The core already implements a one-Normal-command action. This is attractive for motions, but it allows editing commands too and has special Visual-state behavior. It is not a navigation-only setting. [Core `oneNormalCommand`](https://github.com/replit/codemirror-vim/blob/8640966b6977f84d2197e6adfd521fb737184587/packages/codemirror-vim-core/vim.js#L3426).
2. **A transient adapter controlled by mdpro.** Outside the prefix command, Vim is not installed in the view. Once mdpro recognizes an allowed suffix, synchronously attach `vim()` in a dedicated CM6 `Compartment`, dispatch a fixed internal sequence using `getCM`/`Vim.handleKey`, capture the resulting CM6 selection, remove the extension, and restore that selection. Raw user input is never forwarded to an unrestricted Vim interpreter. This is the more promising prototype architecture for this request.

The scratch experiment used the actual published 6.4.0/0.1.0 runtime files, mdpro's installed CM state 6.5.4/view 6.39.11 and jsdom 26.1.0. It used `cm.operation` around programmatic key calls. Document text began `one two three. Four five.`, followed by a blank line and another paragraph. Observed results:

| Probe | Observed result | Implication |
|---|---|---|
| Insert → Ctrl+O → `w`, `3w`, `)`, `}` | Motions completed and returned to Insert; document unchanged. | Existing word/sentence/paragraph/count logic is reusable in these samples. |
| Insert → Ctrl+O → `x` | Deleted a character. | A remap alone exposes editing; an explicit allowlist is necessary. |
| Insert → Ctrl+O → `z` | Remained pending for another Vim key. | The engine's grammar does not enforce “one suffix and done.” |
| Insert → Ctrl+O → `v i w` | Did not produce the expected whole-word selection in this harness; both Insert/Visual flags became true after `v`. The same symptom occurred with dispatched jsdom keydown events. | Do not advertise this combination as validated. This is a probe result, not a diagnosed production bug or upstream audit finding. |
| Explicit exit from Insert → `v i w`; capture selection, Escape, `i`, restore selection | Selected `two`; returned to Insert with that selection. | Public APIs can bridge Vim text objects to ordinary CM selections in a sample. |
| Transient extension → `w`; capture, detach, restore | Moved to the next word; document unchanged; `getCM(view)` returned null after removal. | The engine need not remain active during normal typing. |
| Transient extension → `v i w`, `v i s`, `v i p`; capture, detach, restore | Selected `two`, `one two three.`, and the first paragraph respectively. Document unchanged in all three; adapter absent afterward. | This is the strongest direct evidence that small integration work can reuse selections without an upstream fork. |

These results are original observations, not upstream guarantees. They cover a small ASCII, single-selection fixture. They do **not** establish native typing/replacement, undo grouping, IME, Unicode grapheme safety, wrapped vertical navigation, read-only behavior, large-document latency or multiple selections. Scratch reproducer: `/private/tmp/mdpro-vim-survey/probe.js`, runner `run.cjs`, observations `probe-results.jsonl`; temporary files are not the durable deliverable.

A production candidate must attach/remove in a safe lifecycle, restore selection in `finally`, preserve existing extensions/history, handle exceptions and document/editor replacement, and never accept arbitrary command strings. It must verify that temporary reconfiguration causes no unwanted selection callbacks, focus changes, cursor flicker, scroll jumps or latency. Run the command outside a CM update callback if reconfiguration there would be illegal. Lazy-loading must not leave the first prefix key in an ambiguous state; load when the feature becomes ready or expose readiness explicitly.

**Do not fork the engine first.** Prefer the supported package/adapter boundary. If safe transient use needs private `state.vim` mutations, large internal patches or a hidden second editor, its simplicity advantage has eroded. Revert to the custom CM command approach for those operations. Merely importing the new core package is not a free shortcut: it still expects a substantial editor adapter.

### Option B: a custom prefix layer built on CM6 commands

A custom layer is small for characters, lines and basic groups. It is less small once exact Vim words, sentences and Markdown structures are required. The existing installed CM command declarations distinguish character, group and line operations; “group” is not automatically Vim `w/b/e`. mdpro's Markdown extension already gives access to parsed syntax. [Installed CM commands declarations](../../node_modules/@codemirror/commands/dist/index.d.ts), [Markdown extension:3](../../src/components/Editor/extensions/markdown.ts).

| Requested operation | Reuse without Vim | What must be defined or added |
|---|---|---|
| Character left/right | CM character movement/selection commands | Grapheme clusters, document ends, crossing line breaks; prefer CM's native movement when it matches the intended behavior. |
| Word forward/back/end; select word | CM group commands or `state.wordAt`, with a stated definition | Vim word vs punctuation groups vs natural-language/CJK segmentation. Existing Select Word invokes `selectNextOccurrence`, so repeated use adds matches; that is not the same as idempotently selecting the current word. [search.ts:34](../../src/components/Editor/extensions/search.ts) |
| Sentence motion/selection | No directly matching stock CM sentence command identified | Abbreviations, quotes, Markdown inline syntax and CJK `。！？`. Use Vim semantics only if the product accepts them; “sentence” must not silently promise linguistic correctness. |
| Paragraph motion/selection | Small blank-line scanner, or syntax-node traversal | Blank-line-delimited source paragraph vs Markdown paragraph node; surrounding separators; fenced blocks and list continuations. |
| Line up/down/start/end | CM line and boundary commands | Visual wrapped row vs logical source line; indentation start vs column zero; Vim character position vs insertion boundary at EOL. |
| Previous/next heading | Markdown syntax-tree traversal | ATX and Setext headings, level policy, excluding apparent headings inside fences. |
| Previous/next list item | Syntax-tree traversal | Nested depth, sibling vs any item, task items, loose-list continuation paragraphs. |
| Select Markdown block | Syntax-tree range | Paragraph, heading, fenced code, quote, list item/list and table; whether delimiters and trailing newline belong to selection. |

For consistent behavior, choose each operation's semantics independently of implementation. Replit can supply Vim words/text objects; CM can supply standard caret movement; Markdown traversal can supply structural commands. An action table can hide these backend choices from the prefix controller.

### Option C: prefix now, full Vim optionally later

Use a small command interface such as `moveWordForward`, `selectParagraph`, `nextHeading`, rather than exposing Vim key strings to UI/settings. Start with native CM actions where they fit and a **replit-backed adapter for the harder generic motions/text objects if the lifecycle proof passes**. Keep Markdown structure actions local. This preserves a future separate “Full Vim” mode without making the prefix feature depend on users understanding Vim states.

If Full Vim is later added, choose one active keyboard mode per Source editor; do not quietly stack two competing controllers. Normal-mode leader bindings can reuse the same semantic actions/help, but full Vim's editing grammar, mode status and shortcut delegation need their own product contract.

| Option | Coding saved | Remaining cost / tradeoff |
|---|---|---|
| A: full Vim | Most generic Vim grammar and editing behavior | Highest product mismatch for this request; broad key/IME/undo integration surface. |
| B: custom prefix + CM | Avoids a Vim dependency and transient lifecycle | Lowest cost for a narrow CM-like v1; word/sentence/text-object parity becomes custom work. |
| **C: prefix with bounded reuse, full Vim deferred** | Reuses the proven generic engine while keeping the requested UI | Adds dependency/lifecycle validation, but avoids writing a second Vim motion engine. Recommended, conditional on a small integration proof. |

## 4. Prefix conflicts, platforms and composition

K4 assigns one owner per chord/platform/focus context; K5 forbids OS-owned defaults. The raw historical inventory is not the active v2 keymap: its projection drops removed, shadowed and superseded configurable entries. Check active ownership plus the user's applied bindings, not a grep hit alone. [K4/K5 plan:392](../../docs/plans/20261015-plan-menu-reorganisation.md), [bindingOwners.ts:66](../../src/commands/bindingOwners.ts), [bindingConflicts.ts:11](../../src/commands/bindingConflicts.ts).

| Candidate | mdpro / platform conflict | Assessment |
|---|---|---|
| **Ctrl+;** | No owner found among the inspected v2 default rows, surviving inventory and reserved lists. Ctrl remains distinct from Cmd on macOS; off-Mac it normalizes to the primary control modifier. Punctuation location and IME/vendor bindings vary. | **Best provisional default on macOS and Windows/Linux among those examined**, with a configurable alternative and layout/device verification. Not universally guaranteed free. |
| Ctrl+B | Mac CM/native backward-character behavior; Windows/Linux Bold. | Do not copy herdr's default. |
| Ctrl+K / Cmd+K | Mac Ctrl+K kills to EOL; Cmd+K inserts a link. Off-Mac Ctrl+K inserts a link. | Occupied. |
| Ctrl+O | Mac editor open-line behavior; off-Mac Open. Also the Vim one-command key internally. | Use only as an internal engine sequence, not the product prefix. |
| Ctrl+Space / Cmd+Space | Completion and input-source shortcuts; Spotlight for Cmd+Space. | Avoid. |
| Ctrl+Alt+letter | AltGr text production on Windows/Linux; Ctrl+Option is the default VoiceOver modifier on Mac; desktop/IME bindings vary. | Not a safe portable family. |
| Alt+Space | Windows system window menu. | Reject as a cross-platform default, even though some leader packages show it as an example. |
| Bare Space, `;`, or Escape | Printable input or established cancellation/composition behavior. | Do not activate the layer by intercepting ordinary typing or every Escape. |
| F6 / F3 / F8 / F11 | View switching / find / lint inventory / off-Mac fullscreen; hardware Fn/media behavior also varies. | Do not assume function keys are free. An independently checked, remappable function key is only a fallback candidate. |

Local evidence: [formatRows.ts](../../src/commands/rows/formatRows.ts), [fileRows.ts](../../src/commands/rows/fileRows.ts), [viewRows.ts](../../src/commands/rows/viewRows.ts), [paragraphRows.ts](../../src/commands/rows/paragraphRows.ts), [tableRows.ts](../../src/commands/rows/tableRows.ts), [CodeMirror inventory:61](../../src/commands/inventory/codemirrorRows.ts), [reservedChords.ts:15](../../src/commands/reservedChords.ts).

The reserved table is deliberately narrower than all possible OS/IME/user shortcuts. A missing entry is not an OS guarantee. Apple documents input-source, Spotlight and native text shortcuts; Windows documents Alt+Space and input switching; VoiceOver documents its modifier choices. Linux desktop/window-manager settings need separate checks. [Apple shortcuts](https://support.apple.com/en-us/102650), [Windows shortcuts](https://support.microsoft.com/en-us/accessibility/windows/keyboard-shortcuts-in-windows), [VoiceOver commands](https://support.apple.com/guide/voiceover/commands-category-voe7adb19917/10/mac/27).

**Composition contract:** only arm from the actual focused Source content surface, outside composition. Ignore composing events, legacy composition key code 229 where needed, `Dead`/`Process` events and printable AltGr. Cancel an already-pending prefix on `compositionstart`; never consume IME candidate navigation or commit keys. Do not automatically switch input sources. Guard order must preserve ordinary AltGr text production. A browser's event sequencing near composition boundaries is why checking only one `isComposing` value is insufficient. [MDN keydown](https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event), [key values](https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values).

Suffixes are logical characters, not US-keyboard physical positions by default. Shifted symbols such as `$`, `{` and `}` make a purely traditional Vim map less convenient across layouts; offer clearly documented aliases or a later remapping facility after testing. Source-only scope also excludes find/replace inputs, dialogs, the shortcut recorder, sidebar search and WYSIWYG—even if some are descendants of an editor container.

## 5. Product fit, accessibility and verification

### Settings, help and pending-state behavior

Propose an opt-in **Source keyboard navigation** switch, the configurable prefix chord in the existing shortcut system, and a compact cheat sheet. A future Full Vim choice should be clearly distinct. Keep shortcut application consistent with the current restart contract; any live-apply redesign is separate scope.

The design's status strip is useful as a location, but it is a **target design**, not proof that the component is already shipped. It currently lists cursor position, word count, encoding and EOL. Its semantics explicitly say the `Document status` group is not a live region, and it explicitly excludes a command-palette hint. A navigation indicator therefore needs a small documented design addition, not an assumed existing slot or an invented palette. [DESIGN.md:6](../../design/DESIGN.md), [status strip:686](../../design/DESIGN.md).

Show `Navigation — Esc cancel · ? help` while pending. Keep it visible at narrow widths, without moving focus. If the strip is unavailable, provide a scoped editor-edge indicator rather than blocking on the entire strip implementation. Use a separate, brief polite announcement for entering/canceling navigation; do not make all cursor/status updates live. Help must be keyboard accessible, identify the configured prefix and show the current mode/scope. [WCAG character-key shortcuts](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html) explicitly covers character-only sequences and distinguishes paths opened by a non-character shortcut. Ctrl+; followed by a suffix is in the latter family; focus scoping and disable/remap controls remain useful design protections.

Recommended v1 lifecycle, pending product confirmation:

- No timer by default: wait for one command, Escape or another cancellation event. If a timeout is later added, allow disabling/extending it; herdr has not supplied evidence for a particular duration.
- Escape or a repeated activation chord cancels. Repeated prefix cancellation is an mdpro choice, unlike herdr's terminal forwarding.
- A recognized suffix executes once and disarms. Unknown printable input cancels and is left to ordinary typing; never synthesize/replay a DOM key. This avoids swallowing text but means a mistyped suffix can insert text, so explain it and test it. Consuming unknown input instead is an explicit alternative product choice.
- An unrelated modified app shortcut cancels and falls through to its existing owner. A held key must not run the command repeatedly or leak repeated suffix characters after disarming; track key release deliberately.
- Blur, pointer relocation, composition, paste, document/view switch, editor-generation change, disablement and destruction clear pending state. Pending state belongs to one editor instance, not a global timer or stale closure.

### Verification that the dependency does not remove

A later implementation should test observable document/selection behavior, not just mocked calls to `Vim.handleKey`:

| Layer | Required evidence |
|---|---|
| Pure motion/range cases | Start/middle/end/empty document, blank lines, forward/backward selections, punctuation, CJK, emoji/ZWJ/combining characters, fenced blocks, Setext headings, nested/task lists, tables and trailing newline. State the expected ranges. |
| Prefix state machine | Disabled, not-ready/suppressed prefix, one command, Escape, unknown key, repeat/key-up, modified shortcut passthrough, focus/composition/paste cancellation, stale document/editor generation. |
| Real CM6/jsdom | Actual selection and document assertions, no document changes/dirty flag for navigation, existing undo history retained, selected text can be copied/replaced normally, plugin cleanup after success/failure, multiple-editor isolation, temporary extension absent after execution. Test multiple ranges explicitly; do not silently drop secondary cursors. |
| App keyboard integration | Applied snapshot and restart behavior, native menu/action ownership, no duplicate execution, view switching, table keys and withheld-table documents, search inputs and shortcut recorder excluded. |
| Device | macOS WKWebView with US and non-US layout, Chinese/Japanese composition, dead keys, VoiceOver, wrapped lines and real selection/copy/paste. For supported Windows/Linux builds, test their actual webviews, AltGr, IME and desktop accelerators separately. |
| Performance | Repeated commands, large documents, extension attach/detach cost, cursor/focus/scroll stability, first-use loading. Measure the production bundle delta separately. |

The scratch experiment is evidence of API feasibility only. It did not replace any of these acceptance checks. No project test/build gates were run for this read-only survey.

### WYSIWYG later

A CM6 extension cannot be installed into mdpro's rich-text engine. Shared pieces can include settings, prefix/help state and semantic command names. Movement and selection implementations must be rewritten against the rich editor's document/transaction model: rendered line positions, hidden Markdown syntax, links, marks, nested blocks, tables and node selections all differ. Replit's new core is editor-agnostic in packaging, but implementing its expected adapter over a rich document is not a small change. Treat WYSIWYG support as a separate substantial project; it is excluded from v1 as requested.

## 6. Recommendation, minimal v1 and work breakdown

**Choose Option C and first validate the transient replit adapter.** This answers the follow-up directly: integrating the package can save generic word/sentence/paragraph and selection work, and the simple samples required **zero upstream modifications**. The savings are strongest if users want Vim's established text-object semantics and later counts/full Vim. They are smaller if v1 only needs character/group/line navigation already provided by CM6. Do not promise a percentage reduction or a “few-line production integration” from the small experiment.

Use a bounded decision point: the adapter must preserve ordinary typing, selection, undo, focus and IME across the supported device matrix without private engine-state patches. If it passes, use it behind the action table. If it fails or reconfiguration is visibly expensive, retain the same prefix UX and implement the narrow actions with native CM6 commands. This fallback does not require redesigning settings/help.

### Proposed minimal command set

`P` below means the configured activation chord, provisionally **Ctrl+;**. Each row consumes one suffix; capital letters require Shift. These are proposed product bindings, not a claim about current mdpro or stock Vim.

| Sequence | Behavior | Suggested implementation |
|---|---|---|
| `P h`, `P l` | Previous/next character | Native CM character movement, with explicit newline/grapheme policy. |
| `P j`, `P k` | Next/previous visual row | Native CM vertical movement; retain desired horizontal position. |
| `P w`, `P b`, `P e` | Next word start, previous word start, word end | Replit motions if Vim semantics accepted; normalize the destination to the chosen caret-boundary contract. |
| `P 0`, `P $` | Logical source-line start/end | Native CM line boundary actions; specify before/after-last-character behavior. |
| `P {`, `P }` | Previous/next blank-line paragraph boundary | Replit paragraph motion or a small explicit scanner. |
| `P W`, `P P` | Select current word / paragraph as an ordinary CM selection | Replit `viw` / `vip` through the bounded adapter, or local range actions. |
| `P ?` | Show navigation cheat sheet | mdpro UI; Escape dismisses. |

This v1 deliberately omits editing operators, registers, macros, arbitrary vimrc, persistent Visual mode and counts. It also avoids a generic “select everything touched by movement” grammar initially. Word-end and paragraph behavior must be illustrated in the cheat sheet; retained familiarity does not justify ambiguous insertion positions.

**Next increment:** sentence motions `(`/`)` and sentence selection, heading navigation, list-item navigation and Markdown-block selection. Sentence reuse has a working ASCII sample, but CJK/abbreviation semantics need a decision. Heading/list/block actions should use Markdown syntax, not pretend they are solved by a generic Vim package. Counts such as `P 3w` are feasible with the engine, but change the product from one suffix to a parsed sequence and need a pending-buffer display plus cancellation rules.

### Proposed work items and tiers

These are planning suggestions, not registered work items or authorization to edit. Tiers follow behavior and paths in [ADR-0121:110](../../docs/adr/0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md); the highest applicable tier wins. Tests inherit the behavior they protect. Relative sizes are engineering estimates, not schedule commitments.

| Work package | Deliverable / completion evidence | Provisional tier | Relative effort |
|---|---|---|---|
| Interaction/semantics contract | Final prefix map, paragraph/word/EOL definitions, unknown-key/repeat policy, Source-only exclusions and design/help update | Low if docs/design only | Small |
| Dependency and reuse proof | Pin adapter/core; license accounting; real CM lifecycle/selection/history/IME proof; compare bundle and latency; accept adapter or choose local fallback | **High** for package/lock changes and integration guards | Medium, with an early stop if private patches are needed |
| Activation and preference plumbing | Configurable Source command, effective ownership checks, startup applied snapshot, persisted enablement, restart messaging | **High**: preference writes, possible Rust/menu/service work | Medium |
| Prefix controller and minimal actions | Scoped pending state; validated actions; cleanup; ordinary selections; no content mutation | Medium if limited to selection/UI code; raise to High if content mutation/isolation paths are involved | Medium |
| Discoverability and accessibility | Indicator, cheat sheet, limited announcements and narrow layout behavior | Medium for interactive TSX; Low only for isolated presentation/docs | Small–Medium |
| Structural/CJK expansion | Sentence contract, heading/list/block actions, syntax-boundary fixtures | Medium for selection-only behavior; higher if broader semantics/path rules apply | Medium |
| Device and regression completion | Native key/IME/AltGr/VoiceOver results, action ownership, history and editor-isolation evidence | Tests take the protected behavior's tier; isolation guards can be High | Medium |
| Optional full Vim later | Separate mode choice, app-key delegation, operators/undo/search/ex-command policy and compatibility matrix | High when it introduces editing behavior/preferences | Large; separate project |

The ADR decision table is authoritative; the eventual scope determines the tier, rather than these preliminary estimates.

### Decisions still needed before implementation

1. Confirm Ctrl+; as the provisional default and which keyboard layouts/platforms must be supported at first release.
2. Accept Vim word/paragraph semantics, or require natural-language/CJK-aware segmentation? This most directly changes how much code the package saves.
3. Confirm single-shot navigation; no counts/sticky mode/held-key repetition in v1, or widen the grammar deliberately.
4. Confirm unknown-key passthrough versus consumption, repeated-prefix cancellation and timeout policy.
5. Decide visual-row vs logical-line movement, word-end caret boundaries, paragraph separator inclusion and the behavior with an existing/multiple selection.
6. Confirm opt-in/default-off, restart application, and the small addition to the status/help design.
7. Decide whether sentence/heading/list/block operations belong in the first release or the next increment; the minimal proposal above defers them.

These are decision records for the delegator/user, not questions that block completion of this research report.

## Sources

All links below are primary product documentation, upstream source/release artifacts, or local inspected source unless explicitly identified as a user report. Access date: 2026-10-23. Local line links refer to the inspected main checkout and may move; upstream commit links are pinned where available.

- herdr: [keyboard](https://herdr.dev/docs/keyboard/), [configuration](https://herdr.dev/docs/configuration/), [configuration reference](https://herdr.dev/docs/config-reference/), [source at inspected commit](https://github.com/herdrdev/herdr/tree/5bd900d88c80d95f5b145397e45bbeea398b8165).
- Obsidian: [settings](https://obsidian.md/help/settings), [Live Preview](https://help.obsidian.md/Live%2Bpreview%2Bupdate).
- Typora: [official shortcuts](https://support.typora.io/Shortcut-Keys/), [user-reported source-only workaround](https://github.com/typora/typora-issues/issues/6445).
- VS Code: [Markdown](https://code.visualstudio.com/Docs/languages/markdown), [VSCodeVim](https://github.com/VSCodeVim/Vim), [VSpaceCode](https://vspacecode.github.io/docs/), [which-key](https://vspacecode.github.io/docs/whichkey/), [mapping conflicts](https://vspacecode.github.io/docs/troubleshooting/).
- Zettlr: [settings](https://docs.zettlr.com/en/reference/settings.html), [status bar](https://docs.zettlr.com/en/editor/statusbar.html).
- MarkText: [current end-user documentation](https://github.com/marktext/marktext/tree/44903ac23446a5e2710f8f07d51928d27a334173/packages/website/content/docs/end-user).
- Logseq: [official command list](https://logseq.io/page/d725f627-7fdf-4144-a8aa-3af618cf7886/184bd8ad-4d4e-4241-93c5-1344678d5a11), [Vim Shortcuts plugin](https://github.com/vipzhicheng/logseq-plugin-vim-shortcuts).
- Joplin: [current settings source](https://github.com/laurent22/joplin/blob/280954e58fc7c9e74200fd817272ac3fb80dcead/packages/lib/models/settings/builtInMetadata.ts#L1933), [Vim adaptation](https://github.com/laurent22/joplin/blob/280954e58fc7c9e74200fd817272ac3fb80dcead/packages/editor/CodeMirror/utils/setupVim.ts), [vimrc plugin](https://joplinapp.org/plugins/plugin/io.github.personalizedrefrigerator.joplin-vimrc/), [historical CM6 issue discussion](https://discourse.joplinapp.org/t/codemirror-6-vim-mode-issues/35135).
- iA Writer: [settings](https://ia.net/writer/support/basics/settings), [shortcuts](https://ia.net/writer/support/basics/shortcuts?platform=windows).
- Bear: [Mac shortcuts](https://bear.app/faq/mac-keyboard-shortcuts/).
- Zed: [Vim](https://zed.dev/docs/vim), [Markdown](https://zed.dev/docs/languages/markdown).
- Helix: [keymap and minor modes](https://docs.helix-editor.com/keymap.html).
- Emacs ecosystem: [Evil overview](https://evil.readthedocs.io/en/latest/overview.html), [Spacemacs quick start](https://www.spacemacs.org/doc/QUICK_START.html), [Spacemacs documentation](https://www.spacemacs.org/doc/DOCUMENTATION.html).
- IdeaVim: [JetBrains setup](https://www.jetbrains.com/help/idea/using-product-as-the-vim-editor.html), [upstream](https://github.com/JetBrains/ideavim).
- VMark: [settings](https://vmark.app/guide/settings), [shortcuts](https://vmark.app/guide/shortcuts.html), [source](https://github.com/xiaolai/vmark).
- Replit: [repository](https://github.com/replit/codemirror-vim), [inspected commit](https://github.com/replit/codemirror-vim/commit/8640966b6977f84d2197e6adfd521fb737184587), [adapter 6.4.0 metadata](https://registry.npmjs.org/@replit%2fcodemirror-vim/6.4.0), [core 0.1.0 metadata](https://registry.npmjs.org/@replit%2fcodemirror-vim-core/0.1.0), [published adapter source](https://unpkg.com/@replit/codemirror-vim@6.4.0/dist/index.js), [published types](https://unpkg.com/@replit/codemirror-vim@6.4.0/dist/index.d.ts), [published core](https://unpkg.com/@replit/codemirror-vim-core@0.1.0/vim.js).
- Platform/accessibility: [Apple keyboard shortcuts](https://support.apple.com/en-us/102650), [Windows keyboard shortcuts](https://support.microsoft.com/en-us/accessibility/windows/keyboard-shortcuts-in-windows), [VoiceOver modifier/commands](https://support.apple.com/guide/voiceover/commands-category-voe7adb19917/10/mac/27), [WCAG character shortcuts](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html), [MDN keydown/composition](https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event), [MDN key values](https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values).
- mdpro: main checkout at `f35136de5d199410e89735dd3920b962176e9ba5`; specific source/design/ADR/plan locations are cited inline. Scope was read-only. Experiment outputs are original survey observations, not upstream claims or project test receipts.
