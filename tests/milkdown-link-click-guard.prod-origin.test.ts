/** @vitest-environment-options { "url": "tauri://localhost/" } */

/**
 * Hook-level behavior under a genuine production origin.
 *
 * The docblock above moves `location.protocol` AND `document.baseURI` together,
 * so this is a faithful `tauri://localhost` origin rather than a simulation.
 * It is file-level, which is why these cases cannot live in
 * `milkdown-link-click-guard.test.ts`: it would silently move every other
 * case's origin and invalidate their `http://localhost:3000/...` assertions.
 *
 * Cases: W3-05 (rewritten by WI-7), W3-13, W3-14, W3-15, W3-17, W3-19, W3-21.
 *
 * WI-7 replaced the two-outcome guard with three outcomes, and this file is
 * where the difference is visible. At this origin a relative or fragment link
 * resolves to the app's own `tauri:` scheme, which is **in-document
 * navigation, not an external handoff**. It is therefore made inert — the
 * click is cancelled and one `debug` log is emitted — rather than dispatched
 * to the OS opener. Handing it to the opener was the final step of finding C1
 * and is ADR-0001's knowingly-preserved row-13 defect; both are closed here.
 *
 * Mock boundary: `@tauri-apps/plugin-opener` (native OS handoff) and
 * `loggingService` (JSONL over Tauri IPC) only. `isSafeHref`,
 * `isExternallyOpenableHref` and `isSameAppOriginHref` are the logic under
 * test and are never mocked — the predicates run for real through a real DOM
 * click.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMilkdownLinkClickGuard } from "../src/hooks/useMilkdownLinkClickGuard";
import { loggingService } from "../src/services/loggingService";
import type { LogEntryPayload } from "../src/types/logging";

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

function clickOn(link: HTMLAnchorElement): MouseEvent {
  const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(evt);
  return evt;
}

beforeEach(() => {
  document.body.innerHTML = "";
  openUrlMock.mockResolvedValue(undefined);
  openSpy = vi.spyOn(window, "open").mockReturnValue(null);
});

describe("useMilkdownLinkClickGuard under a production tauri:// origin", () => {
  // W3-05 (rewritten, WI-7 inversion 4). The previous version of this case
  // asserted `openUrl` was called with "tauri://localhost/foo.md" — i.e. it
  // asserted the defect: an application-origin URL handed to the external OS
  // opener. That assertion is replaced, not extended; keeping it would keep
  // asserting the behavior being removed.
  it("makes a relative link inert instead of handing the app's own origin to the opener", () => {
    // Tripwire: if the docblock is ever dropped or the option renamed, this
    // fails loudly instead of silently degrading into the W3-06 case.
    expect(location.protocol).toBe("tauri:");

    const [relative, script] = mountContainer(["./foo.md", "javascript:alert(1)"]);

    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    // Premise: resolution really does produce the app's own origin here.
    expect(relative.href).toBe("tauri://localhost/foo.md");

    const relativeEvt = clickOn(relative);

    // Positive observable first (the debug log is emitted synchronously), so
    // the case cannot pass by the handler doing nothing at all.
    expect(inDocumentLogs()).toHaveLength(1);
    expect(inDocumentLogs()[0]).toMatchObject({
      level: "debug",
      status: "success",
      context: { href: "tauri://localhost/foo.md" },
    });
    expect(relativeEvt.defaultPrevented).toBe(true);
    expect(blockedLogs()).toHaveLength(0);
    // The "zero warn-level logs" criterion, asserted directly rather than
    // inferred from the blocked-log count: an in-document click must not emit
    // a security-shaped log line.
    expect(logPayloads().filter((p) => p.level === "warn")).toHaveLength(0);
    // Safe without a `waitFor`: the in-document branch starts NO dynamic
    // import, so there is no pending microtask that could reach the opener
    // later.
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();

    const scriptEvt = clickOn(script);
    expect(scriptEvt.defaultPrevented).toBe(true);
    expect(blockedLogs()).toHaveLength(1);
    expect(blockedLogs()[0]).toMatchObject({
      level: "warn",
      status: "fail",
      context: { reason: "scheme", href: "javascript:alert(1)" },
    });
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  // W3-13 — the second representative of the in-document class, and the one
  // ADR-0001 named as a knowingly-preserved defect (row 13).
  it("makes a fragment link inert, closing ADR-0001 row 13", () => {
    const [link] = mountContainer(["#section"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    // Premise: the fragment resolves against the app's own origin.
    expect(link.href).toBe("tauri://localhost/#section");

    const evt = clickOn(link);

    expect(inDocumentLogs()).toHaveLength(1);
    expect(inDocumentLogs()[0]).toMatchObject({
      level: "debug",
      status: "success",
      context: { href: "tauri://localhost/#section" },
    });
    expect(evt.defaultPrevented).toBe(true);
    // THE ASSERTION THAT CLOSES ROW 13: the old behavior dispatched this
    // application-origin URL to the external OS opener.
    expect(openUrlMock).not.toHaveBeenCalled();
    // A fragment click must not emit a security-shaped log line.
    expect(blockedLogs()).toHaveLength(0);
  });

  // W3-14 — THE C1 REGRESSION TEST. The reason this plan exists.
  it("blocks //evil.com/x, the C1 vector, at gate A", () => {
    const [link] = mountContainer(["//evil.com/x"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    // PREMISE, ASSERTED BEFORE ANYTHING ELSE: the exploit is real in this
    // environment. `tauri` is a non-special scheme, so the WHATWG parser reads
    // the leading `//` as an authority and the app's own scheme ends up
    // wearing an attacker-chosen host. Measured, not guessed: jsdom 26.1.0 /
    // Node v22.22.3. Without this line, a future parser change that stopped
    // producing the hostile resolution would leave the test green and the
    // reader with no idea the case had become vacuous.
    expect(link.href).toBe("tauri://evil.com/x");

    const evt = clickOn(link);

    expect(evt.defaultPrevented).toBe(true);
    expect(blockedLogs()).toHaveLength(1);
    // Reason "scheme" because gate A rejects it, and the logged href is the
    // RAW attribute, not the resolved value. If this ever fails with
    // "resolved-mismatch" instead, gate A's authority rejection has been lost
    // while the origin predicate still holds — the reason string is what tells
    // those two different regressions apart, which is why it is asserted
    // rather than just "blocked".
    expect(blockedLogs()[0]).toMatchObject({
      level: "warn",
      status: "fail",
      context: { reason: "scheme", href: "//evil.com/x" },
    });
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  // W3-15 — backslash authority form under a NON-special base. One half of a
  // two-base partition; W3-16 (main file) is the other half. Together they are
  // the documented proof that the two bases differ, which is the entire
  // justification for gate A rejecting all four authority forms rather than
  // only `//`.
  it("blocks the backslash authority form under a non-special base", () => {
    const [link] = mountContainer(["\\\\evil.com/x"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    // Premise 1 — NO AUTHORITY WAS INTRODUCED. Under a non-special base the
    // backslashes stay in the PATH, so this input is not an exploit here and
    // gate A's rejection is deliberate over-blocking.
    expect(new URL(link.href).hostname).toBe("localhost");
    expect(link.href.startsWith("tauri://localhost/")).toBe(true);

    // Premise 2 — the exact literal, MEASURED (jsdom 26.1.0 / Node v22.22.3),
    // not guessed: under a `tauri://localhost/` base the two backslashes are
    // preserved literally and are NOT percent-encoded to %5C. Never relax this
    // to `toContain` — the whole value of a premise assertion is that it fails
    // loudly when the parser changes, and `toContain` would survive exactly
    // the change worth knowing about.
    expect(link.href).toBe("tauri://localhost/\\\\evil.com/x");

    const evt = clickOn(link);

    expect(evt.defaultPrevented).toBe(true);
    expect(blockedLogs()).toHaveLength(1);
    expect(blockedLogs()[0]).toMatchObject({
      context: { reason: "scheme", href: "\\\\evil.com/x" },
    });
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  // W3-17 — must-not-change, in the direction a narrowing is most likely to
  // break: external links must still open in production.
  it("still hands an https:// link to the opener at the production origin", async () => {
    const [link] = mountContainer(["https://example.com/x"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    // Premise: absolute, unchanged by resolution.
    expect(link.href).toBe("https://example.com/x");

    const evt = clickOn(link);

    await vi.waitFor(() => expect(openUrlMock).toHaveBeenCalledTimes(1));
    // Exact equality, never stringContaining.
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com/x");
    expect(evt.defaultPrevented).toBe(true);
    // It must take the OPENER branch, not the in-document branch. Asserting
    // the in-document log is absent is what makes this case distinguish the
    // two: at this origin an over-eager origin check would silently swallow
    // every external link.
    expect(blockedLogs()).toHaveLength(0);
    expect(inDocumentLogs()).toHaveLength(0);
  });

  // W3-19 — truncation boundary for the in-document log site, mirroring the
  // W3-01 assertion on the blocked log site. Honest priority: LOW. Branch-3
  // hrefs are same-origin and therefore author-controlled, not
  // attacker-controlled, so this is consistency with the other log sites
  // rather than a security boundary.
  it("truncates the in-document log href at exactly 100 characters", () => {
    const [link] = mountContainer(["./" + "a".repeat(200) + ".md"]);
    renderHook(() => useMilkdownLinkClickGuard("doc-1"));

    clickOn(link);

    expect(inDocumentLogs()).toHaveLength(1);
    // Exactly 100, never "at most 100".
    expect(String(inDocumentLogs()[0].context?.href)).toHaveLength(100);
  });

  // W3-21 — PROPAGATION INVARIANT across two different outcomes of the same
  // handler. The claim is about the PAIR, not either click alone.
  //
  // The hole this closes: the in-document branch's most likely implementation
  // is a copy of `blockClick`'s two-line prelude (preventDefault +
  // stopPropagation), and before this case no test would have failed. The cost
  // of getting it wrong is silent — context menus and any future delegated
  // listener stop seeing in-document clicks, with no failing test and no log
  // line.
  it("lets an in-document click propagate while a blocked click does not", () => {
    // A leaked document-level listener would corrupt every later case in this
    // file, hence the try/finally.
    const outer = vi.fn();
    document.addEventListener("click", outer);
    try {
      const [relative, script] = mountContainer(["./foo.md", "javascript:alert(1)"]);
      renderHook(() => useMilkdownLinkClickGuard("doc-1"));

      // The in-document branch MUST propagate: other container listeners
      // (context menus) legitimately observe these clicks.
      const relativeEvt = clickOn(relative);
      expect(relativeEvt.defaultPrevented).toBe(true);
      expect(outer).toHaveBeenCalledTimes(1);

      // THE POSITIVE CONTROL, not decoration. The assertion above, alone,
      // passes trivially against a handler that was never attached, a listener
      // registered on the wrong node, or a click that never reached the
      // container. This second click proves the propagation machinery in this
      // test is live and that stopPropagation() is observable through it — and
      // it simultaneously pins `blockClick`'s existing stopPropagation(),
      // which no other case asserts. The count must NOT increment.
      const scriptEvt = clickOn(script);
      expect(scriptEvt.defaultPrevented).toBe(true);
      expect(outer).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("click", outer);
    }
  });
});
