/**
 * @module services/linkSafety
 * Purpose: single home for link/href safety checks used before a URL is
 * opened from an editor surface (issue #10). Extracted from
 * `src/components/Editor/MilkdownEditor.tsx` (WI-1) to keep that file under
 * the 300-line guideline and to repair an inverted dependency — the click
 * guard hook previously imported this helper from a component.
 *
 * Gate A is a **scheme allowlist**, not a denylist (WI-2). The previous
 * implementation compared `href.trim().toLowerCase()` against three literal
 * prefixes, which the WHATWG URL parser defeats: it strips U+0009/U+000A/U+000D
 * from *anywhere* in a URL, so `"java\tscript:alert(1)"` failed the prefix check
 * yet still reached the sink as `javascript:`. A denylist also leaves every
 * unnamed scheme (`file:`, `blob:`, `intent:`, `ms-msdt:`) permitted by default.
 *
 * Key decisions:
 *   - The scheme list is **imported** from `sanitizerPolicy.ts`, never
 *     re-literal-ed here. That module is already pinned against the Rust
 *     `url_schemes(...)` set by `tests/sanitizer-rust-js-parity.test.ts`, so
 *     this gate inherits Rust↔JS parity structurally. A local copy of the list
 *     would be a fourth hand-maintained duplicate and would drift.
 *   - **Strip to decide, open the original.** Normalization is deliberately
 *     more aggressive than the URL parser (it also removes spaces and the rest
 *     of C0), so the normalized string is used *only* to inspect the scheme.
 *     Using it as the navigation target would mangle `./my file.md`.
 *   - No scheme → permitted, with one exception. Relative, fragment and query
 *     references carry no scheme; blocking them would break every in-document
 *     link. **Protocol-relative and backslash-authority forms are the
 *     exception** (WI-6): they carry no scheme either, but they introduce an
 *     attacker-chosen *authority*, and they are rejected here rather than
 *     deferred to a resolved-value gate. Deferring is what produced finding C1 —
 *     under a `tauri://localhost` origin, `//evil.com/x` resolves to
 *     `tauri://evil.com/x`, the app's own scheme wearing a hostile host.
 *   - **Two strings, not one** (WI-3). `isSafeHref` judges the raw attribute —
 *     what the author wrote. The resolved value — what the platform will
 *     actually navigate to — is judged separately, by the two predicates named
 *     below. Neither string is sufficient alone: the parser's strip rule means
 *     the two can differ, and a scheme-less attribute can still resolve into a
 *     hostile scheme via the document base.
 *   - **Two questions, not one** (WI-5). Judging a resolved value against a
 *     single "is this safe" predicate conflated "may the OS opener have this"
 *     with "is this the app's own page". `isExternallyOpenableHref` and
 *     `isSameAppOriginHref` answer them separately, because the correct action
 *     differs: hand off vs. let the webview navigate in place.
 *
 * @coordinates-with src/services/sanitizerPolicy.ts (`ALLOWED_URI_SCHEMES`)
 * @coordinates-with src/hooks/useMilkdownLinkClickGuard.ts (sole caller)
 * @coordinates-with src-tauri/capabilities/default.json (`opener:default` — the
 *   capability that bounds `OPENER_SCHEMES` below; widening that constant past
 *   what the capability grants would block at IPC instead of at this gate)
 */

import { ALLOWED_URI_SCHEMES } from "./sanitizerPolicy";

/**
 * Characters deleted from anywhere in the href before the scheme is inspected:
 * the whole C0 control range plus ASCII space (U+0000-U+0020) and DEL (U+007F).
 *
 * Wider than the parser's own strip set (U+0009/U+000A/U+000D) on purpose — the
 * extra characters are not parser-reachable bypasses, but removing them fails
 * closed and costs nothing.
 *
 * Built via the `RegExp` constructor so the control range stays written as
 * escape sequences; a regex literal would embed raw control bytes in this file.
 */
const SCHEME_INSPECTION_STRIP = new RegExp("[\\u0000-\\u0020\\u007F]", "g");

/**
 * A leading RFC 3986 scheme: one ASCII letter, then letters, digits, `+`, `.`
 * or `-`, up to the first `:`. The leading-letter requirement is what keeps
 * `5:00` a relative reference rather than a scheme named `5`.
 */
const LEADING_SCHEME = /^([a-z][a-z0-9+.-]*):/;

/**
 * A leading authority marker: two characters, each either `/` or `\` — i.e.
 * `//`, `\\`, `/\` or `\/`.
 *
 * All four are refused because for **special** schemes the WHATWG parser treats
 * `\` as `/`, so under an `http` base every one of them opens an authority
 * component and hands the host to whoever wrote the markdown. Under a `tauri`
 * base the backslash forms do not, which makes rejecting only `//` a decision
 * whose safety depends on which origin the app happens to be running under.
 * Rejecting all four fails closed under both bases.
 *
 * Exactly two characters wide, never one: `/abs/path.md` and `/` are ordinary
 * in-document references and must stay permitted.
 */
const AUTHORITY_PREFIX = /^[/\\]{2}/;

/**
 * Returns true when an href is safe to open.
 *
 * Allowlist: an href is permitted only if it carries no scheme at all
 * (relative, `#fragment`, `?query`) or its scheme is a member of
 * `ALLOWED_URI_SCHEMES` — currently http, https, mailto, tel, ftp, imported
 * from `sanitizerPolicy.ts` and kept in sync with the Rust sanitizer. Every
 * other scheme is rejected, including ones nobody has named yet.
 *
 * Scheme-less references that open an **authority** (`//host`, `\\host`, and
 * the mixed `/\` and `\/` forms) are rejected outright — see
 * `AUTHORITY_PREFIX`. The accepted cost is that protocol-relative markdown
 * links no longer open at all, at any origin; authors must write an explicit
 * `https://` scheme.
 *
 * Before the scheme is read, every character in U+0000-U+0020 and U+007F is
 * deleted from any position and the result is lowercased. That normalized
 * string is used **only** for this decision; callers must open the original
 * href, never the stripped form.
 *
 * The authority test reads `normalized`, **never the raw `href`**: a leading
 * NUL, space, TAB or CRLF hides the leading `//` from a raw `startsWith`
 * check. Because `SCHEME_INSPECTION_STRIP` removes a strict superset of the
 * parser's own removal set, any sequence the parser would collapse into a
 * leading `//` is already collapsed here.
 */
export function isSafeHref(href: string): boolean {
  if (!href) return false;
  const normalized = href.replace(SCHEME_INSPECTION_STRIP, "").toLowerCase();
  if (!normalized) return false;
  if (AUTHORITY_PREFIX.test(normalized)) return false;
  const scheme = LEADING_SCHEME.exec(normalized)?.[1];
  if (scheme === undefined) return true;
  return ALLOWED_URI_SCHEMES.includes(scheme);
}

/**
 * Schemes the OS opener may be handed.
 *
 * Deliberately a **module-local literal**, not `ALLOWED_URI_SCHEMES` imported
 * from `sanitizerPolicy.ts`. The two lists overlap but are different contracts:
 * the sanitizer decides what is safe to *render*, this decides what is safe to
 * hand to *another application*. Collapsing them would silently widen one
 * whenever the other changed.
 *
 * `ftp` is in the sanitizer list and absent here because `tauri-plugin-opener`
 * 2.5.3 grants only mailto/tel/http/https in
 * `permissions/allow-default-urls.toml` — an `ftp:` handoff is outside the
 * capability the app actually holds.
 */
const OPENER_SCHEMES = ["http", "https", "mailto", "tel"];

/**
 * May this resolved URL be handed to the OS opener?
 *
 * Set membership by equality over the scheme — never a prefix test, which would
 * admit `ftps:` under `ftp`, `httpx:` under `http`, and `mailtoevil:` under
 * `mailto`.
 *
 * Notably false for the app's own `tauri:` scheme. A link to the app's own
 * origin is an in-document navigation, not an external handoff; treating it as
 * one is what let an attacker-chosen host reach the opener (finding C1).
 *
 * Fails closed: no parseable leading scheme means false.
 */
export function isExternallyOpenableHref(resolved: string): boolean {
  if (!resolved) return false;
  const scheme = LEADING_SCHEME.exec(resolved.toLowerCase())?.[1];
  if (scheme === undefined) return false;
  return OPENER_SCHEMES.includes(scheme);
}

/**
 * Is this resolved URL the app's own origin — i.e. an in-document navigation?
 *
 * `documentUrl` is a parameter rather than a direct `window.location` read so
 * the production origin is an argument the tests can supply instead of a global
 * only reachable by stubbing (ADR-0001).
 *
 * **`.origin` must never be used here.** `tauri` is a non-special scheme, so
 * WHATWG gives it an *opaque* origin that serializes to the literal string
 * `"null"`. That makes
 * `new URL("tauri://evil.com/x").origin === new URL("tauri://localhost/").origin`
 * evaluate to **true**, which is precisely the C1 bypass: an attacker-chosen
 * host would be accepted as the app's own page. The fields are therefore
 * compared individually.
 *
 * The comparison covers scheme, host and port only — deliberately **not** the
 * path, query or fragment. In production the document URL is whatever page the
 * webview currently sits on, so any prefix- or path-shaped comparison would
 * return false for every ordinary relative link the moment the app navigates
 * off `/`.
 *
 * Fails closed: either side failing to parse returns false rather than throwing.
 */
export function isSameAppOriginHref(resolved: string, documentUrl: string): boolean {
  let target: URL;
  let base: URL;
  try {
    target = new URL(resolved);
    base = new URL(documentUrl);
  } catch {
    return false;
  }

  if (target.protocol !== base.protocol) return false;
  if (target.hostname !== base.hostname) return false;
  if (target.port !== base.port) return false;

  // Both credential fields, not just `username`: an authority may carry a
  // password with an empty username (`scheme://:pass@host/`), so checking one
  // field alone leaves the other as an unspecified accident. The app's own
  // origin never carries credentials, so any presence of them means this is
  // not it.
  return target.username === "" && target.password === "";
}
