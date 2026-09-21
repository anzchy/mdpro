# 0021. MCP document offsets are UTF-16 code units

## Status

Accepted — 2026-09-22

## Context

The MCP HTTP API exchanges positions into document text in three places: the
`cursor` field of a document read, the `position` of an insert, and the
`newCursor` returned from that insert. Three defects found on 2026-09-22 —
registered together as **D10** — all turned out to be the same underlying
problem: **the unit of those positions was never actually decided.**

`specs/007-mcp-server/data-model.md:27` says `cursor` is a "character offset
from start". Seventeen lines later, `:44` states the validity rule as
`cursor: Must be ≤ content.len()` — and `content.len()` on a Rust `String` is
a count of **bytes**. A single page of spec names two different units for the
same field, and neither of them says which of the two things "character"
could mean — a Unicode scalar value, or a UTF-16 code unit.

What the two implementations settled on, independently:

| Side | Unit | Where it comes from |
|---|---|---|
| Rust (`http_server.rs`) | Unicode scalar | `char_offset_to_byte` uses `char_indices().nth(n)` |
| Frontend (`useMcpEvents.ts`) | UTF-16 code unit | `content.slice(0, offset)` is JS string indexing; `selection.main.head` is a CodeMirror position |

For every character in the Basic Multilingual Plane — all of ASCII, all of
Latin-1, all CJK — those two agree exactly, which is why this survived. They
diverge only on astral-plane characters: an emoji is one scalar and **two**
UTF-16 code units. Every existing test of `char_offset_to_byte` uses BMP text
(`"hello"`, `"你好世界"`, `"café"`), so none of them can tell the two apart.

The divergence is not merely a wrong number reported back. `insert_content`
optimistically writes the new content into the shadow store using the Rust
offset, then emits an event the frontend applies using the JS offset. Past one
emoji, **the two copies of the document receive the same text at different
positions.** The frontend's later sync overwrites the shadow store, so the
damage is a transient wrong read plus a permanently wrong `newCursor` — but
the text genuinely lands in two different places in the interim.

### The forces

- **The frontend's unit is not a free choice.** CodeMirror positions are
  offsets into a JS string, and JS strings are UTF-16. Moving the frontend to
  scalars means converting at every boundary — every `slice`, every
  `selection`, every transaction `from`/`to` — and re-converting on the way
  back. The conversions are O(n) scans, on the hot path of the editor.
- **The Rust side's unit is a free choice.** It already converts to byte
  offsets before touching the string. Converting from a different input unit
  is the same shape of code and the same cost.
- **Neither unit is defensible on elegance.** Unicode scalars are the unit a
  protocol designed today would pick. UTF-16 is a historical artifact that
  leaks a 1990s encoding decision into a 2026 JSON API.

## Decision

**All document positions crossing the MCP boundary are UTF-16 code-unit
offsets**, and the Rust side is the side that changes.

1. `char_offset_to_byte` is replaced by `utf16_offset_to_byte`, and an inverse
   `byte_offset_to_utf16` is added. The inverse did not previously exist,
   which is why `new_cursor` was computed by adding two byte counts and
   publishing the result as a character offset.
2. `newCursor` is converted back into UTF-16 code units before it is returned.
   It is no longer `insert_offset + text.len()`, which was bytes + bytes.
3. An offset that lands **between the two halves of a surrogate pair** is
   snapped down to the start of that character, exactly as the existing
   `snap_to_char_boundary` already does for mid-UTF-8-sequence byte offsets.
   A position inside a character is not a position.
4. `InsertPosition::Cursor` on a document that is **not** the active one
   resolves to **end of document**, not to the stored cursor. This is not a
   new policy — `useMcpEvents.ts` already does exactly this, with the comment
   "to avoid cross-document corruption". The Rust side simply did not agree
   with it. The frontend now reports a cursor that makes both sides compute
   the same answer.
5. The spec's contradiction is corrected: `data-model.md` states the unit
   explicitly and states the bound in the same unit.

## Consequences

**What this gives up.**

- UTF-16 is the worse unit in the abstract, and this bakes it into a public
  API. An MCP client written in Python, Go, or Rust has to count UTF-16 code
  units in text it holds as scalars or bytes — work its own language does not
  make natural. We are exporting our editor's internal representation to
  every client, and saying so plainly is better than the current situation of
  exporting it by accident.
- Choosing scalars instead would have put that same burden on the editor, on
  the hot path, in exchange for a cleaner contract. That trade was available
  and was refused: correctness inside the editor is load-bearing in a way the
  ergonomics of a third-party client is not.
- Surrogate-pair snapping means a client can name an offset and get an insert
  somewhere else. It is silent. The alternative — rejecting the request — is
  arguably better API design, but it would turn a class of previously
  "working" client calls into hard errors, and no client is known to depend
  on either behaviour yet. Left as snapping for consistency with the existing
  UTF-8 boundary handling; revisit if a client ever reports surprise.

**What it does not fix.**

- **`newCursor` remains a prediction, not an observation.** The HTTP response
  is returned before the frontend has applied the event — that is inherent to
  the optimistic emit design, not a defect introduced here. If the user is
  typing at the same moment, the real cursor ends up elsewhere. The value is
  now computed in the right unit from the right base; it is still a forecast.
- **The stored cursor can be stale.** `useMcpSync` re-syncs on document count,
  active-document change, and content change — **not** on cursor movement. A
  user who moves the caret without typing leaves the shadow store holding the
  old position. Fixing that means syncing on every caret move, which is a
  per-keystroke IPC call; that cost was judged not worth paying for a
  best-effort field. This is a real residual limit and is recorded on the
  ledger row rather than being quietly absorbed.
- **BMP-only clients see no change whatsoever.** This fix is invisible unless
  astral characters are present, which also means it is largely unverifiable
  by casual manual testing. The regression tests carry the burden.

**What it forecloses.**

- Moving to scalar offsets later is now a breaking API change with a
  deprecation story, rather than the tidying-up of an unspecified field.
