# 0003. Export sanitization: disable `SANITIZE_DOM`, and narrow the sanitizer to the export fragment

## Status

Accepted — 2026-09-15

**Partially superseded — 2026-09-18.** Decision point 3 (`ALLOWED_ATTR`) is
superseded by
[ADR-0011](./0011-remove-name-from-export-sanitizer-allowlist.md), which removes
`name` from the allowlist. Points 1, 2 and 4 and both load-bearing preconditions
stand unchanged. Do not act on point 3 from this record; read ADR-0011 first.
This Status block is the only part of this ADR that has been edited — the body
below is the 2026-09-15 record as written.

Implemented by WI-3.2. This record carries no code change; see **Consequences**.

## Context

Exporting a document that contains `# Title` produces HTML in which that heading
has **no reachable anchor**. This is a live defect, not a latent risk, and it was
measured on the only export path the app has.

- `markdown.rs` renders `id="title"` correctly.
- `exportService.ts:89` runs DOMPurify on the **Rust success path** as well, not
  only on the `marked` fallback.
- DOMPurify enables `SANITIZE_DOM` by default, which drops any `id` colliding
  with a built-in `document` / `form` property name — `title`, `name`, `body`,
  `location`, `forms` — leaving `<h1 data-heading-id="title">` with no `id`.
- The ammonia pass at `export.rs:158` receives a body whose anchor is already
  gone. It cannot restore what was removed upstream.
- `App.tsx:587` is the **only** export entry, via `exportRenderedHtml` →
  `renderMarkdown`.

ammonia does not perform this stripping, so this is a **divergence between the TS
and Rust sanitizers**, not a security posture the two share. `sanitizerPolicy.ts`
sets neither `SANITIZE_DOM: false` nor `SANITIZE_NAMED_PROPS`, and its file header
documents Rust parity at length while never mentioning clobbering — so the
behavior was **unrecorded**, not a weighed choice. That is the gap this record
closes.

Seven options were evaluated against a cross-implementation survey
(github-slugger, rehype-slug, GitHub, vmark, MiaoYan) and one Codex review
(`codex exec -s read-only`, high reasoning); points of disagreement were measured
rather than argued. The full option table stays in plan M
§ 导出锚点被 DOMPurify 剥离.

The decisive measurements against the two nearest alternatives:

- **A (`SANITIZE_NAMED_PROPS: true`) — rejected.** That branch carries no
  collision check: it prefixes **every** `id`/`name` with `user-content-`
  unconditionally and **never rewrites `href`**. The export artifact carries zero
  JS, so it cannot host GitHub's `hashchange` shim that re-points bare fragments.
  Footnote backlinks (`href="#fn1"`) and hand-written `[x](#slug)` would all aim
  at targets that no longer exist — upgrading "a few colliding anchors break"
  into "in-document navigation is entirely dead".
- **E2 (restore `id` from `data-heading-id` after sanitizing) — second choice.**
  `data-heading-id` is inside `ALLOWED_ATTR`, so for **raw HTML headings** it is
  attacker-controlled; using it to undo a DOMPurify decision routes trust through
  an untrusted side channel. It also fixes only headings, not other fragment
  targets.

## Decision

1. **Set `SANITIZE_DOM: false`** in the export sanitizer configuration.
2. **Rename `sanitizeRenderedHtml` → `sanitizeExportFragment`**, and state in its
   signature docs, its module header and its tests that the output is **for export
   only and must never enter the app's live DOM**.
3. **Keep every other DOMPurify restriction** — `ALLOWED_TAGS`, `ALLOWED_ATTR`,
   `ALLOWED_URI_REGEXP`, `FORBID_TAGS`. The ammonia pass at `export.rs:158`
   remains the authoritative boundary.
4. Rejected: A, A′, D, E1. Held as second choice: E2, then C.

Point 2 is not cosmetic, and it is the whole of what distinguishes this decision
from simply flipping the flag. The residual risk is not today's behavior — it is a
future caller reusing a function named `sanitizeRenderedHtml` as a general-purpose
sanitizer and feeding its output into the live document, where clobbering *does*
apply. The rename is the control; the flag is merely the fix.

## Consequences

**What this gives up.** The export fragment no longer has DOM clobbering
protection. That is acceptable only because the fragment never enters a live
document and the export artifact contains zero JS (`html_template.rs` emits no
`<script>`); clobbering requires an element to be **in a document tree** before it
becomes a named property, and `mathRender.ts:134`'s detached div is not.

**Two preconditions are now load-bearing. If either stops holding, this record
must be re-evaluated rather than quietly relied upon.**

1. **Detached ≠ side-effect-free.** Detached subtrees and `DOMParser` documents
   still initiate `<img>` / `<iframe>` resource loads. What prevents those is the
   URL and tag allowlist — *not* `SANITIZE_DOM`. The earlier description of the
   two `DOMParser` post-processors as "inert" was too strong and is withdrawn.
2. **A detached `<form>` can clobber named properties via form ownership,
   without ever entering a tree.** `sanitizerPolicy.ts:70` deliberately excludes
   `form` from the allowlist, so this is unreachable today — but that exclusion is
   a **precondition of this decision, not an incidental detail. If `<form>` is
   ever added to `ALLOWED_TAGS`, this ADR must be revisited before the change
   lands.**

**Migration cost.** The rename touches five test files that import the symbol by
name or reference it in prose: `math-render.test.ts`, `render-golden.test.ts`,
`sanitizer-policy.test.ts`, `sanitizer-malicious-fixtures.test.ts`, and a header
comment in `sanitizer-rust-js-parity.test.ts`. `exportService.ts` binds it once
(`:38`) and uses it on both the Rust path (`:89`) and the `marked` fallback
(`:105`).

**What this does not fix.** Slug de-duplication is a **separate** defect
(`# x` / `# x` / `# x-1` → `x`, `x-1`, `x-1`). No option in the table addressed
it; its fix is specified independently in plan M and also lands in WI-3.2.

**What this forecloses.** Option C — routing export through the Rust-only
`export_html` — is now off the table. It was never a drop-in substitute (it
discards the JS post-processing chain: syntax highlighting, image width markers,
KaTeX pre-rendering), and it interlocked with the knip proposal § 5.6. That
proposal's refusal to delete `export_html` stands on its own separate grounds and
is unaffected by this record.

**Pinned defect.** `tests/render-fixtures/heading-identity.json` continues to pin
the stripping as a current-behavior defect. It stays pinned and red-by-record
until WI-3.2 lands; the fixture's own note is corrected only where it called the
behavior "not a deliberate choice", which this ADR makes false.
