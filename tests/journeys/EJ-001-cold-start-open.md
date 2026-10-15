# EJ-001 — Cold start opens the file given on the command line

```json journey
{
  "id": "EJ-001",
  "title": "Cold start opens the file given on the command line",
  "status": "active",
  "area": "文件与文档管理",
  "tier": ["full"],
  "platforms": {
    "macos": { "status": "required" },
    "windows": { "status": "n/a", "reason": "ADR-0047 spike journey: the driver spike and its baseline run on macOS only (ADR-0034 decision 2); a Windows cold-start journey is WI-E2E-7's" }
  },
  "fixtures": [],
  "tier0": [],
  "rust": [],
  "projection": "tests/journeys/projections/EJ-001.json",
  "ledger": [
    {
      "row": "Finder 文件关联",
      "cases": ["C1"],
      "covers": ["mdpro 未运行时，文件进首个窗口 main"],
      "partial": "只覆盖带路径参数直接启动二进制（J1a）；不含 Finder 双击与 open（J1b）、运行中再打开的路由、多文件"
    }
  ],
  "cases": [
    {
      "id": "C1",
      "mode": "S",
      "intended": "Run <BIN> <RUN>/adr0047-journeys.md with no instance running: one window `main`, one tab holding the file, active and clean, in the preset's Source mode; recentFiles holds the path; no draft is written"
    }
  ],
  "supersedes": [],
  "group": null
}
```

The catalogue form of ADR-0047's J1a, written as the sample journey for
E2E-WI-1 (plan acceptance 6). The spike document
[`docs/test/20261002-adr0047-journeys.md`](../../docs/test/20261002-adr0047-journeys.md)
stays the spike's evidence, and its criteria are frozen until WI-005's
baseline comparison is done (plan §4.9). WI-E2E-6 decides whether this entry
joins `group: "adr0047-spike"` and supersedes `J1a`.

## Why

It proves the cold-start path: a path on the command line reaches the first
window before the webview asks for it, and opens as a clean tab. Nothing
below the launcher reaches this. jsdom has no process start, no
`launch_state` handoff from Rust, and no first-window mount. **No Tier-0 or
Rust test is linked yet.** Choosing them, or writing them, is part of
WI-E2E-6, which takes in the spike group.

## Setup

- A `verify` bundle, run by the ADR-0047 launcher with `HOME` set to a new run
  directory `<RUN>` (plan §4.7, isolation).
- `<RUN>/.mdpro/config.json` holds the spike's preset preferences
  (`defaultViewMode` and `lastViewMode` `source`, `logging.level` `debug`).
- `<RUN>/adr0047-journeys.md` is a copy of
  `tests/manual-fixtures/adr0047-journeys.md`. The committed file is never opened.
- No mdpro instance is running.

## Steps

| # | Class | Action | macOS input | Windows input | Expected log | Expected state |
|---|---|---|---|---|---|---|
| 1 | `launcher` | Start the bundle with the fixture copy as its argument | `<BIN> <RUN>/adr0047-journeys.md` | n/a | Rust, in order: `app.launch` → `file.open.args_filtered {source:"cli"}` → `file.open.cli {filePaths:[<RUN>/adr0047-journeys.md], source:"cli"}` → `app.launch_state.set {count:1}` → `window.open {windowLabel:"main"}` → `app.ready`. From `main`, any order: `app.url_param_check {hasOpenParam:false}`, `app.launch_state.take {count:1}`, `app.launch_paths_check {pathCount:1}`, `file.open` start → success → `tab.open {documentId:D1, tabIndex:0}`, `preferences.set` start → success, one `view.mode.change {fromMode:"wysiwyg", toMode:"source", source:"setViewMode"}`. No `tab.switch` | One window `main`; one tab `adr0047-journeys.md`, active, clean; Source mode |

## Oracle

- **Log**: the step's slice, projected by
  [`projections/EJ-001.json`](projections/EJ-001.json), equals the expected
  log above. Every `fail` / `warn` / `error` line and every event outside the
  projection is reported (plan §4.4).
- **Disk**: at the journey's end mark (not at `ready:`), `config.json`'s
  `recentFiles` holds the copy's path. The drafts directory has no file for D1.
- **State**: window and tab as in the table.

## Controls

The launcher's own check that `mdpro.log` has an `app.launch` line after
start. Without it, a preference parse error turns logging off silently, and
C1 is recorded as 未执行.

## Failure condition

Any expected line missing or extra after projection; a `tab.switch` line; a
second window; the tab dirty; or `recentFiles` without the path at the end mark.

## Cleanup

The launcher's `quit`, then remove `<RUN>`. Run the cleanup even when the
journey fails.
