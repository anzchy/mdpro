# 0114. The menu bar and the default keys follow one command table and VMark's keys

**Status**: Proposed (2026-10-16). Drafted by mdpro-a6 as WI-M0 of the
[menu reorganisation plan](../plans/20261015-plan-menu-reorganisation.md),
number reserved by mdpro-delegator. Every decision quoted below was already
taken by the user (relayed by the delegator, plan § 0); this record collects
them, with the rules and contracts the plan derived from them, so M1a can be
built against one accepted record. Partially supersedes ADR-0096, ADR-0090
and ADR-0031 (§ Decision 6). U10, U11, U12, K3 and K4's native-focus case
are open and are not decided here.

## Context

- **The menu and the keys disagree with each other and with the OS.** On the
  2026-10-14 device runs (Mac and Windows, build `50c67c5`) ⌥⌘Q (Quote) quit
  the app, ⌘H (Replace) hid it, ⌘\` (Switch Documents) cycled windows, and
  Windows showed Image as Ctrl+I, Italic's key. The menu labels (`menu.rs`
  literals) and the stored defaults (`preferences.ts` / `preferences.rs`) are
  written independently, so nothing keeps them in step (plan §§ 3, 5.4).
- **26 menu actions do nothing on macOS** (D255, the
  [shortcuts audit](../test/20261016-shortcuts-mac-audit.md)), and the user
  merged D255 into this plan for v0.3.6 (D7).
- **The 0.3.5 preferences cannot store "no key".** An empty binding is
  repaired to its default on every read (ADR-0031 step 4, decision D-b,
  `models/preferences.rs:315-345`), whose recorded cost is that a user can
  never unbind a shortcut and that reversing it needs a new ADR. The new
  table needs "unassigned" and "system" as stored values.
- **The M2 spike measured what the plan could not read from code**
  ([record](../test/20261016-m2-menu-spike-device-check.md), spike
  `02846d6c`, never landed): with the predefined Hide replaced by a keyless
  item, ⌘H reaches the page on macOS and nothing hides; ⌃Tab and F6 reach the
  page on macOS; Windows shows none of VMark #1354's symptoms after a menu
  Copy; from a menu click the web clipboard API can **write** (`writeText`,
  `write` with `text/html`, `execCommand` copy / cut) but **cannot read**
  (`navigator.clipboard.read` raises a WebView2 permission prompt even from a
  button with a user activation); release WebView2 leaves Ctrl+Shift+I and F6
  to the page; an input-method hot key took Ctrl+Shift+0 on the test PC; and
  German AltGr `[ ] \` are eaten in Source by CodeMirror keys (D264).

## Options considered

- **Key policy.** (a) **VMark's `DEFAULT_SHORTCUTS` on both platforms**
  (pinned `xiaolai/vmark@e0a982d`): chosen, D2. (b) Typora's keys: lost; its
  Windows set is partly undocumented and its Mac set reverses Indent /
  Outdent (plan § 8). (c) Keep mdpro's keys and fix only the collisions: lost;
  it keeps two independent sources of truth and leaves the D255 gaps without a
  reference key. Within (a), the user departed from VMark item by item where
  a different key had a stronger convention (D9, D10, D11, D12, D13).
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
- **Stored "no key".** (a) Reuse `""`: lost; it would change ADR-0031's
  repair semantics under every existing file. (b) **Explicit sentinel values
  `"<unassigned>"` and `"<system>"`**: chosen; `""` keeps its meaning.
  (c) Delete the field: lost; an older build would re-add its default.

## Decision

1. **The user's decisions D1–D17 stand as plan § 0 records them**, quoted
   there; the load-bearing ones:
   - D1 「Typora-style + slim Windows (Recommended)」: a Paragraph menu; no app
     menu and no Window menu off-Mac (trees § 5.1 / § 5.2).
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
2. **Rules K1–K8 (plan § 5.3.1) govern every default key**: VMark first (K1),
   mdpro's key where VMark has none and it is free (K2), an OS-owned key only
   when a device run proves mdpro's item wins enabled and disabled (K3), one
   owner per chord per platform and focus context (K4), no OS-owned default
   for an editor command, pinned by a test (K5), one command table (K6), no
   automatic tracking of VMark (K7), and shifted digits and symbols matched on
   the physical key with AltGr still refused (K8). The § 5.3.2 table is the
   resulting default set; it is incorporated by reference, not restated.
3. **One command table** (`src/commands/commandTable.ts`, with a generated
   `src-tauri/src/menu_layout.json` and a parity test) is the single source of
   menu paths, default keys, availability and routes, in the format of plan
   § 5.5. Routes are `frontend`, `native`, `rust-quit`, `rust-hide` (macOS
   only, its `AppHandle::hide` call cfg-gated; no Hide item off-Mac) and
   `unavailable`, matched exhaustively. Menu accelerators come from the stored
   keys at menu build, through the same conflict filter as Settings. A menu
   click is bound to its window and checked again at the final mutation (D261).
4. **Stored keys** (plan § 5.6): `keyboardShortcutsVersion` (absent = 1)
   migrates on Rust's load path only, replacing a value that equals an old
   default with the new default; the version moves to 2 only with the full
   map. `"<unassigned>"` and `"<system>"` are explicit stored states; `""`
   keeps its ADR-0031 meaning; fields are kept, never deleted. A kept custom
   value beats a new default; a custom value on a fixed, native, reserved or
   editor-owned chord stays stored but is not bound.
5. **D255 is carried out per plan § 5.8**, as corrected by D255-WI-1
   (`147d8f9d`) and the Underline decision (`33aa6983`); Underline is built in
   both modes (Options, above). Menu Copy-type actions write through the web
   clipboard API; nothing in this plan reads the clipboard from a menu click
   through the web API.
6. **Superseded clauses, by name:**
   - [ADR-0096](0096-on-windows-and-linux-ctrl-digits-are-headings-and-ctrl-slash-switches-the-view.md):
     "Strikethrough moves off Ctrl+Shift+\` there: it takes Alt+Shift+5" and
     "macOS keeps ⌃⇧\` for strikethrough" → ⇧⌘X / Ctrl+Shift+X (D17). Its
     heading, inline-code, view-item and Ctrl+/ clauses stand (D11).
   - [ADR-0090](0090-windows-and-linux-quit-through-the-quit-guard.md):
     "Exit has no accelerator" → Exit takes Ctrl+Q through a new
     `request_quit` command on the same quit-guard path (D2, M6).
   - [ADR-0031](0031-preference-persistence-is-restored-in-dependency-order.md)
     step 4, decision D-b's recorded cost "a user can never deliberately
     unbind a shortcut": `"<unassigned>"` now expresses it. The `""` repair
     itself stands.
7. **Not decided here**: U10 (custom Windows clipboard items; the record
   leans to A, keep the predefined items), U11 (WebView2's native find and
   plain paste in WYSIWYG on Windows), U12 (the D255 find / replace
   prototype), K3 (a greyed keyed item and its chord; the M2 run could not
   answer because the OS took Ctrl+Shift+0) and K4's native-window-focus case
   (M2(f) did not reach it). Each is answered by the user or a device run and
   recorded in the plan and, where it changes a clause above, a new ADR.

## Consequences

- **Gives:** one table drives the menu, the keys, Settings and dispatch, so a
  label can no longer advertise a key that runs something else. No default
  key is OS-owned on either platform. A user can unbind a key for the first
  time. D255's dead items either work or say they do not.
- **Costs:**
  - **Muscle memory breaks** for every changed default: Paragraph, heading
    level, Insert Table, Quote, Highlight, Strikethrough, Image, Switch
    Documents, Windows Redo's label, Exit. D8 shows no banner for it.
  - **Hide mdpro has no key on macOS**, against every Mac app's ⌘H; the user
    accepted this for ⌘H Replace.
  - **Ctrl+Alt chords stay AltGr-limited off-Mac** for Math Block, heading
    level and the six table keys; Settings says so. D264 must land in M1b or
    Source keeps eating AltGr characters.
  - **Departures from VMark** (⌘/ first, ⇧⌘L, ⌘H / Ctrl+H Replace, ⇧⌘B) mean
    "follows VMark" is a policy with a written exception list, not a sync.
  - **A downgrade to v0.3.5** reads the sentinels as unparseable chords and
    drops the version field; the re-upgrade re-runs the map on values still
    equal to an old default. Accepted, and tested from a real old-build file.
  - **The command table is a new generated artefact** with a parity test, and
    accelerators change only at menu build until WI-M8's live re-registration.
- **Forecloses:** a menu Paste or Paste as Plain Text built on the web API;
  either needs the `clipboard-manager` plugin and its own ADR. Re-syncing
  VMark's keys without a new plan row (K7).
