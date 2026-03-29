# `/office-hours` Prompt Guide for mdpro

**How to read this**: Each prompt is copy-paste ready. The "What it unlocks" section tells you what the six forcing questions will surface. The "Respond with" hint tells you how to answer those questions to get maximum signal, not polished non-answers.

---

## How `/office-hours` Works for mdpro

When you run `/office-hours`, it:
1. Reads `specs/`, `CHANGELOG.md`, and `docs/guide/` to understand what exists
2. Asks your mode (builder vs startup)
3. Asks **one forcing question at a time** — answer honestly, not optimistically
4. Produces a design doc with an explicit "NOT in scope" section
5. Recommends next step (`/plan-ceo-review` or `/feature-workflow`)

**The session fails if you**: give polished answers, say "users want X" without naming who, or describe a solution before the problem is validated.

---

## Scenario 1 — Deciding What to Build Next (v0.3.0 Direction)

**When to use**: You've cleared the bug backlog (v0.2.2) and need to pick the next meaningful milestone without building the wrong thing.

### Prompt

```
/office-hours

I've shipped mdpro v0.2.2. The core editing loop works: WYSIWYG via Milkdown,
source mode via CodeMirror, file open/save/close, TOC sidebar, Find & Replace,
image drag-drop, MCP server, and basic HTML export.

I'm trying to decide what to build next. I personally use mdpro daily for writing
technical notes and specs. I also share it with a few friends who write long-form
markdown documents. The biggest friction I notice is [describe your actual friction
here — e.g., "switching between WYSIWYG and source mode loses my cursor position"
or "I can't quickly navigate to a heading from the TOC without the sidebar open"].

I'm in builder mode. What should the next version focus on?
```

**What it unlocks**: Forces you to name the actual friction instead of chasing "nice to have" features. The six questions will expose whether your next feature serves real editing pain or is a distraction.

**Respond with**: Specific moments. "When I'm writing a 3000-word spec and I want to jump to section 4, I have to..." — not "users want better navigation."

---

## Scenario 2 — Validating a Specific Feature Idea

Use these when you have a feature in mind but want to stress-test whether it's the right scope before writing any code.

### 2a — PDF Export

```
/office-hours

mdpro currently exports to HTML only. I'm considering adding PDF export.
My reasoning: people who use mdpro for long documents (specs, reports, notes)
often need to share them as PDFs — emailing HTML isn't acceptable in most
professional contexts.

The implementation I'm thinking of: use Tauri's webview to print the rendered
HTML to PDF (similar to how browsers print to PDF). This avoids pulling in
pandoc or wkhtmltopdf as dependencies.

Is PDF export the right next export feature, and is webview-print the right approach?
```

**What it unlocks**: "Is HTML export actually insufficient — or is the real problem that your HTML export looks bad when printed?" The question will expose whether this is an export format problem or a styling/presentation problem.

---

### 2b — Command Palette (⌘K)

```
/office-hours

I want to add a command palette (⌘K) to mdpro. Reasoning: as the number of
menu actions grows, keyboard users (like me) waste time hunting through menus.
A command palette would expose all actions as searchable text commands.

I use mdpro for daily writing. The actions I reach for most are: switching view
modes, toggling sidebar, inserting things (images, links, tables), and changing
themes. I have to either remember keyboard shortcuts or use the menu for all of these.

Is a command palette the right solution, and what's the minimal version worth shipping?
```

**What it unlocks**: "Do you need a full command palette or just better keyboard shortcuts for your 5 most-used actions?" Often the premise is right but the scope is 10x too large.

---

### 2c — Multi-Window / Multi-Document

```
/office-hours

mdpro currently opens one document per window. When I'm writing and need to
reference another note, I have to open a second mdpro window from Finder —
there's no built-in way to have two documents side by side or switch between
recently opened files.

I'm considering adding: (1) a recent files list in the File menu, or (2)
tabbed documents within a single window, or (3) a file browser sidebar
showing a directory. I'm not sure which solves the real problem.

Help me figure out which of these (if any) is the right thing to build.
```

**What it unlocks**: The six questions will surface whether this is a "navigation between notes" problem, a "reference while writing" problem, or a "project/vault organization" problem — each of which has a different solution.

---

### 2d — Spell Check / Grammar

```
/office-hours

I want to add spell checking to mdpro. macOS has a built-in spell check API
(NSSpellChecker) that Tauri apps can access. I could enable this without
any external dependencies.

My motivation: I write in both English and Chinese. When I'm drafting quickly,
I make typos I don't catch until I paste into another app. Having inline
red underlines would catch these.

Is this worth building, and is the macOS native approach the right one?
```

**What it unlocks**: "Does mdpro need to own this, or do your users (you) copy-paste into another app for final editing anyway?" Also exposes whether the real friction is typos vs. grammar vs. style — different solutions.

---

### 2e — Version History / Snapshot

```
/office-hours

mdpro has auto-save drafts for crash recovery, but no version history.
If I overwrite a section and save, there's no way to get it back short of
checking git (if the file is tracked).

I'm considering a lightweight snapshot system: save a timestamped copy of the
file to ~/.mdpro/history/<filename>/ every time the user explicitly saves
(Cmd+S). Show the last 10 snapshots in a "History" menu item.

Is version history a real problem for mdpro users, or is this solving for
a fear rather than an observed need?
```

**What it unlocks**: This question has a great premise challenge hidden in it — "when did you last actually need to restore a version, and what did you do instead?" The answer usually reveals whether this is anxiety-driven or real.

---

### 2f — Themes / Custom CSS

```
/office-hours

mdpro has light/dark mode and system theme detection, but no user-customizable
themes. bm.md (one of the reference apps) has 13 typography themes. I'm
considering adding theme support: a set of 5-6 pre-built themes (fonts, line
height, max-width) that users can pick from preferences.

My hesitation: this could be a rabbit hole. Theme support tends to grow
(custom CSS, per-document themes, theme import/export). I want the minimal
version that delivers real value without opening that door.

Help me scope this properly.
```

**What it unlocks**: Forces a "reduce" mode analysis. What's the actual reading/writing experience improvement vs. what's cosmetic preference? Often the answer is "just pick better defaults" rather than building a theme system.

---

## Scenario 3 — Architectural / Technical Decisions

Use these when you're facing a decision that's hard to reverse.

### 3a — Should I Replace Milkdown?

```
/office-hours

mdpro uses Milkdown 7 for WYSIWYG editing. The integration has been painful:
content sync bugs (the Cmd+S data loss fix took a full sprint), limited plugin
documentation, and ProseMirror internals bleeding through.

I'm wondering if I should replace Milkdown with a simpler WYSIWYG approach —
either (1) a contenteditable div with custom rendering, (2) a different editor
like TipTap (also ProseMirror-based, but better documented), or (3) doubling
down on Milkdown and fixing the integration properly.

The WYSIWYG mode is important — it's the Typora-like experience that differentiates
mdpro from plain CodeMirror editors. But I've spent more time fighting Milkdown
than building features.

Is the editor swap worth considering, and if so, what's the decision framework?
```

**What it unlocks**: "What specific behaviors are blocked by Milkdown that another editor would unblock?" Forces you to name concrete limitations vs. general frustration. The answer shapes whether it's a migration, a wrapper, or a configuration problem.

---

### 3b — MCP Server Expansion

```
/office-hours

mdpro has an MCP server that exposes document read/write to AI tools like
Claude. Right now it's a local HTTP server with basic tools: read_document,
write_document, list_open_documents, switch_document.

I'm considering expanding it significantly: add search_documents (full-text
search across open files), create_document, insert_at_cursor, get_selection,
and a structured outline/TOC tool.

My motivation: I want to use Claude to help me write and reorganize documents
while they're open in mdpro — the current tools are too limited for non-trivial
document manipulation.

Is this the right expansion path, and what's the minimal set that unlocks
real AI-assisted editing?
```

**What it unlocks**: "What's the actual editing task you want AI to do that the current tools block?" Forces you to describe the workflow, not the API surface. The answer will likely cut the scope in half.

---

### 3c — Mac App Store Distribution

```
/office-hours

mdpro is currently distributed as a direct DMG download from GitHub releases.
I'm considering submitting it to the Mac App Store.

Benefits I see: discovery, automatic updates, sandboxing credibility.
Costs I anticipate: App Store sandboxing may break file access patterns
(mdpro reads arbitrary .md files from anywhere on disk), review delays,
Apple's 30% cut (though mdpro is free, so that's irrelevant now), and
the entitlements work needed to pass review.

Is Mac App Store worth pursuing for a free, local-only tool, and what should
I validate before investing in the submission process?
```

**What it unlocks**: "Who discovers mdpro today, and what would change if it were on the App Store?" For a free local tool, the answer to "who does this serve" is almost always "discoverability" — which has a premise worth challenging.

---

## Scenario 4 — Product Direction / Positioning

Use these when you're zooming out from features to ask bigger questions.

### 4a — Who Is mdpro Really For?

```
/office-hours

I built mdpro for myself: a fast, local Markdown editor for macOS with a
Typora-like experience. But as I think about what to build next, I realize
I haven't clearly defined who else this is for.

Current users (as best I know): me (technical writer/developer), a few
developer friends who share similar frustrations with Typora alternatives,
and some GitHub stars from people I don't know.

I'm at a fork: (1) optimize for developer/technical users who care about
MCP, IPC control, and keyboard shortcuts, or (2) broaden to general Markdown
users who want a beautiful, simple writing experience. These may require
different design decisions.

Help me get clarity on who this is for before I commit to a roadmap.
```

**What it unlocks**: The hardest question in product development. The six forcing questions will pressure-test "developer friends" as a target — do they have the same problems, or are they being polite?

---

### 4b — Is mdpro Too Similar to Typora?

```
/office-hours

mdpro is explicitly inspired by Typora. The WYSIWYG experience, the native
macOS feel, the local-only philosophy — all of these are Typora-adjacent.

Typora costs $15 (one-time). mdpro is free and open-source. But if someone
asks "why mdpro over Typora?", I currently answer: MCP integration, open-source,
and it's free.

I'm not sure that's a strong enough wedge. Is mdpro differentiated enough to
build a user base, or am I building a free clone of an already-solved problem?
```

**What it unlocks**: A hard premise challenge. "If Typora is $15 and great, who specifically would choose mdpro instead, and what moment makes them switch?" Forces you to name the wedge precisely.

---

## How to Get the Most Out of Each Session

### Before invoking:

1. **Write down the one sentence** that describes the problem or decision. If you can't write it in one sentence, the problem isn't clear enough yet.

2. **Note the status quo**: What do you (or users) do today without this feature? Be specific. "I open TextEdit" is better than "it's inconvenient."

3. **Acknowledge your bias**: If you already have a solution in mind, say so in the prompt. "I'm leaning toward X because Y" gives office-hours something to push back on.

### During the session:

- Answer one question at a time. Don't anticipate the next question.
- When asked "who specifically" — name the scenario, not the demographic. "Me, on a Tuesday, trying to share a spec with my PM" is useful. "Knowledge workers" is not.
- If you find yourself giving a polished answer, push once more: "Actually, the real answer is..."
- The "reduce" scope mode is the most valuable. When office-hours suggests cutting scope, engage with it seriously before defending the original scope.

### After the design doc:

- The explicit "NOT in scope" section is the most important part. Read it before starting implementation.
- If anything in "NOT in scope" feels wrong, that's the next office-hours session.
- Hand the design doc directly to `/plan-ceo-review` for scope challenge, then `/feature-workflow` to implement.

---

## Escape Hatch Prompts

Use these when you have a fully validated plan and just need the design doc:

```
/office-hours

[Paste your pre-validated plan here]

I've already validated this with users. Skip the premise questions and
go directly to writing the design doc.
```

Or when you've already done office-hours and just need to re-scope:

```
/office-hours

I ran this session last week and produced a design doc. We scoped it to X.
Now I'm not sure X is the right boundary — specifically, [describe the doubt].
Can we re-examine just the scope question?
```
