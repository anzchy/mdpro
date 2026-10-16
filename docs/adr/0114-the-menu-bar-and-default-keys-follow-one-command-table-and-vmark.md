# 0114. The menu bar and the default keys follow one command table and VMark's keys

**Status**: Proposed (2026-10-16; revised the same day after Codex review
`review-plan-mvawf13f-abenbn`, C0 · H4 · M7 · L0, and again after
`review-plan-mvawsvrd-4f6afe`, C0 · H1 · M5 · L0). Drafted by mdpro-a6 as
WI-M0 of the [menu reorganisation plan](../plans/20261015-plan-menu-reorganisation.md),
number reserved by mdpro-delegator. Every decision quoted below was already
taken by the user (relayed by the delegator, plan § 0); this record collects
them, with the rules and contracts the plan derived from them, so M1a can be
built against one accepted record. Partially supersedes ADR-0096 and ADR-0090,
and extends the empty-binding repair documented under ADR-0031 step 4
(§ Decision 7). U10, U11 and U12 are open; K3 and K4's native-focus case are
gated, not decided (§ Decision 8).

## Context

- **The menu and the keys disagree with each other and with the OS.** On the
  2026-10-14 device runs (Mac and Windows, build `50c67c5`) ⌥⌘Q (Quote) quit
  the app, ⌘H (Replace) hid it, ⌘\` (Switch Documents) cycled windows, and
  Windows showed Image as Ctrl+I, Italic's key. The menu labels (`menu.rs`
  literals), the stored defaults (`preferences.ts` / `preferences.rs`) and the
  editor keymaps (`typoraKeymapPlugin.ts:165-174`, `headingPlugin.ts:101-112`,
  `Editor.tsx:95-109`, all literal chords) are written independently, so
  nothing keeps them in step (plan §§ 3, 5.4).
- **Rebinding barely works today.** Each window reads the stored keys once at
  hydration (`App.tsx:117, 219-220`) and only the hook consumes them. Settings'
  save does not update the running window's copy, so a rebind reaches only
  windows mounted after it; the editors' own literal keys and the native menu
  never see it.
  Settings highlights duplicate chords but saves them
  (`KeyboardShortcutsSettings.tsx:124-134, 183-191`).
- **26 menu actions do nothing on macOS** (D255, the
  [shortcuts audit](../test/20261016-shortcuts-mac-audit.md)), and the user
  merged D255 into this plan for v0.3.6 (D7).
- **The 0.3.5 preferences cannot store "no key".** An empty binding is
  repaired to its default on every read. This is "decision D-b", an
  implementation decision taken under ADR-0031 step 4 (contract alignment) and
  recorded in code, not in the ADR's text: `models/preferences.rs:315-345`,
  whose comment records the cost "a user can never deliberately unbind a
  shortcut … reversing this needs a new ADR".
- **The M2 spike measured what the plan could not read from code**
  ([record](../test/20261016-m2-menu-spike-device-check.md), spike
  `02846d6c`, never landed): with the predefined Hide replaced by a keyless
  item, ⌘H reaches the page on macOS and nothing hides; ⌃Tab and F6 reach the
  page on macOS; Windows shows none of VMark #1354's symptoms after a menu
  Copy; from a menu click the web clipboard API can **write** (`writeText`,
  `write` with `text/html`, `execCommand` copy / cut) but **cannot read**
  (`navigator.clipboard.read` raises a WebView2 permission prompt even from a
  button with a user activation); release WebView2 leaves Ctrl+Shift+I and F6
  to the page; an input-method hot key took Ctrl+Shift+0 on the test PC before
  the app saw it; German AltGr `[ ] \` are eaten in Source by CodeMirror keys
  (D264); K3 could not be answered (its probe chord was the one the OS took),
  and a title-bar click did not take focus out of WebView2, so K4's
  native-focus case was not reached.

## Options considered

- **Key policy.** (a) **VMark's `DEFAULT_SHORTCUTS` on both platforms**
  (pinned `xiaolai/vmark@e0a982d`): chosen, D2. (b) Typora's keys: lost; its
  Windows set is partly undocumented and its Mac set reverses Indent /
  Outdent (plan § 8). (c) Keep mdpro's keys and fix only the collisions:
  lost on product grounds, not structural ones (a single table works with any
  key set): today's keys carry the OS collisions above, follow no published
  convention, and give the D255 commands no reference key. Within (a), the
  user departed from VMark item by item where a different key had a stronger
  convention (D9, D10, D11, D12, D13).
- **When a changed binding takes effect.** (a) **One applied snapshot per
  run**: chosen; see Decision 4. (b) Live activation, coordinated across the
  windows, the editors and a native menu rebuild: deferred to WI-M8; it needs
  muda accelerator re-registration and a cross-window broadcast, and today
  nothing is live anyway. (c) Each consumer reads the file when it builds:
  refused; a Settings save followed by an unrelated menu rebuild would put a
  new key on the menu while the editors still run the old one.
- **Two custom values on one chord.** (a) **Neither binds; both are kept and
  flagged, with a notice at each launch until repaired**: chosen; see
  Decision 5. (b) A winner by table order: lost; it
  silently picks for the user and the loser's key still looks bound in the
  file. (c) Rewrite one to `<unassigned>` on load: lost; it changes a value
  the user set.
- **Underline (§ 5.8 row 6).** (a) Disabled in both modes under D3, as
  D255-WI-1 proposed: lost. (b) **A Milkdown mark that parses and serialises
  `<u>…</u>`, plus a Source wrap**: chosen, 「Build an underline mark」.
  (c) Source-only wrapping: lost; WYSIWYG would show the written markup as
  literal tags, since preset-commonmark renders inline HTML as a raw atom.
- **Menu clipboard API (§ 5.7).** (a) **The web API for writes** (async
  `write` with `text/html` + `text/plain`, or `execCommand`): chosen, M2(c)
  shows both work from a menu click. (b) Web API for reads: refused; it
  prompts. (c) Tauri's `clipboard-manager` plugin for everything: not chosen
  now; it is a new dependency, and needs its own ADR if a menu Paste is ever
  built (see U10).
- **Stored "no key".** (a) Reuse `""`: lost; it would change D-b's repair
  under every existing file. (b) **Explicit sentinel values `"<unassigned>"`
  and `"<system>"`**: chosen; `""` keeps its meaning. (c) Delete the field:
  lost; an older build would re-add its default.

## Decision

1. **The user's decisions D1–D17 stand as plan § 0 records them**, quoted
   there; the load-bearing ones:
   - D1 「Typora-style + slim Windows (Recommended)」: a Paragraph menu; no app
     menu and no Window menu off-Mac; Settings and Exit in File, About in Help
     (trees § 5.1 / § 5.2).
   - D2 「遵循vmark的相关keyboard convention」: default keys follow VMark on
     both platforms, except where VMark's key is OS-owned or VMark has none.
   - D3 「Show them disabled」, narrowed by D7 「合并进 v0.3.6 (Recommended)」:
     an action with no command is built where feasible (D255) and shown
     disabled, and "Not available" in Settings, only where it is not.
   - D8 「A · Plan as written, greyed」 (DESIGN.md's native-menu block is
     normative for M4, M5, M7).
   - D9 「B · Typora's Ctrl+Shift keys (Recommended)」, D10 「C · ⇧⌘B
     (Recommended)」, D11 「C · ⌘/ first, F6 second」, D12 「B · Keep ⇧⌘L
     (Recommended)」, D13 「Mac ⌘H  for Replace, ⌘F for find, Ctrl + H for
     replace on Windows」 with its consequence 「Accept: Hide has no key
     (Recommended)」, D14 「A · As prototype A drew it (Recommended)」, D15
     「B · Build F11 full screen (Recommended)」, D16 「A · ⇧⌘T / Ctrl+Shift+T
     (Recommended)」, D17 「A · Ctrl+Shift+X (Recommended)」.
   - D4 (an old default is migrated to the new one), D5 ("Settings…" on
     macOS) and D6 (Linux built with the Windows tree, untested) are the
     plan's defaults, accepted without a separate answer.
2. **Rules K1–K8 (plan § 5.3.1) govern every default key**, and the § 5.3.2
   table is the resulting set, incorporated by reference. **Paragraph off-Mac
   keeps VMark's Ctrl+Shift+0** with a stated, per-machine limitation: Windows
   does not reserve the chord, but an input-method hot key can take it first
   (M2(d1); K5 records it, `9d8cb9e8`). Where that happens, Paragraph stays
   reachable from the Paragraph menu and can be rebound in Settings, and
   Settings' row says so; no command may rely on the chord alone (K5).
3. **One command table** (`src/commands/commandTable.ts`, with a generated
   `src-tauri/src/menu_layout.json`) is the single source of menu paths,
   keys, availability and routes (plan § 5.5). Each row carries, per platform:
   - a **primary** binding (the one the menu shows; `configurable` or
     `fixed`) and zero or more **fixed secondary** bindings that run the same
     command and are never shown on a native item (F6 for the view toggle,
     F3 / Shift+F3 in Source, Ctrl+Y for Redo);
   - the **ownership contexts** in which each binding acts (editor W, editor
     S, inside a table, modal or Settings input, shortcut recorder, native
     focus), so the in-table keys and add-cursor are distinct owners (C17);
   - `availability` and a `route` (`frontend`, `native`, `rust-quit`,
     `rust-hide` (macOS only, its `AppHandle::hide` call cfg-gated, no Hide
     item off-Mac), `unavailable`), matched exhaustively.

   Rust and TypeScript resolve bindings through one conflict filter generated
   from the table; besides JSON parity, a shared behavioural fixture of
   (platform, context, chord, stored keys) → expected owner is run by both
   resolvers. A menu click is bound to its window and checked again at the
   final mutation (D261).
4. **Every configurable consumer binds from one applied snapshot per run.**
   At startup Rust loads and migrates the preferences once and resolves the
   **applied binding set**; that set, not the file, feeds every native menu
   build and rebuild of the run and every window (a window opened later asks
   Rust for it rather than reading the file). **Every keymap that binds a
   configurable command** consumes the resolved set: the hook, the Milkdown
   keymaps (`typoraKeymapPlugin.ts`, and the preset keys the menu now owns,
   such as `Mod-b`), the CodeMirror keymaps (`headingPlugin.ts`,
   `highlightPlugin.ts`, `Editor.tsx`'s view keymap, search). A custom value
   replaces the literal and `<unassigned>` removes it in every one, preset
   fallbacks included: an unassigned Bold leaves ⌘B doing nothing in W and S.
   A Settings save writes the file and takes effect at the next launch, for
   every window and the menu together. **A window opened later in the run
   gets the run's snapshot, not the saved file**: this changes today's
   behaviour, where a newly mounted window hydrates the saved values. Live
   activation is WI-M8. M1b owns the consumer change and its tests, through
   the composed editors.

   **Pending state is saved versus applied.** A row is "pending" when its
   saved value differs from the applied snapshot, whatever the Settings
   dialog's unsaved state is (today's Save clears the dirty flag and closes,
   `KeyboardShortcutsSettings.tsx:183-191`, so "dirty" cannot carry it). Such
   a row shows the active key and the pending one ("Active: ⌘K · after
   restart: ⇧⌘K"), in every window, until the next launch applies it. M7
   owns this, with acceptance cases: Save, then reopen Settings; Save, then
   open a new window and its Settings; repair a suppressed duplicate (still
   pending, still suppressed until restart). M7 lands before M1b (plan § 6
   order) and reads the applied set through M1a's IPC, so the pending
   display is in place when M1b first binds from the snapshot.
5. **Stored keys** (plan § 5.6): `keyboardShortcutsVersion` (absent = 1)
   migrates on Rust's load path only, replacing a value that equals a v1
   default with the v2 default; the version moves to 2 only with the full
   map. `"<unassigned>"` and `"<system>"` are explicit stored states; `""`
   keeps D-b's repair; fields are kept, never deleted. Collisions, decided
   the same way in Rust, the editors and Settings:
   - custom vs a new default: the custom value wins, the default is stored
     `<unassigned>`;
   - custom vs a fixed, native, reserved or editor-owned chord: stored, not
     bound, flagged "Conflicts with …, not active", and named by the same
     launch notice as below;
   - **custom vs custom** in a shared context (already possible in files
     written today): **both stay stored, neither binds**, both rows are
     flagged, and the menu shows neither key; Settings refuses to save a new
     duplicate, so the state only arises from older files. **This can stop
     a key that works today** (two custom values on one chord run whichever
     branch the hook tests first, `useKeyboardShortcuts.ts:164-193`, e.g.
     New over Save), so it is never silent: while any suppressed conflict
     exists, each launch shows a **conflict notice** in the focused window
     naming the chord and the commands ("⌘K is set for New and Save, so
     neither runs"), with an action that opens Settings at the Keyboard
     Shortcuts page on those rows, dismissible for that launch only. The
     commands keep their menu items (enabled wherever the command is
     available), so each is still reachable.
     The notice ships in M1b, the commit that first suppresses; its look
     follows DESIGN.md, and goes to the user as a prototype if DESIGN.md has
     no matching component. It differs from D8's rejected banner: that
     banner would have announced changed defaults to every user; this notice
     appears only when a value the user set no longer runs, names it, and
     goes away when it is repaired. Test: upgrade from a file with a
     duplicate → notice names both → repair in Settings (shown pending) →
     restart → both keys run, no notice;
   - an **unavailable command's default still reserves its chord**, so a
     command built later is enabled without a conflict; it binds nothing
     while unavailable, and a custom value on that chord wins as above.
6. **D255 is carried out per plan § 5.8**, as corrected by D255-WI-1
   (`147d8f9d`) and the Underline decision (`33aa6983`); Underline is built in
   both modes (Options, above). Menu Copy-type actions write through the web
   clipboard API; nothing in this plan reads the clipboard from a menu click
   through the web API.
7. **Superseded or extended, by name:**
   - [ADR-0096](0096-on-windows-and-linux-ctrl-digits-are-headings-and-ctrl-slash-switches-the-view.md):
     (i) "Strikethrough moves off Ctrl+Shift+\` there: it takes Alt+Shift+5"
     and "macOS keeps ⌃⇧\` for strikethrough" → ⇧⌘X / Ctrl+Shift+X (D17);
     (ii) "The stored preference strings are not changed … Nothing reads these
     three values to bind a key" (`formatStrike`, `viewSource`,
     `viewWysiwyg`) → the strings are migrated with the rest, and every
     stored key binds through Decision 4. Its heading, inline-code, view-item
     and Ctrl+/ clauses stand (D11).
   - [ADR-0090](0090-windows-and-linux-quit-through-the-quit-guard.md):
     (i) "Off macOS the app menu carries a custom Exit … 'Stop Waiting and
     Quit…' follows it directly" → both move to the File menu (D1), Exit still
     directly followed by the escape item; (ii) "Exit has no accelerator" →
     Ctrl+Q through a new `request_quit` command (M6). Its quit guard path
     (`QuitGuard::request_quit`), the escape item and its order, the
     server-file cleanup and the headless `native_fallback` stand unchanged.
   - The empty-binding repair under ADR-0031 step 4 (D-b, recorded in
     `models/preferences.rs`): **extended, not reversed**. `""` is still
     repaired to the default; `"<unassigned>"` adds the deliberate unbind D-b
     said it could not offer. ADR-0031's own decisions are untouched.
8. **Open, and what may land before each is answered:**
   - **U10, U11, U12** are the user's. M5 builds no clipboard items before
     U10; D255-WI-2/3c build no WYSIWYG find before U12.
   - **K3** (does a greyed item that carries a key still take its chord):
     owner mdpro-a6; evidence: the spike rebuilt with a chord the OS does not
     take (Ctrl+Shift+9 reached the page in M2(d1)), run on macOS and Windows
     in three steps, each in the editor with the webview focused: **enabled**
     (the accelerator works: `spike.m2.k3.fired` present), **greyed**
     (`k3.fired` absent; record whether `spike.m2.key` `capture` is present),
     **re-enabled** (`k3.fired` present again). The run counts only if both
     enabled steps fire; without them a "greyed, nothing fired" result could
     mean the accelerator was never installed. M1a may land without it. **M4 and M5 render a disabled item with
     its accelerator only after it passes**; until then, or if it fails, a
     disabled item carries **no** native accelerator and Settings shows its
     key.
   - **K4, native-window focus** (does a menu accelerator fire, once, with
     WebView2 unfocused): owner mdpro-a6; evidence: a Windows probe that
     really takes focus out of WebView2 (the title-bar click did not). M1a and
     M1b may land without it. M5 keeps today's arbitration (native
     accelerator plus the DOM keymap, which the 2026-10-14 Windows runs showed
     running each command once **with the webview focused**). That is a
     provisional choice, **not** K4's guarantee: the native-focus case stays
     unverified on M5's changed items, and M5's ledger rows say so, until the
     probe runs on M5's build. If the probe shows a command running **twice**,
     that is a BLOCK on M5: the off-Mac native item drops its accelerator for
     every command a DOM keymap owns, and the label moves to the item text. If
     it runs **zero** times, it is registered as a D item and recorded as a
     known limitation (the menu click still works), and M5 may land.
9. **Each WI asserts only what holds at its commit.** The table carries the
   **v1 defaults** (today's keys, also the migration's "old default" side)
   and the **v2 defaults** (§ 5.3.2), inert until M1b. From M1a, the K5
   reserved-chord test and the one-owner check run on the **v2** table as
   data; the editor-owned inventory is read from today's composed keymaps.
   From M1b, when v2 becomes active and the editor keys are removed or
   rebound, both run on the active table and the post-M1b keymaps.

   **The persisted version covers configurable entries only.** `fixed`
   entries are never stored, so they are not migrated: each changes its key
   in the WI that builds its consumer. Off-Mac Redo keeps Ctrl+Y as its
   primary until M5's custom item makes Ctrl+Shift+Z the primary and Ctrl+Y
   the secondary; Exit has no key until M6's `request_quit` adds Ctrl+Q. A
   configurable entry whose command arrives later is `unavailable` until
   then (it reserves its chord and binds nothing, Decision 5). M1b's tests
   pin the applied table as it stands right after M1b: Redo off-Mac Ctrl+Y
   primary (Ctrl+Shift+Z still redoes through the editors' own keymaps), Exit
   with no key.

## Consequences

- **Gives:** one table drives the menu, the keys, Settings and dispatch, so a
  label can no longer advertise a key that runs something else. No default
  key is OS-owned on either platform. A user can unbind a key for the first
  time, and a rebind finally reaches every editor and the menu. D255's dead
  items either work or say they do not.
- **Costs:**
  - **Muscle memory breaks** for every changed default: Paragraph, heading
    level, Insert Table, Quote, Highlight, Strikethrough, Image, Switch
    Documents, Windows Redo's label, Exit. D8 shows no banner for it.
  - **Editor keys are lost**: CodeMirror's fold keys off-Mac (C12) and
    select-all-matches ⇧⌘L / Ctrl+Shift+L in Source (D12) have no key after
    M1b; Milkdown's `Mod-Alt-0…8` go to the menu's owners.
  - **Ctrl+Shift+T / ⇧⌘T go to Insert Table** (D16), so a later Reopen Closed
    Tab cannot take the usual browser key.
  - **Hide mdpro has no key on macOS**, against every Mac app's ⌘H; the user
    accepted this for ⌘H Replace.
  - **Paragraph's Ctrl+Shift+0 may not reach mdpro** on a Windows machine
    whose input-method hot key holds it; menu and rebind are the fallback.
  - **Ctrl+Alt chords stay AltGr-limited off-Mac** for Math Block, heading
    level and the six table keys; Settings says so. D264 must land in M1b or
    Source keeps eating AltGr characters.
  - **Underline is a new mark mdpro must parse and serialise** faithfully:
    a `<u>` pair split across other inline HTML, nesting with other marks,
    and byte-identical save of documents without underline are permanent test
    obligations (D255-WI-3b).
  - **A rebind waits for a restart** until WI-M8, and a window opened later
    in the run no longer picks up a saved rebind. Two custom values on one
    chord stop working until the user repairs them; a notice says so at each
    launch, and the menu items still run the commands.
  - **Departures from VMark** (⌘/ first, ⇧⌘L, ⌘H / Ctrl+H Replace, ⇧⌘B,
    Ctrl+Shift keys off-Mac) mean "follows VMark" is a policy with a written
    exception list, not a sync.
  - **A downgrade to v0.3.5** reads the sentinels as unparseable chords and
    drops `keyboardShortcutsVersion` the next time it **writes** the file;
    the re-upgrade then re-runs the map on values still equal to a v1
    default. Accepted; **not yet tested**: M1b's acceptance captures a file a
    v0.3.5 build wrote after reading a v2 file and tests the re-upgrade from
    it (plan § 5.6).
  - **The command table is a new generated artefact** with a parity test and
    a shared behavioural fixture to keep two resolvers in step.
- **Forecloses:** a menu Paste or Paste as Plain Text built on the web API;
  either needs the `clipboard-manager` plugin and its own ADR. Re-syncing
  VMark's keys without a new plan row (K7). Live rebinding without WI-M8.
