# 0001. WYSIWYG link opening: scheme allowlist, two gates, no browser fallback

## Status

Superseded by ADR-0002 — 2026-09-13

## Context

`src/hooks/useMilkdownLinkClickGuard.ts` is the only code path in `src/` that
hands a URL to the OS opener. Its safety check, `isSafeHref`, was a **denylist**
over `href.trim().toLowerCase()` rejecting the `javascript:`, `data:` and
`vbscript:` prefixes. A security audit (row 2, High) found two independent
defects, both reproduced empirically:

1. **Normalization gap.** Per the WHATWG URL Standard the parser deletes ASCII
   tab (U+0009), LF (U+000A) and CR (U+000D) from *anywhere* in the input. So
   `java<TAB>script:alert(1)` fails the prefix check — and is therefore
   permitted — while `link.href` resolves to `javascript:alert(1)`. Five of
   eight probe vectors bypassed the guard this way.
2. **Check one string, open another.** The guard validated
   `getAttribute("href")` but passed `link.href` to the sink. Worse, `link.href`
   was read *inside* the `.then()`/`.catch()` — after an `await` — during which
   a ProseMirror re-render or an `mcp:write_document` event can mutate the
   anchor. That is a live TOCTOU.

A denylist is also the wrong shape independent of the bypass: every unnamed
scheme (`file:`, `blob:`, `about:`, `intent:`, `ms-msdt:`) is permitted by
default.

A TypeScript mirror of the Rust sanitizer's scheme list already existed —
`ALLOWED_URI_SCHEMES` in `src/services/sanitizerPolicy.ts`, pinned to
`src-tauri/src/services/markdown.rs`'s `url_schemes(...)` by
`tests/sanitizer-rust-js-parity.test.ts`.

## Decision

1. **Denylist becomes an allowlist.** Delete every character in U+0000–U+0020
   and U+007F from any position, lowercase, then extract a leading scheme with
   `/^([a-z][a-z0-9+.-]*):/`. Permit when there is no scheme, or when the scheme
   is in `ALLOWED_URI_SCHEMES`. Reject everything else.
2. **Strip to decide, open the original.** The normalization is deliberately
   more aggressive than the URL parser, so the normalized string is used *only*
   to inspect the scheme. Opening it would mangle `./my file.md`.
3. **Import the list; never restate it.** Parity with the Rust renderer is then
   inherited structurally rather than maintained by hand in a fourth place.
4. **Scheme-less and protocol-relative (`//host/path`) hrefs are permitted at
   this gate.** They carry no scheme; what they *become* is adjudicated below.
5. **Two gates.** Gate A judges the raw attribute — what the author wrote.
   Gate B judges the resolved value — what the platform will actually navigate
   to — and permits it when its scheme is allowlisted **or** equals the
   document's own protocol. Validating only the resolved value was considered
   and **rejected**: in a production Tauri build the origin is
   `tauri://localhost`, so every relative link resolves to scheme `tauri`, which
   is not allowlisted. That variant would break in-document links in production
   while passing in jsdom and Vite dev, where the origin is `http`. The document
   protocol is a *parameter*, not a `window.location` read, so the production
   origin is an argument tests can supply; it is compared as a whole `"scheme:"`
   string, never as a prefix, so `tauri-evil:` cannot ride in behind `tauri:`.
6. **Capture before await.** Everything the handler needs is read synchronously;
   `link` is never dereferenced once the dynamic import begins; the string handed
   to `openUrl` is the same string that cleared Gate B.
7. **Remove the `window.open` fallback.** It was the last path able to hand a
   URL to the webview outside the validated capture.

## Consequences

**What this gives up:**

- **Links that used to work stop working.** `file:///…`, Windows drive paths
  (`c:/Users/…` parses as scheme `c`), `sms:`, `callto:`, `obsidian:` and every
  other unlisted scheme are now refused. This is a deliberate narrowing that
  matches the Rust sanitizer's posture. The remedy for a legitimate complaint is
  to add the scheme to the *shared* allowlist in **both** `sanitizerPolicy.ts`
  and `markdown.rs` — never to special-case the guard.
- **Whitespace-only hrefs change behavior.** `"   "` and `"\t\n"` now return
  `false`; they returned `true` before, because the old empty-check caught only
  `""`. This is a narrowing, not a no-op.
- **A failed open is now invisible.** With `window.open` gone, a link the OS
  opener rejects does nothing the user can see; the only evidence is one
  `editor.milkdown.link.open` entry in `~/.mdpro/mdpro.log`. A toast was
  considered and deferred as UI work that does not belong in a security fix.
  Rule 30 §5 asks for one signal per surface, and "no visible signal" is the
  accepted answer for now. **This is the weakest part of this decision.**
- **The guard now carries a production-only origin dependency.** Gate B's
  same-protocol branch behaves differently under `tauri://localhost` than under
  the test origin. A dedicated test file obtains a genuine `tauri:` origin via a
  `@vitest-environment-options` docblock, but a real-build smoke check of one
  relative link and one `https://` link is still warranted before release.
- **Nothing structurally prevents a second sink.** Anyone adding another
  link-opening surface must route it through both gates; that obligation lives
  in review, not in the type system.

**Knowingly not fixed:** audit row 13 (Medium) — clicking `#section` still
cancels in-document navigation and sends the application-origin URL to the
external opener. This decision *preserves* that defect on purpose: the
acceptance criteria were written so the fix would not begin blocking fragment
links, which would trade one bug for another. Row 13 stays `open`.

**What it buys:** unnamed schemes fail closed rather than open; the string that
is opened is by construction the string that was validated; and scheme policy
has a single home shared with the Rust renderer.
