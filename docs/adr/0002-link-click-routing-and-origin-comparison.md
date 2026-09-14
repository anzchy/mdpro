# 0002. Link clicks: reject the authority form at gate A, route by two questions, compare origins field-wise

## Status

Accepted — 2026-09-13

Supersedes [ADR-0001](./0001-wysiwyg-link-scheme-allowlist.md).

## Context

ADR-0001 turned the WYSIWYG link guard's denylist into a scheme allowlist and
split the check into two gates: gate A judged the raw `href` attribute, gate B
judged the resolved value and permitted it when its scheme was allowlisted **or
equalled the document's own protocol**.

A follow-up security review (finding C1, Critical) found that gate B's
same-protocol branch was itself a bypass, and that it was reachable precisely
because of a decision ADR-0001 made deliberately.

In a production Tauri build the document origin is `tauri://localhost`. A
markdown link written `//evil.com/x` carries no scheme, so gate A permitted it —
ADR-0001 decision 4 said scheme-less and protocol-relative hrefs are permitted at
that gate and "what they *become* is adjudicated below". The WHATWG parser
resolves `//evil.com/x` against the `tauri://localhost/` base to
`tauri://evil.com/x`: scheme `tauri`, hostname `evil.com`. Gate B compared the
*protocol only*, saw `tauri:` equal to `tauri:`, and handed the OS opener a URL
whose host the markdown author chose. ADR-0001 anticipated scheme smuggling
(`tauri-evil:` cannot ride in behind `tauri:`, because the comparison is a whole
`"scheme:"` string) but not host smuggling underneath a correct scheme.

Two things in ADR-0001 were structurally wrong rather than merely incomplete:

1. **The authority form was adjudicated at the wrong gate.** Deferring it to a
   resolved-value check is what created the hole; by then the hostile host is
   already fused to a trusted scheme.
2. **"Is this safe to open" was one question when it is two.** Gate B conflated
   "may the OS opener be handed this" with "is this the app's own page". Those
   have different correct actions — hand off versus navigate in place — so one
   boolean could not serve both without one of them being wrong.

Parser behavior was measured, not assumed (jsdom 26.1.0 / Node v22.22.3,
2026-09-13). Under a `tauri://localhost/` base, `//evil.com/x` resolves to
`tauri://evil.com/x`, while the `\\`, `/\` and `\/` forms stay *paths* with the
host still `localhost`. Under `http://localhost:3000/` all four resolve to
`http://evil.com/x`, because for special schemes the parser treats `\` as `/`.

## Decision

1. **Gate A rejects the authority form outright.** Any href whose normalized form
   begins with two characters each of which is `/` or `\` is refused. This
   reverses ADR-0001 decision 4 for the protocol-relative case; scheme-less
   relative, `#fragment` and `?query` references stay permitted. All four forms
   are rejected, not just `//`: under a `tauri` base only `//` introduces an
   authority, but under an `http` base all four do, and making a security
   decision that depends on which origin the app happens to be running under is
   the pattern this fix exists to remove.
2. **Gate B is replaced by two independent predicates.**
   `isExternallyOpenableHref(resolved)` answers "may the OS opener have this";
   `isSameAppOriginHref(resolved, documentUrl)` answers "is this the app's own
   page". The application's own scheme is deliberately **not** externally
   openable, which is what closes C1 at the routing level as well as at gate A.
3. **The opener's scheme list is a module-local literal in
   `src/services/linkSafety.ts`, not the imported sanitizer list.** The two
   overlap but are different contracts: the sanitizer decides what is safe to
   *render*, the opener list decides what is safe to hand to *another
   application*. `ftp` is in the former and absent from the latter, because
   `src-tauri/capabilities/default.json` grants `opener:default`, which in
   `tauri-plugin-opener` **2.5.3** expands via `permissions/default.toml` to
   include `allow-default-urls`, whose scope allows exactly `mailto:*`, `tel:*`,
   `http://*` and `https://*`. The exclusion lives in `linkSafety.ts` and **not**
   in `sanitizerPolicy.ts`: that module is pinned to the Rust
   `url_schemes(...)` set by `tests/sanitizer-rust-js-parity.test.ts`, so
   narrowing it to express an opener policy would break the pin and change
   export rendering for an unrelated reason.
4. **Same-origin is decided by comparing `protocol`, `hostname` and `port`
   individually**, and by requiring both `username` and `password` to be empty.
   Path, query and fragment are deliberately excluded: in production the document
   URL is whatever page the webview currently sits on, so any path-shaped
   comparison would return false for every ordinary relative link the moment the
   app navigates off `/`.
5. **`preventDefault()` is called on every outcome**, and `stopPropagation()`
   only on the blocked ones — see consequence (d).
6. **Three outcomes, all decided synchronously before any `await`**, preserving
   ADR-0001 decision 6: the string handed to `openUrl` is by construction the
   string that cleared `isExternallyOpenableHref`.

### Rejected alternative: compare `URL.origin` strings

The obvious one-line spelling of decision 4 is
`new URL(resolved).origin === new URL(documentUrl).origin`. It is wrong, and it
fails in the worst possible direction.

`tauri` is a **non-special** scheme, so the WHATWG URL Standard gives it an
**opaque** origin, and an opaque origin serializes to the literal string
`"null"`. Both `new URL("tauri://evil.com/x").origin` and
`new URL("tauri://localhost/").origin` are therefore the string `"null"`, and
the comparison evaluates `"null" === "null"` → `true`. The fix that looks
obvious **preserves the exact bypass being fixed** — and hides it, because in
jsdom and in the Vite dev origin the scheme is `http`, which is special, so
`.origin` behaves as expected and the test suite stays green.

This is recorded here because it is the single thing most likely to be
re-proposed by someone who was not in the room, as a "simplification" of the
field-wise comparison.

## Consequences

**What this gives up:**

- **(a) Protocol-relative markdown links no longer open, at any origin.**
  `//example.com/x` is now refused even under a `http` origin where it would
  have resolved harmlessly. Authors must write an explicit `https://`. This is a
  real narrowing accepted in exchange for removing an origin-dependent security
  decision. A related over-rejection falls out of the same code: because the
  normalization strips U+0000–U+0020 from *any* position, `/ /evil.com`
  normalizes to `//evil.com` and is rejected although it would have resolved as
  a path. Fail-closed and accepted.
- **(b) In-document and fragment links are inert.** A click on `#section` or
  `./other.md` is now recognized as in-document, cancelled, and logged at
  `debug` — and then nothing happens, because in-document navigation is not
  implemented. Users may reasonably read this as a regression. It is traded
  knowingly: ADR-0001 left audit row 13 (Medium) open on purpose, sending the
  application-origin URL to the external opener; this decision closes row 13 by
  refusing to treat the app's own origin as an external handoff, and the missing
  navigation is the cost. Building it is follow-up work, not part of a security
  fix.
- **(c) The sanitizer allows `ftp` while the opener refuses it** — a deliberate
  two-list divergence, sourced to the capability chain in decision 3. This is
  not a behavior regression: an `ftp://` link was never openable, because it
  would have died at IPC authorization inside `tauri-plugin-opener` leaving one
  silent log line. It now blocks visibly at our own gate with a
  `reason: "resolved-mismatch"` record. The cost is a second scheme list to keep
  honest; the mitigation is that each list names its own source.
- **(d) ADR-0001's "exactly one sink" claim is scoped to the editor surface.**
  `tauri-plugin-opener` injects its own window-level click handler
  (`src/init-iife.js` in the crate), which opens `http:`/`https:`/`mailto:`/`tel:`
  links it finds on the click path. It is **not** a live bypass: that handler's
  first statement is `if (e.defaultPrevented || ...) return;`, our container
  listener runs first, and decision 5 has it call `preventDefault()` on every
  outcome including the blocked ones. This is a **NOTE**, and it is also why
  `preventDefault()` must not be narrowed to the open branch later — doing so
  would silently promote that handler into a second sink.
- **(e) Production WKWebView verification is still outstanding.** jsdom is the
  oracle for every parser premise above, and WKWebView may differ. One relative,
  one fragment, one `https://` and one `//evil.com/x` link must be clicked in a
  real build. This is the main residual risk in this fix.
- **No third `BlockReason`.** Protocol-relative rejections log as
  `reason: "scheme"`, which is slightly imprecise for triage. A dedicated reason
  would require `isSafeHref` to return a reason rather than a boolean, changing a
  predicate the property tests depend on. Deferred deliberately.
- **ADR-0001's accepted costs are inherited**, not revisited: unlisted schemes
  stay refused, whitespace-only hrefs stay `false`, a failed open is still
  invisible apart from one log entry, and nothing structural prevents a future
  second sink from being added outside these predicates.

**What it buys:** an attacker-chosen host can no longer ride into the OS opener
behind the application's own scheme; the authority form is refused at the gate
that sees what the author wrote, rather than at a gate that sees it already fused
to a trusted scheme; "may the opener have this" and "is this our own page" are
answered separately, so neither answer has to be wrong to make the other right;
and the same-origin test no longer depends on a `.origin` serialization that
silently collapses to `"null"` for exactly the scheme this application ships
under.
