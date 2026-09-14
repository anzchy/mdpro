/**
 * WI-3 — `useMilkdownLinkClickGuard` must validate the exact value it opens.
 *
 * Law under test: the string handed to the opener is byte-for-byte the string
 * that cleared both gates. The pre-WI-3 hook violated this three ways — it
 * validated `getAttribute("href")` while opening `link.href` (across
 * normalization), it re-read `link.href` inside `.then()` after an `await`
 * (across time), and it fell back to `window.open` with an unvalidated re-read.
 *
 * Cases: W3-01, W3-02, W3-03, W3-06, W3-07, W3-08, W3-09, W3-10,
 * W3-11, W3-12, and (WI-7) W3-16, W3-18, W3-20. The cases that need a
 * production origin — W3-05, W3-13, W3-14, W3-15, W3-17, W3-19, W3-21 — live
 * in `milkdown-link-click-guard.prod-origin.test.ts`, because that origin is
 * set by a file-level docblock and would move every case in this file.
 *
 * WI-5 adds the opener-scope predicates: W4-01, W4-02, W4-06 (opener scope) and
 * W4-03, W4-04, W4-05, W4-07, W4-08, W4-09 (app-origin identity). They replace
 * the old `isSafeResolvedHref — Gate B predicate` describe (case W3-04), whose
 * table is retargeted onto them.
 *
 * Mock boundary: `@tauri-apps/plugin-opener` (native OS handoff) and
 * `loggingService` (JSONL over Tauri IPC) only. `isSafeHref`,
 * `isExternallyOpenableHref` and `isSameAppOriginHref` are the logic under test
 * and are never mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMilkdownLinkClickGuard } from "../src/hooks/useMilkdownLinkClickGuard";
import { loggingService } from "../src/services/loggingService";
import { ALLOWED_URI_SCHEMES } from "../src/services/sanitizerPolicy";
import type { LogEntryPayload } from "../src/types/logging";

/**
 * mulberry32 — deterministic, so any property failure is reproducible from SEED.
 * Copied from `tests/wysiwyg-security.test.ts:387-398` rather than imported:
 * `fast-check` is NOT a dependency of this repo and adding one is out of scope
 * for a security fix (gate G0).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shared across W4-06, W4-07 and W4-09 so a failure is attributable to this plan. */
const SEED = 0x5eed0c1e;

/**
 * The opener scope, restated here independently of the implementation. The real
 * `OPENER_SCHEMES` is module-local to `linkSafety.ts` and deliberately NOT
 * exported; a test that imported it would assert the implementation against
 * itself.
 */
const EXPECTED_OPENER_SCHEMES = ["http", "https", "mailto", "tel"];

const { openUrlMock } = vi.hoisted(() => ({ openUrlMock: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: { logEventSync: vi.fn(), generateActionId: () => "test-action-id" },
}));

let openSpy: MockInstance<typeof window.open>;

/** Every payload passed to the mocked logger, in call order. */
const logPayloads = (): LogEntryPayload[] =>
  vi.mocked(loggingService.logEventSync).mock.calls.map(([payload]) => payload);

const blockedLogs = (): LogEntryPayload[] =>
  logPayloads().filter((p) => p.event === "editor.milkdown.link.blocked");

const inDocumentLogs = (): LogEntryPayload[] =>
  logPayloads().filter((p) => p.event === "editor.milkdown.link.in_document");

const openFailureLogs = (): LogEntryPayload[] =>
  logPayloads().filter((p) => p.event === "editor.milkdown.link.open");

/** Builds `#milkdown-container` with one anchor per href and returns the anchors. */
function mountContainer(hrefs: string[]): HTMLAnchorElement[] {
  const container = document.createElement("div");
  container.id = "milkdown-container";
  const anchors = hrefs.map((href) => {
    const a = document.createElement("a");
    a.setAttribute("href", href);
    a.textContent = "link";
    container.appendChild(a);
    return a;
  });
  document.body.appendChild(container);
  return anchors;
}

/**
 * Dispatches a real cancelable bubbling click. `cancelable: true` is mandatory:
 * without it `preventDefault()` is a no-op and `defaultPrevented` could never be
 * true, so the blocked-click cases would fail for a reason unrelated to the code
 * under test.
 */
function clickOn(link: HTMLAnchorElement): MouseEvent {
  const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(evt);
  return evt;
}

/**
 * `mountContainer` always calls `setAttribute("href", …)`, so it cannot express
 * the two shapes WI-10 is about: an anchor with **no** href attribute, and a
 * non-anchor node. These build the container bare instead. (WI-10)
 */
function mountRawContainer(): HTMLElement {
  const container = document.createElement("div");
  container.id = "milkdown-container";
  document.body.appendChild(container);
  return container;
}

/** As `clickOn`, but for any node — the click target is not always an anchor. */
function clickOnNode(node: Element): MouseEvent {
  const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
  node.dispatchEvent(evt);
  return evt;
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.querySelectorAll("base").forEach((b) => b.remove());
  openUrlMock.mockResolvedValue(undefined);
  openSpy = vi.spyOn(window, "open").mockReturnValue(null);
});

describe("useMilkdownLinkClickGuard — Gate A (raw attribute)", () => {
  // W3-01 — end-to-end regression for audit row 2.
  it("blocks an interior-TAB javascript: href and never reaches the opener", async () => {
    const long = "javascript:alert(1)" + "A".repeat(500);
    const [link, longLink] = mountContainer(["java\tscript:alert(1)", long]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    // Precondition: the exploit is real in this environment — jsdom's parser
    // strips the interior tab, so on unfixed code this reaches the sink as
    // `javascript:`. If jsdom changes, this names the dead premise instead of
    // letting the case decay into a tautology.
    expect(link.href).toBe("javascript:alert(1)");

    const evt = clickOn(link);

    expect(evt.defaultPrevented).toBe(true);
    expect(blockedLogs()).toHaveLength(1);
    expect(blockedLogs()[0]).toMatchObject({
      level: "warn",
      status: "fail",
      context: { reason: "scheme", href: "java\tscript:alert(1)" },
    });
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();

    // The 100-char truncation boundary: exactly 100, never "at most 100".
    clickOn(longLink);
    expect(blockedLogs()).toHaveLength(2);
    expect(String(blockedLogs()[1].context?.href)).toHaveLength(100);
  });

  // W3-16 — backslash authority form under a SPECIAL base. Together with W3-15
  // (prod-origin file, non-special base) this is the documented proof that the
  // two bases differ, which is the entire justification for gate A rejecting
  // all four authority forms rather than only `//`.
  it("blocks a backslash authority form that a special base turns into a real host", () => {
    const [link] = mountContainer(["\\\\evil.com/x"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    // Premise, MEASURED (jsdom 26.1.0 / Node v22.22.3): for a SPECIAL scheme
    // the parser treats `\` as `/`, so the authority is real and this input IS
    // an exploit under an http origin. Contrast W3-15, where the very same
    // attribute stays a path under a `tauri:` base. If this ever fails, the
    // diff names the parser change immediately.
    expect(link.href).toBe("http://evil.com/x");

    const evt = clickOn(link);

    expect(evt.defaultPrevented).toBe(true);
    expect(blockedLogs()).toHaveLength(1);
    expect(blockedLogs()[0]).toMatchObject({
      level: "warn",
      status: "fail",
      context: { reason: "scheme", href: "\\\\evil.com/x" },
    });
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe("useMilkdownLinkClickGuard — success path", () => {
  // W3-02
  it("opens exactly the validated URL", async () => {
    const [link] = mountContainer(["https://example.com/x"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    const evt = clickOn(link);

    await vi.waitFor(() => expect(openUrlMock).toHaveBeenCalledTimes(1));
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com/x");
    expect(evt.defaultPrevented).toBe(true);
    expect(openSpy).not.toHaveBeenCalled();
    expect(blockedLogs()).toHaveLength(0);
  });

  // W3-11 — the only case in the matrix where the raw attribute, the
  // strip-normalized string and the resolved URL are three different strings.
  it("hands the opener the ORIGINAL resolved value, not the normalized one", async () => {
    const [link] = mountContainer(["./my file.md"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    // Pins what this environment's parser actually produces. The origin literal
    // is jsdom's configured default, measured here as `http://localhost:3000/`
    // (the test matrix's note said `http://localhost/`; that was wrong for this
    // vitest version). Exact equality only — never relaxed to a substring.
    expect(link.href).toBe("http://localhost:3000/my%20file.md");

    const evt = clickOn(link);

    await vi.waitFor(() => expect(openUrlMock).toHaveBeenCalledTimes(1));
    // The `%20` is load-bearing: exact equality, never stringContaining.
    expect(openUrlMock).toHaveBeenCalledWith("http://localhost:3000/my%20file.md");
    // Names the mangling if the strip-normalized string were opened instead.
    expect(openUrlMock).not.toHaveBeenCalledWith(expect.stringContaining("myfile.md"));
    expect(evt.defaultPrevented).toBe(true);
  });
});

describe("useMilkdownLinkClickGuard — TOCTOU", () => {
  // W3-03 — the only case pinning "capture before await".
  it("opens the pre-captured URL even when the anchor mutates at the microtask boundary", async () => {
    const [link] = mountContainer(["https://example.com/x"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    // (a) dispatchEvent runs the listener to completion synchronously, leaving a
    //     pending import() promise; (b) therefore lands in the same task, before
    //     any .then callback can be pulled off the microtask queue.
    clickOn(link);
    link.setAttribute("href", "javascript:alert(1)");
    expect(link.href).toBe("javascript:alert(1)"); // (c) the mutation really took effect

    await vi.waitFor(() => expect(openUrlMock).toHaveBeenCalledTimes(1));
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com/x");
    expect(openUrlMock).not.toHaveBeenCalledWith("javascript:alert(1)");
    expect(openSpy).not.toHaveBeenCalled();
  });
});

/**
 * WI-5 — the old single Gate B predicate, split into two that answer two
 * different questions.
 *
 * `isSafeResolvedHref` meant "may this click proceed", and its same-protocol
 * disjunct made the app's own scheme openable for ANY host — finding C1. The
 * old W3-04 table is retargeted here: every `resolved` literal is kept and the
 * `protocol` column is dropped.
 *
 * Two expectations invert (`tauri://localhost/foo.md` and
 * `tauri://localhost/#section`: true -> false). The PREDICATE'S IDENTITY
 * changed, not the safety direction — those URLs were never appropriate for the
 * OS opener; dispatching `#section` to it is ADR-0001's row-13 defect. The
 * click-level outcome for them does not become "blocked", it becomes
 * "in-document, inert", asserted positively by W4-03 rows a and b.
 *
 * Imported dynamically inside each test rather than at module scope: while
 * these exports do not yet exist, a static named import aborts the whole file
 * at load time and every other case in it would prove nothing as a RED.
 */
describe("isExternallyOpenableHref — OS opener scope (WI-5)", () => {
  // W4-01 — equivalence-class representatives, not a list of examples. Mixes
  // true and false rows, so `return true` and `return false` both die here.
  const openerTable = [
    { resolved: "http://localhost/foo.md", expected: true },
    { resolved: "https://example.com/x", expected: true },
    { resolved: "mailto:a@b.c", expected: true },
    { resolved: "tel:+15551234", expected: true },
    { resolved: "ftp://ftp.example.com/pub", expected: false },
    { resolved: "tauri://localhost/foo.md", expected: false },
    { resolved: "tauri://localhost/#section", expected: false },
    { resolved: "tauri://evil.com/x", expected: false },
    { resolved: "javascript:alert(1)", expected: false },
    { resolved: "file:///etc/passwd", expected: false },
    { resolved: "customscheme://evil/foo.md", expected: false },
    { resolved: "", expected: false },
    { resolved: "%%%", expected: false },
  ];

  it.each(openerTable)("W4-01: $resolved -> $expected", async ({ resolved, expected }) => {
    const { isExternallyOpenableHref } = await import("../src/services/linkSafety");
    expect(isExternallyOpenableHref(resolved)).toBe(expected);
  });

  // W4-02 — the deliberate divergence from the sanitizer allowlist, pinned as
  // ONE contract rather than two separate facts.
  //
  // `ftp` is safe to RENDER, so `ALLOWED_URI_SCHEMES` contains it. It is not
  // safe to HAND TO THE OS: `tauri-plugin-opener` 2.5.3 grants only
  // mailto/tel/http/https in `permissions/allow-default-urls.toml`, so opener
  // scope is strictly narrower. Without the first assertion a bare
  // `toBe(false)` on a sanitizer-allowed scheme reads as a bug.
  //
  // The refactor this must fail against: "simplify by importing the shared list
  // into linkSafety.ts". It also fails if `ftp` ever leaves
  // `ALLOWED_URI_SCHEMES`, which would make the divergence silently vacuous.
  it("W4-02: ftp is sanitizer-allowed yet outside opener scope", async () => {
    const { isExternallyOpenableHref } = await import("../src/services/linkSafety");
    expect(ALLOWED_URI_SCHEMES).toContain("ftp");
    expect(isExternallyOpenableHref("ftp://ftp.example.com/pub")).toBe(false);
  });

  // W4-06 — PROPERTY over scheme space. The scheme space is infinite, so an
  // example table cannot specify set membership; this is the unit's law case.
  // Kills `startsWith`-shaped membership (via ftps/httpx/tel2/mailtoevil) and
  // an imported-allowlist implementation (via ftp), across both URL forms.
  it("W4-06: refuses every scheme outside OPENER_SCHEMES, in both URL forms", async () => {
    const { isExternallyOpenableHref } = await import("../src/services/linkSafety");

    const rand = mulberry32(SEED);
    const FIRST = "abcdefghijklmnopqrstuvwxyz";
    const REST = "abcdefghijklmnopqrstuvwxyz0123456789+.-";
    const pick = (alphabet: string) => alphabet[Math.floor(rand() * alphabet.length)];

    const random: string[] = [];
    for (let i = 0; i < 500; i++) {
      const len = 2 + Math.floor(rand() * 9); // 2..10 continuation chars
      let scheme = pick(FIRST);
      for (let j = 0; j < len; j++) scheme += pick(REST);
      random.push(scheme);
    }

    const named = [
      "ftp", "ftps", "tauri", "http2", "httpx", "mailtoevil", "telnet", "tel2",
      "ms-msdt", "web+mailto", "s3.aws", "javascript", "data", "vbscript",
      "file", "blob", "about", "chrome", "intent",
    ];

    const domain = [...random, ...named].filter((s) => !EXPECTED_OPENER_SCHEMES.includes(s));
    expect(domain.length, "scheme domain collapsed — generation is broken").toBeGreaterThan(500);

    const violations: { scheme: string; form: string }[] = [];
    for (const scheme of domain) {
      // Both forms are required: `://` and the opaque `:` form take different
      // paths through most scheme-extraction implementations.
      for (const form of [`${scheme}://x/y`, `${scheme}:x`]) {
        if (isExternallyOpenableHref(form)) violations.push({ scheme, form });
      }
    }

    expect(
      violations.slice(0, 40),
      `seed=0x${SEED.toString(16)} — these schemes reached opener scope`
    ).toEqual([]);
  });
});

describe("isSameAppOriginHref — app-origin identity (WI-5)", () => {
  const DOC = "tauri://localhost/";

  // W4-03 — each row is the representative of one field-comparison class, so
  // this table doubles as the branch ledger for the new comparison.
  //
  // Rows i-l assert the fail-closed contract by NOT wrapping in
  // `expect(...).toThrow`: if the implementation throws, the `it` fails with the
  // thrown error, which names the defect precisely.
  const originTable = [
    { id: "a", resolved: "tauri://localhost/foo.md", documentUrl: DOC, expected: true },
    { id: "b", resolved: "tauri://localhost/#section", documentUrl: DOC, expected: true },
    { id: "c", resolved: "tauri://evil.com/x", documentUrl: DOC, expected: false },
    { id: "d", resolved: "tauri://localhost:8080/x", documentUrl: DOC, expected: false },
    { id: "e", resolved: "https://localhost/x", documentUrl: DOC, expected: false },
    { id: "f", resolved: "tauri://user:pass@localhost/x", documentUrl: DOC, expected: false },
    { id: "g", resolved: "tauri://user@localhost/x", documentUrl: DOC, expected: false },
    { id: "h", resolved: "tauri:foo.md", documentUrl: DOC, expected: false },
    { id: "i", resolved: "", documentUrl: DOC, expected: false },
    { id: "j", resolved: "%%%", documentUrl: DOC, expected: false },
    { id: "k", resolved: "tauri://localhost/foo.md", documentUrl: "", expected: false },
    { id: "l", resolved: "tauri://localhost/foo.md", documentUrl: "%%%", expected: false },
    { id: "m", resolved: "tauri://localhost/x", documentUrl: "http://localhost:3000/", expected: false },
    { id: "n", resolved: "tauri://:pass@localhost/x", documentUrl: DOC, expected: false },
  ];

  it.each(originTable)("W4-03$id: $resolved under $documentUrl -> $expected", async ({ resolved, documentUrl, expected }) => {
    const { isSameAppOriginHref } = await import("../src/services/linkSafety");
    expect(isSameAppOriginHref(resolved, documentUrl)).toBe(expected);
  });

  // W4-03 row n's premise, asserted explicitly (W4-04 discipline).
  //
  // This row is SPECIFICATION COMPLETENESS, NOT AN EXPLOIT. No href can deliver
  // this shape in production: gate A rejects `tauri://…` as a non-allowlisted
  // scheme and rejects protocol-relative forms absolutely, so a resolved value
  // reaching this predicate can never carry attacker-chosen credentials by this
  // route. It exists so the credential check is specified on BOTH of its fields
  // instead of half of it being an accident — rows f and g both populate
  // `username`, so an implementation testing only `username === ""` passes the
  // whole table without ever reading `password`.
  it("W4-03n: an empty username with a non-empty password is still not the app origin", async () => {
    const { isSameAppOriginHref } = await import("../src/services/linkSafety");

    // Measured premise: this is the only row with empty username + set password,
    // so it is the only row that credits the `password === ""` branch. If a
    // future parser refuses empty-username authorities, this names the dead
    // premise instead of letting the row go quietly vacuous.
    const parsed = new URL("tauri://:pass@localhost/x");
    expect(parsed.username).toBe("");
    expect(parsed.password).toBe("pass");

    expect(isSameAppOriginHref("tauri://:pass@localhost/x", DOC)).toBe(false);
  });

  // W4-04 — THE OPAQUE-ORIGIN TRAP. The single highest-value case in the matrix.
  //
  // `tauri` is a non-special scheme, so WHATWG gives it an opaque origin that
  // serializes to the literal string "null". Assertions 1-2 PROVE IN THIS
  // ENVIRONMENT that the two origin strings are equal, which is what makes
  // assertion 3 a statement about an implementation that would otherwise pass:
  // `new URL(a).origin === new URL(b).origin` satisfies W4-03 rows a, b, d, e,
  // f, g, i, j and preserves the exact C1 bypass being fixed.
  //
  // Without assertions 1-2, a future jsdom/Node that stopped producing opaque
  // origins would silently turn assertion 3 into a tautology — the test would
  // keep passing while proving nothing. With them, it names the dead premise.
  it("W4-04: refuses an attacker host whose ORIGIN STRING is identical to the app's", async () => {
    const { isSameAppOriginHref } = await import("../src/services/linkSafety");

    expect(new URL("tauri://localhost/").origin).toBe("null");
    expect(new URL("tauri://evil.com/x").origin).toBe("null");

    expect(isSameAppOriginHref("tauri://evil.com/x", DOC)).toBe(false);
  });

  // W4-05 — C1 at predicate level. The only case stating the JOINT conclusion
  // for the attacker value: neither openable nor in-document. That is the
  // sentence that makes the hook's fall-through branch correct for this input.
  it("W4-05: the attacker host is neither externally openable nor same-app-origin", async () => {
    const { isExternallyOpenableHref, isSameAppOriginHref } = await import("../src/services/linkSafety");
    expect(isExternallyOpenableHref("tauri://evil.com/x")).toBe(false);
    expect(isSameAppOriginHref("tauri://evil.com/x", DOC)).toBe(false);
  });

  // W4-07 — PROPERTY: the plan's title stated as a law. At the PRODUCTION
  // origin, no href is both same-app-origin and externally openable.
  //
  // Note the law is origin-scoped, not universal: at the dev origin the two
  // deliberately overlap (W4-08).
  it("W4-07: at the production origin, no href is both same-app-origin and openable", async () => {
    const { isExternallyOpenableHref, isSameAppOriginHref } = await import("../src/services/linkSafety");

    const rand = mulberry32(SEED);
    const FIRST = "abcdefghijklmnopqrstuvwxyz";
    const REST = "abcdefghijklmnopqrstuvwxyz0123456789+.-";
    const pick = (alphabet: string) => alphabet[Math.floor(rand() * alphabet.length)];

    const schemes: string[] = [];
    for (let i = 0; i < 200; i++) {
      const len = 2 + Math.floor(rand() * 9);
      let scheme = pick(FIRST);
      for (let j = 0; j < len; j++) scheme += pick(REST);
      schemes.push(scheme);
    }

    const domain: string[] = [];
    for (const scheme of schemes) {
      for (const host of ["localhost", "evil.com", "localhost:8080"]) {
        domain.push(`${scheme}://${host}/p`);
      }
    }
    domain.push(
      "tauri://localhost/foo.md", "tauri://localhost/#section", "tauri://evil.com/x",
      "https://example.com/x", "http://localhost/foo.md", "mailto:a@b.c",
      "ftp://ftp.example.com/pub", "javascript:alert(1)", "", "%%%"
    );

    let sameOriginCount = 0;
    let openableCount = 0;
    const violations: string[] = [];
    for (const resolved of domain) {
      const openable = isExternallyOpenableHref(resolved);
      const same = isSameAppOriginHref(resolved, DOC);
      if (openable) openableCount++;
      if (same) sameOriginCount++;
      if (openable && same) violations.push(resolved);
    }

    // Non-vacuity: without these the property holds trivially if both predicates
    // return false everywhere — the degenerate implementation W4-03 row a exists
    // to reject. A property whose non-vacuity is unasserted proves nothing.
    expect(sameOriginCount, "no href was same-app-origin — the property is vacuous").toBeGreaterThan(1);
    expect(openableCount, "no href was externally openable — the property is vacuous").toBeGreaterThan(1);

    expect(
      violations.slice(0, 40),
      `seed=0x${SEED.toString(16)} — these are both openable and same-app-origin`
    ).toEqual([]);
  });

  // W4-08 — at the DEV origin the two predicates deliberately OVERLAP.
  //
  // This is the boundary of W4-07's law, and it is the reason a relative link
  // opens externally in dev (W3-06) but is inert in production (W3-05). Without
  // this case that difference looks like an inconsistency; with it, it is a
  // recorded consequence of branch order. An attempt to "fix" the overlap by
  // making the predicates mutually exclusive by construction must fail here.
  it("W4-08: at the dev origin a relative link is both openable and same-app-origin", async () => {
    const { isExternallyOpenableHref, isSameAppOriginHref } = await import("../src/services/linkSafety");
    expect(isExternallyOpenableHref("http://localhost:3000/foo.md")).toBe(true);
    expect(isSameAppOriginHref("http://localhost:3000/foo.md", "http://localhost:3000/")).toBe(true);
  });

  // W4-09 — METAMORPHIC: the verdict is invariant under the path, query and
  // fragment of BOTH arguments.
  //
  // THE HOLE THIS CLOSES: every other `documentUrl` in this matrix is a bare
  // ROOT url. Three wrong implementations pass all of them —
  //   (a) `resolved.startsWith(documentUrl)`
  //   (b) a lookup table keyed on W4-03's literals
  //   (c) parsing both sides then comparing full `href`, or comparing `pathname`
  // In production `window.location.href` equals the root ONLY while the webview
  // sits at `/`. At `tauri://localhost/index.html` all three return false for
  // every relative link, dropping each ordinary in-document click into the
  // hook's fall-through branch and emitting a warn-level security log on every
  // click. That is the signal-quality regression branch 3 exists to prevent.
  //
  // The fourth fixed literal is not optional: the generated half asserts only
  // `true`, so on its own it is satisfied by `return true` — the most dangerous
  // possible implementation, which would make the C1 fix vacuous. That row pins
  // the C1 direction under the NEW document shape, where no other case looks.
  it("W4-09: the verdict ignores path, query and fragment on both arguments", async () => {
    const { isSameAppOriginHref } = await import("../src/services/linkSafety");

    const rand = mulberry32(SEED);
    const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789.";
    const pick = (alphabet: string) => alphabet[Math.floor(rand() * alphabet.length)];

    const suffixes: string[] = [];
    for (let i = 0; i < 64; i++) {
      const segments = Math.floor(rand() * 4); // 0..3 path segments
      let suffix = "";
      for (let s = 0; s < segments; s++) {
        const len = 1 + Math.floor(rand() * 8); // 1..8 chars
        let segment = "";
        for (let c = 0; c < len; c++) segment += pick(ALPHABET);
        suffix += (s === 0 ? "" : "/") + segment;
      }
      if (rand() < 0.5) suffix += "?k=v";
      if (rand() < 0.5) suffix += "#frag";
      suffixes.push(suffix);
    }

    const pairs: { resolved: string; documentUrl: string; expected: boolean }[] = [
      // Fixed literals first, so a reviewer reads the intent without running the
      // generator. Note every documentUrl here is a NON-ROOT url.
      { resolved: "tauri://localhost/foo.md", documentUrl: "tauri://localhost/index.html", expected: true },
      { resolved: "tauri://localhost/a/b/c.md", documentUrl: "tauri://localhost/sub/page.html?q=1#frag", expected: true },
      { resolved: "tauri://localhost/#section", documentUrl: "tauri://localhost/index.html", expected: true },
      { resolved: "tauri://evil.com/x", documentUrl: "tauri://localhost/index.html", expected: false },
    ];

    // Paired with a stride so both arguments vary INDEPENDENTLY rather than in
    // lockstep; a lockstep pairing would never exercise differing paths.
    for (let i = 0; i < suffixes.length; i++) {
      pairs.push({
        resolved: "tauri://localhost/" + suffixes[i],
        documentUrl: "tauri://localhost/" + suffixes[(i * 7 + 3) % suffixes.length],
        expected: true,
      });
    }

    // Non-vacuity floor asserted BEFORE the violations assertion. Order matters:
    // a collapsed generator must fail on this informative line, not on an
    // empty-array comparison that trivially passes.
    expect(pairs.length, "suffix generation collapsed — the property is vacuous").toBeGreaterThan(50);

    const violations: { resolved: string; documentUrl: string; expected: boolean; actual: boolean }[] = [];
    for (const pair of pairs) {
      const actual = isSameAppOriginHref(pair.resolved, pair.documentUrl);
      if (actual !== pair.expected) violations.push({ ...pair, actual });
    }

    expect(
      violations.slice(0, 40),
      `seed=0x${SEED.toString(16)} — the verdict changed with path/query/fragment`
    ).toEqual([]);
  });
});

describe("useMilkdownLinkClickGuard — Gate B wiring", () => {
  // W3-06. NOTE — weaker than it looks, on two counts.
  //
  // 1. The `vi.stubGlobal` below is now INERT: it influences no code path.
  //    After WI-7 the hook reads `window.location.href`, not `.protocol`.
  //    `Location`'s attributes are `[LegacyUnforgeable]`, hence own properties
  //    of the instance, so the spread copies `href` VERBATIM
  //    ("http://localhost:3000/") and only the unread `protocol` is overridden.
  //    The stub is a no-op — it does not manufacture a production origin, and
  //    this case must not be cited as prod-origin coverage. W3-05 (prod-origin
  //    file) is the faithful production-origin coverage. W3-20 below exists
  //    precisely to test the value such a stub would hide.
  // 2. Stubbing does NOT change how jsdom resolves the anchor either. `./foo.md`
  //    still resolves against the real document base (http://localhost:3000/),
  //    so this link clears via the OPENER predicate
  //    (`isExternallyOpenableHref("http://...")`), not the app-origin predicate.
  //
  // It still earns its place as an OVER-BLOCKING guard: a narrowing that starts
  // refusing ordinary relative links at the dev origin fails here.
  it("does not newly block a relative link when the document protocol is non-allowlisted", async () => {
    vi.stubGlobal("location", { ...window.location, protocol: "tauri:" });
    const [link] = mountContainer(["./foo.md"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    const evt = clickOn(link);

    // T2 (WI-8): the behavioral half. Without this the case asserted only
    // wiring — an opener argument and a log count — and could not distinguish
    // "handed off cleanly" from "handed off while ALSO leaving the click live
    // for `tauri-plugin-opener`'s window-level handler to open a second time".
    expect(evt.defaultPrevented).toBe(true);

    await vi.waitFor(() => expect(openUrlMock).toHaveBeenCalledTimes(1));
    expect(openUrlMock).toHaveBeenCalledWith("http://localhost:3000/foo.md");
    expect(blockedLogs()).toHaveLength(0);
  });

  // W3-12 — the constructive witness that Gate B is consulted on every click.
  // Deleting the isSafeResolvedHref call from the hook while leaving the
  // function exported and unit-tested is exactly the failure W3-04 cannot see.
  it("blocks with reason resolved-mismatch when Gate A permits but resolution escapes", async () => {
    const base = document.createElement("base");
    base.setAttribute("href", "customscheme://evil/");
    document.head.appendChild(base);

    const [link] = mountContainer(["./foo.md"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    // Preconditions: the base took effect, and it did not drag the protocol
    // with it — the mismatch is real.
    expect(link.href).toBe("customscheme://evil/foo.md");
    expect(location.protocol).toBe("http:");

    const evt = clickOn(link);

    expect(evt.defaultPrevented).toBe(true);
    expect(blockedLogs()).toHaveLength(1);
    expect(blockedLogs()[0]).toMatchObject({
      level: "warn",
      status: "fail",
      context: { reason: "resolved-mismatch", href: "customscheme://evil/foo.md" },
    });
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  // W3-18 — the only hook-level case where gate A PERMITS but the opener
  // predicate refuses. That combination is new: before this change `ftp`
  // cleared both gates and died silently at Tauri IPC authorization. `ftp` is
  // sanitizer-allowed (safe to RENDER) yet outside opener capability scope —
  // `tauri-plugin-opener` 2.5.3 grants only mailto/tel/http/https in
  // `permissions/allow-default-urls.toml`.
  //
  // Reason-string note: "scheme" here would mean gate A had been widened to
  // reject ftp, which would contradict the freeze on ALLOWED_URI_SCHEMES. As
  // in W3-14, the reason string distinguishes two different regressions.
  it("blocks ftp:// with reason resolved-mismatch instead of reaching the opener", () => {
    const [link] = mountContainer(["ftp://ftp.example.com/pub"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    // Premise: ftp is a special scheme but its default port is absent, so the
    // value round-trips unchanged.
    expect(link.href).toBe("ftp://ftp.example.com/pub");

    const evt = clickOn(link);

    expect(evt.defaultPrevented).toBe(true);
    expect(blockedLogs()).toHaveLength(1);
    expect(blockedLogs()[0]).toMatchObject({
      level: "warn",
      status: "fail",
      context: { reason: "resolved-mismatch", href: "ftp://ftp.example.com/pub" },
    });
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  // W3-20 — the document URL is READ FROM `window.location.href` at click
  // time, not hard-coded.
  //
  // THE HOLE THIS CLOSES: a module constant `documentUrl = "tauri://localhost/"`
  // passes EVERY other case in this plan. At the dev origin the opener and
  // origin predicates deliberately overlap (W4-08), so the opener branch fires
  // first and shadows the in-document branch — the document URL is never
  // consulted on any passing dev-origin path. At the production origin the
  // constant happens to equal the real value. Only a case where the resolved
  // URL and the real document URL DIFFER can tell a constant from a genuine
  // read, which is what the `<base>` element below manufactures.
  //
  // `window.location` is deliberately NOT stubbed here: stubbing it is what
  // W3-06's now-inert `vi.stubGlobal` does, and this case exists precisely to
  // test the value a stub would hide.
  it("blocks an app-scheme URL under a non-app document, reading the real location", () => {
    const base = document.createElement("base");
    base.setAttribute("href", "tauri://localhost/");
    document.head.appendChild(base);

    const [link] = mountContainer(["./foo.md"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    // Premises — the two sides genuinely differ. Without BOTH halves the case
    // proves nothing: it is the difference between the resolved URL and the
    // real document URL that makes a hard-coded constant detectable.
    expect(link.href).toBe("tauri://localhost/foo.md");
    expect(location.href).toBe("http://localhost:3000/");

    const evt = clickOn(link);

    expect(evt.defaultPrevented).toBe(true);
    expect(blockedLogs()).toHaveLength(1);
    expect(blockedLogs()[0]).toMatchObject({
      level: "warn",
      status: "fail",
      context: { reason: "resolved-mismatch", href: "tauri://localhost/foo.md" },
    });
    // THE ASSERTION THAT KILLS THE CONSTANT. Under a hard-coded documentUrl,
    // isSameAppOriginHref("tauri://localhost/foo.md", <constant>) returns true,
    // the in-document branch fires, the click goes inert, and this count would
    // be 1. The blocked-log assertion alone cannot say that — a fifth outcome
    // or a reordering could satisfy it. This count going to zero is what
    // states "the in-document branch did not fire, because the real document
    // URL is not the app origin".
    expect(inDocumentLogs()).toHaveLength(0);
    expect(openUrlMock).not.toHaveBeenCalled();
  });
});

describe("useMilkdownLinkClickGuard — opener failure", () => {
  // W3-07 — window.open is removed outright; failure surfaces as exactly one log.
  it("emits exactly one failure signal and never falls back to window.open", async () => {
    openUrlMock.mockRejectedValue(new Error("no handler"));
    const [link] = mountContainer(["https://example.com/x"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    clickOn(link);

    // Positive observable first: this also forces the implementation to attach a
    // .catch, otherwise the rejection is unhandled and no log ever appears.
    await vi.waitFor(() => expect(openFailureLogs()).toHaveLength(1));
    expect(openFailureLogs()[0]).toMatchObject({ level: "error", status: "fail" });
    expect(openFailureLogs()[0].context?.href).toBe("https://example.com/x");
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe("useMilkdownLinkClickGuard — lifecycle", () => {
  // W3-08
  it("does not throw when #milkdown-container is absent, on mount or unmount", () => {
    expect(() => {
      const result = renderHook(() => useMilkdownLinkClickGuard("doc-1"));
      result.unmount();
    }).not.toThrow();
    expect(loggingService.logEventSync).not.toHaveBeenCalled();
  });

  // W3-09 — the pre-unmount click is the positive control that makes this
  // non-vacuous: "not called after unmount" alone passes against a hook that
  // never registered a listener, or against a deleted hook.
  it("removes the listener on unmount", async () => {
    const [link] = mountContainer(["https://example.com/x"]);
    const { unmount } = renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    clickOn(link);
    await vi.waitFor(() => expect(openUrlMock).toHaveBeenCalledTimes(1));

    unmount();
    const evt2 = clickOn(link);
    await Promise.resolve();
    await Promise.resolve();

    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(evt2.defaultPrevented).toBe(false);
  });

  // W3-10
  it("does not double-register the listener when activeDocumentId changes", async () => {
    const [link] = mountContainer(["https://example.com/x"]);
    const { rerender } = renderHook(({ id }) => useMilkdownLinkClickGuard(id), {
      initialProps: { id: "doc-1" },
    });
    rerender({ id: "doc-2" });

    const evt = clickOn(link);

    await vi.waitFor(() => expect(openUrlMock).toHaveBeenCalledTimes(1));
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com/x");
    // T-1 (WI-10): sibling W3-09 already pins this. Without it the case asserts
    // only that the opener was reached, which cannot distinguish "handled once"
    // from "handled once while ALSO leaving the click live for the plugin's
    // window-level handler".
    expect(evt.defaultPrevented).toBe(true);
  });
});

describe("useMilkdownLinkClickGuard — non-links (WI-10, decision C′)", () => {
  // W3-22 — THE RED. Milkdown/ProseMirror render bare anchors transiently while
  // a link is being edited. Before C′ this took the gate-A block branch and
  // wrote a warn/fail security record on every such click, which is how a `warn`
  // level stops meaning anything. WI-7 already accepted this argument for
  // branch 3's `debug` level; it was simply never applied here.
  it("treats an anchor with no href as a non-link and emits no log at all", () => {
    const container = mountRawContainer();
    const bare = document.createElement("a");
    bare.textContent = "editing";
    container.appendChild(bare);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    // Precondition: this is the attribute-less case, NOT href="" (see W3-26).
    expect(bare.getAttribute("href")).toBeNull();

    const outer = vi.fn();
    document.addEventListener("click", outer);
    try {
      const evt = clickOnNode(bare);

      // C′, not option C: `preventDefault()` stays, so ADR-0002 decision 5
      // ("called on every outcome") and consequence (d) hold without depending
      // on `tauri-plugin-opener`'s internal `!t.href` early return.
      expect(evt.defaultPrevented).toBe(true);
      // ...but `stopPropagation()` does not, so other container listeners
      // (context menus) still observe the click.
      expect(outer).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("click", outer);
    }

    // Zero records of ANY level. Asserting only `blockedLogs()` would pass
    // against an implementation that merely downgraded the level to `debug`.
    expect(logPayloads()).toHaveLength(0);
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  // W3-26 — the `!rawHref` tripwire, and only meaningful paired with W3-22.
  // `<a href="">` resolves to the document URL and is a real self-link that
  // would reload the app. Writing `if (!rawHref)` instead of
  // `if (rawHref === null)` folds it into W3-22's early return and silently
  // contradicts wysiwyg-security.test.ts, which pins isSafeHref("") === false.
  it("still blocks an empty href, which is a different case from a missing one", () => {
    const [link] = mountContainer([""]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    expect(link.getAttribute("href")).toBe("");

    const evt = clickOn(link);

    expect(evt.defaultPrevented).toBe(true);
    expect(blockedLogs()).toHaveLength(1);
    expect(blockedLogs()[0]).toMatchObject({
      level: "warn",
      status: "fail",
      context: { reason: "scheme", href: "" },
    });
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  // W3-23 — the guard's most common runtime path: ordinary paragraph text.
  // Its early-return branch executes in no other test in this file.
  it("ignores a click on a non-anchor element entirely", () => {
    const container = mountRawContainer();
    const paragraph = document.createElement("p");
    paragraph.textContent = "ordinary text";
    container.appendChild(paragraph);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    const evt = clickOnNode(paragraph);

    expect(evt.defaultPrevented).toBe(false);
    expect(logPayloads()).toHaveLength(0);
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  // W3-24 — every other case dispatches directly on the <a>, so `event.target`
  // is always the anchor and `closest("a")`'s upward traversal is never
  // exercised: the implementation could be `event.target as HTMLAnchorElement`
  // and the whole suite would stay green. In production the click target is
  // nearly always the text node's parent.
  it("resolves the anchor from a descendant of the link", async () => {
    const container = mountRawContainer();
    const link = document.createElement("a");
    link.setAttribute("href", "https://example.com/x");
    const inner = document.createElement("strong");
    inner.textContent = "click me";
    link.appendChild(inner);
    container.appendChild(link);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    const evt = clickOnNode(inner);

    expect(evt.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(openUrlMock).toHaveBeenCalledTimes(1));
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com/x");
  });

  // W3-25 — covers the `String(error)` half of the catch-site ternary. W3-07
  // covers only the `Error` half, which is why closing W3-22/23/24 alone does
  // not reach 19/19 branches.
  it("records a non-Error opener rejection through String(error)", async () => {
    openUrlMock.mockRejectedValue("opener exploded");
    const [link] = mountContainer(["https://example.com/x"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    clickOn(link);

    await vi.waitFor(() => expect(openFailureLogs()).toHaveLength(1));
    expect(openFailureLogs()[0]).toMatchObject({ level: "error", status: "fail" });
    expect(openFailureLogs()[0].error).toBe("opener exploded");
  });
});
