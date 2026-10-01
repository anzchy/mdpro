/**
 * D34 WI-1 — `useDialogEscape`: one document-level, capture-phase Escape stack.
 *
 * Specification: `.claude/tdd-guardian/tests-20261001-100508.md`, cases DE-1 … DE-20;
 * DE-21 … DE-28 are the D34 WI-6 review fixes (C-1 yield, C-3 null refs, C-4 failure log).
 *
 * Law: each qualifying Escape (key "Escape", not composing, keyCode !== 229, not repeat)
 * removes exactly one registered dialog — the registered container last in document
 * order — so the open count goes n → n−1. With nothing registered it removes nothing and
 * the event is NOT consumed, for every Escape form. Each removal emits exactly one
 * `ui.dialog.escape` line. Covered at S4–S6 by DE-6, DE-7, DE-11, DE-13, DE-17, DE-18,
 * DE-19.
 *
 * Mock boundary: only `@tauri-apps/api/core`. `loggingService` and `loggingStore` are
 * real; `invoke("log_event", { payload })` captures the JSONL payload that would reach
 * Rust (the `tests/use-menu-events-logging.test.ts` pattern). Paired real path:
 * `src-tauri/src/services/logger.rs` `mod tests` (Rust lane).
 *
 * jsdom cannot reproduce WKWebView focus. Every "blur to body" case simulates the D34
 * hypothesis; only the device check (E2E-D34-device) proves the fix on device.
 */
import { StrictMode, useRef, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type LogPayload = { event?: string; context?: Record<string, unknown>; [key: string]: unknown };

const { logs } = vi.hoisted(() => ({ logs: [] as LogPayload[] }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (cmd: string, args?: { payload?: LogPayload }) => {
    if (cmd === "log_event") logs.push(args?.payload ?? {});
    return Promise.resolve(null);
  },
}));

import { useDialogEscape } from "../src/hooks/useDialogEscape";
import { useLoggingStore } from "../src/stores/loggingStore";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface HostProps {
  name: string;
  dialog?: string;
  enabled?: boolean;
  onEscape?: (close: () => void) => void;
  children?: ReactNode;
}

function Host({ name, dialog = name, enabled = true, onEscape, children }: HostProps) {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDialogEscape({
    enabled: enabled && open,
    containerRef: ref,
    dialog,
    outcome: "cancel",
    onEscape: onEscape ? () => onEscape(close) : close,
  });
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-label={name}>
      {children}
    </div>
  );
}

const SLOT_NAMES = ["A", "B", "C"] as const;

interface SlotsProps {
  mounted: ReadonlySet<string>;
  dialogOf?: Record<string, string>;
  onEscapeOf?: Record<string, (close: () => void) => void>;
  withButtons?: boolean;
}

/** Three fixed DOM positions A < B < C; each renders its Host only while mounted. */
function Slots({ mounted, dialogOf = {}, onEscapeOf = {}, withButtons = false }: SlotsProps) {
  return (
    <div>
      {SLOT_NAMES.map((name) => (
        <section key={name} data-slot={name}>
          {mounted.has(name) ? (
            <Host name={name} dialog={dialogOf[name] ?? name} onEscape={onEscapeOf[name]}>
              {withButtons ? <button type="button">{`${name}-btn`}</button> : null}
            </Host>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/** Mount slots one per `act()` so registration order equals `order`. */
function mountInOrder(
  order: readonly string[],
  extra: Omit<SlotsProps, "mounted"> = {},
  wrap: (node: ReactNode) => ReactNode = (node) => node,
  before: ReactNode = null,
) {
  const view = render(
    <>
      {before}
      {wrap(<Slots mounted={new Set()} {...extra} />)}
    </>,
  );
  const mounted = new Set<string>();
  for (const name of order) {
    mounted.add(name);
    view.rerender(
      <>
        {before}
        {wrap(<Slots mounted={new Set(mounted)} {...extra} />)}
      </>,
    );
  }
  return view;
}

function openNames(): string[] {
  return screen.queryAllByRole("dialog").map((el) => el.getAttribute("aria-label") ?? "");
}

function escapeLines(): LogPayload[] {
  return logs.filter((p) => p.event === "ui.dialog.escape");
}

interface PressInit extends KeyboardEventInit {
  keyCode?: number;
}

/** Raw dispatch: lets a case read the return value / `defaultPrevented` and set flags. */
function press(target: EventTarget, init: PressInit) {
  const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  if (init.keyCode !== undefined && ev.keyCode !== init.keyCode) {
    const code = init.keyCode;
    Object.defineProperty(ev, "keyCode", { get: () => code });
  }
  let ok = true;
  act(() => {
    ok = target.dispatchEvent(ev);
  });
  return { ev, ok };
}

function escapeOn(target: EventTarget, extra: PressInit = {}) {
  return press(target, { key: "Escape", ...extra });
}

function blurToBody() {
  act(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  expect(document.activeElement).toBe(document.body);
}

let editorEsc = 0;
function EditorStandIn() {
  return (
    <div
      contentEditable="true"
      suppressContentEditableWarning
      tabIndex={0}
      className="ProseMirror"
      role="textbox"
      aria-label="editor"
      onKeyDown={(e) => {
        if (e.key === "Escape") editorEsc += 1;
      }}
    />
  );
}

let probe: ReturnType<typeof vi.fn>;

beforeEach(() => {
  logs.length = 0;
  editorEsc = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
  probe = vi.fn();
  window.addEventListener("keydown", probe);
});

afterEach(() => {
  window.removeEventListener("keydown", probe);
});

function probeLast(): unknown {
  return probe.mock.calls.at(-1)?.[0];
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe("useDialogEscape (D34 WI-1)", () => {
  it("DE-1: Escape with document.body focused dismisses the only dialog", async () => {
    const user = userEvent.setup();
    render(<Host name="A" />);
    expect(openNames()).toStrictEqual(["A"]);
    blurToBody();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "A" })).toBeNull();
    expect(openNames()).toStrictEqual([]);
    expect(escapeLines()).toHaveLength(1);
  });

  it("DE-2: Escape with focus on an outside textbox dismisses the dialog; the textbox's Escape handler never runs", async () => {
    const user = userEvent.setup();
    let outsideEsc = 0;
    render(
      <>
        <input
          aria-label="outside"
          onKeyDown={(e) => {
            if (e.key === "Escape") outsideEsc += 1;
          }}
        />
        <Host name="A" />
      </>,
    );
    const outside = screen.getByRole("textbox", { name: "outside" });
    await user.click(outside);
    expect(outside).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "A" })).toBeNull();
    expect(outsideEsc).toBe(0);
    expect(outside).toHaveFocus();
  });

  it("DE-3: non-Escape keys (Enter, Tab, a, legacy Esc) pass through untouched", () => {
    render(<Host name="A" />);
    for (const key of ["Enter", "Tab", "a", "Esc"]) {
      const { ev, ok } = press(document.body, { key });
      expect(ok, key).toBe(true);
      expect(ev.defaultPrevented, key).toBe(false);
      expect(probeLast(), key).toBe(ev);
      expect(openNames(), key).toStrictEqual(["A"]);
    }
    expect(escapeLines()).toStrictEqual([]);
  });

  it("DE-4: IME-composing Escape (isComposing and keyCode 229) is left completely alone", () => {
    render(
      <>
        <input aria-label="outside" />
        <Host name="A" />
      </>,
    );
    const outside = screen.getByRole("textbox", { name: "outside" });
    const forms: PressInit[] = [{ isComposing: true }, { keyCode: 229, isComposing: false }];
    for (const form of forms) {
      const { ev, ok } = escapeOn(outside, form);
      expect(ev.keyCode === 229 || ev.isComposing, JSON.stringify(form)).toBe(true);
      expect(ok, JSON.stringify(form)).toBe(true);
      expect(ev.defaultPrevented, JSON.stringify(form)).toBe(false);
      expect(probeLast(), JSON.stringify(form)).toBe(ev);
      expect(openNames()).toStrictEqual(["A"]);
    }
    expect(escapeLines()).toStrictEqual([]);

    escapeOn(outside);
    expect(openNames()).toStrictEqual([]);
  });

  it("DE-5: a repeat Escape is consumed but dismisses nothing while a dialog is registered", () => {
    mountInOrder(["A", "B"]);
    expect(openNames()).toStrictEqual(["A", "B"]);
    for (let i = 0; i < 3; i += 1) {
      const { ev, ok } = escapeOn(document.body, { repeat: true });
      expect(ok).toBe(false);
      expect(ev.defaultPrevented).toBe(true);
    }
    expect(probe).toHaveBeenCalledTimes(0);
    expect(openNames()).toStrictEqual(["A", "B"]);
    expect(escapeLines()).toStrictEqual([]);

    escapeOn(document.body);
    expect(openNames()).toStrictEqual(["A"]);
  });

  describe("DE-6: PROPERTY — every registration order, each Escape removes the last-in-DOM-order dialog", () => {
    const permutations: string[][] = [
      ["A", "B", "C"],
      ["A", "C", "B"],
      ["B", "A", "C"],
      ["B", "C", "A"],
      ["C", "A", "B"],
      ["C", "B", "A"],
    ];
    it.each(permutations.map((p) => [p.join(",")]))("registration order %s", (joined) => {
      const p = joined.split(",");
      const view = mountInOrder(p);
      expect(openNames(), joined).toStrictEqual(["A", "B", "C"]);
      blurToBody();

      const expected = [["A", "B"], ["A"], []];
      for (const after of expected) {
        const { ok } = escapeOn(document.body);
        expect(ok, joined).toBe(false);
        expect(openNames(), joined).toStrictEqual(after);
      }
      const fourth = escapeOn(document.body);
      expect(fourth.ok, joined).toBe(true);
      expect(fourth.ev.defaultPrevented, joined).toBe(false);
      expect(probeLast(), joined).toBe(fourth.ev);
      expect(escapeLines().map((l) => l.context?.dialog), joined).toStrictEqual(["C", "B", "A"]);
      view.unmount();
    });
  });

  describe("DE-7: METAMORPHIC — which dialog Escape removes does not depend on focus", () => {
    const permutations = ["ABC", "ACB", "BAC", "BCA", "CAB", "CBA"];
    const targets = ["body", "outside", "editor", "A-btn", "B-btn", "C-btn"];
    const runs = permutations.flatMap((p) => targets.map((t) => [p, t] as const));
    it.each(runs)("order %s, focus %s", async (p, target) => {
      const user = userEvent.setup();
      const before = (
        <>
          <input aria-label="outside" />
          <EditorStandIn />
        </>
      );
      const view = mountInOrder(p.split(""), { withButtons: true }, undefined, before);
      expect(openNames()).toStrictEqual(["A", "B", "C"]);

      if (target === "body") {
        blurToBody();
      } else {
        const el =
          target === "outside"
            ? screen.getByRole("textbox", { name: "outside" })
            : target === "editor"
              ? screen.getByRole("textbox", { name: "editor" })
              : screen.getByRole("button", { name: target });
        act(() => el.focus());
        expect(el).toHaveFocus();
      }

      await user.keyboard("{Escape}");

      expect(openNames()).toStrictEqual(["A", "B"]);
      if (target === "editor") expect(editorEsc).toBe(0);
      view.unmount();
    });
  });

  describe("DE-8: nested registered containers — the inner one is dismissed first", () => {
    function Nested({ showInner }: { showInner: boolean }) {
      return <Host name="Outer">{showInner ? <Host name="Inner" /> : null}</Host>;
    }

    it("(i) both mounted in one commit (Inner registers before Outer)", () => {
      render(<Nested showInner />);
      expect(openNames()).toStrictEqual(["Outer", "Inner"]);
      escapeOn(document.body);
      expect(openNames()).toStrictEqual(["Outer"]);
      escapeOn(document.body);
      expect(openNames()).toStrictEqual([]);
    });

    it("(ii) Outer mounted first, Inner in a later act (Inner registers after Outer)", () => {
      const view = render(<Nested showInner={false} />);
      view.rerender(<Nested showInner />);
      expect(openNames()).toStrictEqual(["Outer", "Inner"]);
      escapeOn(document.body);
      expect(openNames()).toStrictEqual(["Outer"]);
      escapeOn(document.body);
      expect(openNames()).toStrictEqual([]);
    });
  });

  describe("DE-9: tie-break — two registrations on the same container, the later registration wins", () => {
    const counts = { first: 0, second: 0 };
    function TieHost({ firstEnabled }: { firstEnabled: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useDialogEscape({
        enabled: firstEnabled,
        containerRef: ref,
        dialog: "tie-first",
        outcome: "cancel",
        onEscape: () => {
          counts.first += 1;
        },
      });
      useDialogEscape({
        enabled: true,
        containerRef: ref,
        dialog: "tie-second",
        outcome: "cancel",
        onEscape: () => {
          counts.second += 1;
        },
      });
      return <div ref={ref} role="dialog" aria-label="tie" />;
    }

    beforeEach(() => {
      counts.first = 0;
      counts.second = 0;
    });

    it("base: registration order = call order, the second call wins", () => {
      render(<TieHost firstEnabled />);
      escapeOn(document.body);
      expect(counts).toStrictEqual({ first: 0, second: 1 });
      expect(escapeLines()[0]?.context).toStrictEqual({ dialog: "tie-second", outcome: "cancel" });
    });

    it("variant: re-enabling the first hook registers it last, so it wins", () => {
      const view = render(<TieHost firstEnabled />);
      view.rerender(<TieHost firstEnabled={false} />);
      view.rerender(<TieHost firstEnabled />);
      escapeOn(document.body);
      expect(counts).toStrictEqual({ first: 1, second: 0 });
      expect(escapeLines()[0]?.context).toStrictEqual({ dialog: "tie-first", outcome: "cancel" });
    });
  });

  it("DE-10: NO-LEAK — a consumed Escape reaches no other listener", () => {
    const seen = { ancestor: 0, ancestorCapture: 0, lowerCard: 0, docBubble: 0 };
    const docBubble = () => {
      seen.docBubble += 1;
    };
    document.addEventListener("keydown", docBubble);
    try {
      render(
        <div
          onKeyDown={() => {
            seen.ancestor += 1;
          }}
          onKeyDownCapture={() => {
            seen.ancestorCapture += 1;
          }}
        >
          <div
            role="dialog"
            aria-label="lower"
            onKeyDown={() => {
              seen.lowerCard += 1;
            }}
          >
            <input aria-label="lower-input" />
          </div>
          <Host name="top" />
        </div>,
      );
      const input = screen.getByRole("textbox", { name: "lower-input" });
      act(() => input.focus());
      expect(input).toHaveFocus();

      const { ev, ok } = escapeOn(input);

      expect(ok).toBe(false);
      expect(ev.defaultPrevented).toBe(true);
      expect(probe).toHaveBeenCalledTimes(0);
      expect(seen).toStrictEqual({ ancestor: 0, ancestorCapture: 0, lowerCard: 0, docBubble: 0 });
      expect(openNames()).toStrictEqual(["lower"]);
    } finally {
      document.removeEventListener("keydown", docBubble);
    }
  });

  it("DE-11: LIFECYCLE IDEMPOTENCE — 50 mount/unmount cycles leave one effective listener, then none", async () => {
    const user = userEvent.setup();
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const isCaptureKeydown = (args: unknown[]) => {
      const opts = args[2];
      const capture =
        opts === true ||
        (typeof opts === "object" && opts !== null && (opts as AddEventListenerOptions).capture === true);
      return args[0] === "keydown" && capture;
    };

    for (let i = 0; i < 50; i += 1) {
      const cycle = render(<Host name="A" />);
      cycle.unmount();
    }
    const view = mountInOrder(["A", "B"]);
    expect(openNames()).toStrictEqual(["A", "B"]);

    await user.keyboard("{Escape}");

    expect(openNames()).toStrictEqual(["A"]);
    expect(escapeLines()).toHaveLength(1);

    view.unmount();
    const { ev, ok } = escapeOn(document.body);
    expect(ok).toBe(true);
    expect(ev.defaultPrevented).toBe(false);
    expect(probeLast()).toBe(ev);

    // Supplement only (Level 6). If the hook moves to AbortController-based removal,
    // delete this supplement and keep the behavioural assertions above (rule 12, stated
    // in advance by the matrix).
    const adds = add.mock.calls.filter(isCaptureKeydown).length;
    const removes = remove.mock.calls.filter(isCaptureKeydown).length;
    expect(adds).toBe(removes);
  });

  it("DE-12: enabled: false — no capture, Escape behaves as before", () => {
    render(<Host name="A" enabled={false} />);
    const { ev, ok } = escapeOn(document.body);
    expect(ok).toBe(true);
    expect(ev.defaultPrevented).toBe(false);
    expect(probeLast()).toBe(ev);
    expect(openNames()).toStrictEqual(["A"]);
    expect(escapeLines()).toStrictEqual([]);
  });

  it("DE-13: toggling enabled 10 times never adds a second listener", () => {
    let setEnabled: (v: boolean) => void = () => {};
    function Parent() {
      const [enabled, set] = useState(true);
      setEnabled = set;
      return <Host name="A" enabled={enabled} />;
    }
    render(<Parent />);
    for (let i = 0; i < 10; i += 1) {
      act(() => setEnabled(false));
      act(() => setEnabled(true));
    }
    expect(openNames()).toStrictEqual(["A"]);

    const first = escapeOn(document.body);
    expect(first.ok).toBe(false);
    expect(openNames()).toStrictEqual([]);
    expect(escapeLines()).toHaveLength(1);

    const second = escapeOn(document.body);
    expect(second.ok).toBe(true);
    expect(second.ev.defaultPrevented).toBe(false);
    expect(probeLast()).toBe(second.ev);
    expect(escapeLines()).toHaveLength(1);
  });

  it("DE-14: callback freshness — after a re-render with a new onEscape, the new one runs", async () => {
    const user = userEvent.setup();
    function FreshHost({ mode }: { mode: string }) {
      const [result, setResult] = useState("none");
      return (
        <>
          <Host name="A" onEscape={() => setResult(mode)} />
          <output aria-label="result">{result}</output>
        </>
      );
    }
    const view = render(<FreshHost mode="old" />);
    view.rerender(<FreshHost mode="new" />);

    await user.keyboard("{Escape}");

    expect(screen.getByLabelText("result")).toHaveTextContent(/^new$/);
  });

  it("DE-15: a throwing onEscape does not corrupt the registry", () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      e.preventDefault();
      errors.push(e.error);
    };
    window.addEventListener("error", onError);
    try {
      mountInOrder(["A", "B"], {
        onEscapeOf: {
          B: (close) => {
            close();
            throw new Error("boom");
          },
        },
      });
      expect(openNames()).toStrictEqual(["A", "B"]);

      const first = escapeOn(document.body);
      expect(first.ok).toBe(false);
      expect(openNames()).toStrictEqual(["A"]);

      const second = escapeOn(document.body);
      expect(second.ok).toBe(false);
      expect(openNames()).toStrictEqual([]);

      const third = escapeOn(document.body);
      expect(third.ok).toBe(true);
      expect(third.ev.defaultPrevented).toBe(false);

      expect(escapeLines().map((l) => l.context?.dialog)).toStrictEqual(["B", "A"]);
    } finally {
      window.removeEventListener("error", onError);
    }
  });

  it("DE-16: LOGGING — one dismissal, one content-free line; ignored events log nothing", () => {
    render(<Host name="X" dialog="confirm" />);
    escapeOn(document.body, { isComposing: true });
    escapeOn(document.body, { keyCode: 229 });
    escapeOn(document.body, { repeat: true });
    press(document.body, { key: "Enter" });
    escapeOn(document.body);
    expect(openNames()).toStrictEqual([]);
    escapeOn(document.body);

    const lines = escapeLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].context).toStrictEqual({ dialog: "confirm", outcome: "cancel" });
    const allowed = ["level", "event", "status", "actionId", "context"];
    for (const key of Object.keys(lines[0])) expect(allowed).toContain(key);
    expect(logs).toHaveLength(1);
  });

  it("DE-17: StrictMode double effects do not double-register", () => {
    mountInOrder(["A", "B"], {}, (node) => <StrictMode>{node}</StrictMode>);
    expect(openNames()).toStrictEqual(["A", "B"]);

    expect(escapeOn(document.body).ok).toBe(false);
    expect(openNames()).toStrictEqual(["A"]);
    expect(escapeOn(document.body).ok).toBe(false);
    expect(openNames()).toStrictEqual([]);

    const third = escapeOn(document.body);
    expect(third.ok).toBe(true);
    expect(third.ev.defaultPrevented).toBe(false);
    expect(escapeLines()).toHaveLength(2);
  });

  describe("DE-18: Escape (repeat and plain) on an EMPTY registry is not consumed", () => {
    function assertPassesThrough() {
      for (const init of [{ repeat: true }, {}] as PressInit[]) {
        const { ev, ok } = escapeOn(document.body, init);
        expect(ok, JSON.stringify(init)).toBe(true);
        expect(ev.defaultPrevented, JSON.stringify(init)).toBe(false);
        expect(probeLast(), JSON.stringify(init)).toBe(ev);
      }
      expect(escapeLines()).toHaveLength(0);
    }

    it("(a) after a listener existed and its only host unmounted", () => {
      const view = render(<Host name="A" />);
      view.unmount();
      assertPassesThrough();
    });

    it("(b) with a disabled host mounted", () => {
      render(<Host name="A" enabled={false} />);
      assertPassesThrough();
      expect(openNames()).toStrictEqual(["A"]);
    });
  });

  it("DE-19: two hosts with the SAME dialog name are two stack entries", () => {
    mountInOrder(["B", "A"], { dialogOf: { A: "confirm", B: "confirm" } });
    expect(openNames()).toStrictEqual(["A", "B"]);
    blurToBody();

    const first = escapeOn(document.body);
    expect(first.ok).toBe(false);
    expect(openNames()).toStrictEqual(["A"]);

    const second = escapeOn(document.body);
    expect(second.ok).toBe(false);
    expect(openNames()).toStrictEqual([]);

    const third = escapeOn(document.body);
    expect(third.ok).toBe(true);
    expect(third.ev.defaultPrevented).toBe(false);
    expect(probeLast()).toBe(third.ev);

    const lines = escapeLines();
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.context).toStrictEqual({ dialog: "confirm", outcome: "cancel" });
  });

  it("DE-20: Escape with focus in a contenteditable editor dismisses the dialog; the editor's handler never runs", async () => {
    const user = userEvent.setup();
    render(
      <>
        <EditorStandIn />
        <Host name="A" />
      </>,
    );
    const editor = screen.getByRole("textbox", { name: "editor" });
    act(() => editor.focus());
    expect(editor).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "A" })).toBeNull();
    expect(editorEsc).toBe(0);
    expect(editor).toHaveFocus();
    expect(escapeLines()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// D34 WI-6 — review fixes C-1 (yield to a later unregistered modal), C-3 / M-2
// (null-ref entries are never topmost), C-4 / M-4 (a throwing onEscape logs a failure).
// ---------------------------------------------------------------------------

/** A modal that is NOT on the stack (ReloadDialog / Settings shape): handles Escape itself. */
function Unregistered({ name, onEsc }: { name: string; onEsc?: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onKeyDown={(e) => {
        if (e.key === "Escape") onEsc?.();
      }}
    >
      <button type="button">{`${name}-btn`}</button>
    </div>
  );
}

/** Registers a dialog whose containerRef is never attached (stays null). */
function NullRefHost({ name, onEscape }: { name: string; onEscape: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogEscape({ enabled: true, containerRef: ref, dialog: name, outcome: "cancel", onEscape });
  return null;
}

describe("useDialogEscape review fixes (D34 WI-6)", () => {
  it("DE-21: an unregistered aria-modal LATER in the DOM takes precedence — the hook does nothing at all", () => {
    let laterEsc = 0;
    const tree = (withLater: boolean) => (
      <>
        <Host name="A" />
        {withLater ? <Unregistered name="later" onEsc={() => (laterEsc += 1)} /> : null}
      </>
    );
    const view = render(tree(true));
    expect(openNames()).toStrictEqual(["A", "later"]);

    // Focus on body, plain and repeat: nothing consumed, nothing dismissed, nothing logged.
    blurToBody();
    for (const init of [{}, { repeat: true }] as PressInit[]) {
      const { ev, ok } = escapeOn(document.body, init);
      expect(ok, JSON.stringify(init)).toBe(true);
      expect(ev.defaultPrevented, JSON.stringify(init)).toBe(false);
      expect(probeLast(), JSON.stringify(init)).toBe(ev);
    }
    // Focus inside the later modal: its own Escape handler runs.
    const btn = screen.getByRole("button", { name: "later-btn" });
    act(() => btn.focus());
    const inside = escapeOn(btn);
    expect(inside.ok).toBe(true);
    expect(inside.ev.defaultPrevented).toBe(false);
    expect(laterEsc).toBe(1);
    expect(openNames()).toStrictEqual(["A", "later"]);
    expect(escapeLines()).toStrictEqual([]);
    expect(logs).toStrictEqual([]);

    // Once the later modal is gone, Escape reaches the registered dialog again.
    view.rerender(tree(false));
    const after = escapeOn(document.body);
    expect(after.ok).toBe(false);
    expect(openNames()).toStrictEqual([]);
    expect(escapeLines()).toHaveLength(1);
  });

  describe("DE-22: PROPERTY — an unregistered modal blocks the stack only when it follows the topmost registered dialog", () => {
    // Index among A, B, C at which the unregistered modal U is inserted (0 = before A, 3 = after C).
    const positions = [0, 1, 2, 3];
    it.each(positions.map((p) => [p]))("unregistered modal at position %i", (pos) => {
      const slots = ["A", "B", "C"].map((name) => <Host key={name} name={name} />);
      slots.splice(pos, 0, <Unregistered key="U" name="U" />);
      render(<>{slots}</>);
      const registered = () => openNames().filter((n) => n !== "U");
      expect(registered()).toStrictEqual(["A", "B", "C"]);
      blurToBody();

      const { ev, ok } = escapeOn(document.body);
      if (pos === 3) {
        expect(ok).toBe(true);
        expect(ev.defaultPrevented).toBe(false);
        expect(probeLast()).toBe(ev);
        expect(registered()).toStrictEqual(["A", "B", "C"]);
        expect(escapeLines()).toStrictEqual([]);
      } else {
        expect(ok).toBe(false);
        expect(ev.defaultPrevented).toBe(true);
        expect(registered()).toStrictEqual(["A", "B"]);
        expect(escapeLines().map((l) => l.context?.dialog)).toStrictEqual(["C"]);
      }
    });
  });

  it("DE-23: an aria-modal INSIDE a registered container is not 'unregistered' (own card, nested modal)", () => {
    render(
      <>
        <Host name="A" />
        <Host name="B">
          <div role="dialog" aria-modal="true" aria-label="B-card">
            <Unregistered name="B-nested" />
          </div>
        </Host>
      </>,
    );
    expect(openNames()).toStrictEqual(["A", "B", "B-card", "B-nested"]);
    const { ev, ok } = escapeOn(screen.getByRole("button", { name: "B-nested-btn" }));
    expect(ok).toBe(false);
    expect(ev.defaultPrevented).toBe(true);
    expect(openNames()).toStrictEqual(["A"]);
    expect(escapeLines().map((l) => l.context?.dialog)).toStrictEqual(["B"]);
  });

  it("DE-24: a registered dialog nested inside an unregistered modal still takes Escape", () => {
    let outerEsc = 0;
    render(
      <div role="dialog" aria-modal="true" aria-label="outer" onKeyDown={() => (outerEsc += 1)}>
        <Host name="A" />
      </div>,
    );
    const { ok } = escapeOn(document.body);
    expect(ok).toBe(false);
    expect(openNames()).toStrictEqual(["outer"]);
    expect(outerEsc).toBe(0);
  });

  it("DE-25: a null-ref entry registered AFTER a real one is never topmost", () => {
    let nullEsc = 0;
    const view = render(<Host name="A" />);
    view.rerender(
      <>
        <Host name="A" />
        <NullRefHost name="ghost" onEscape={() => (nullEsc += 1)} />
      </>,
    );
    const first = escapeOn(document.body);
    expect(first.ok).toBe(false);
    expect(openNames()).toStrictEqual([]);
    expect(nullEsc).toBe(0);
    expect(escapeLines().map((l) => l.context?.dialog)).toStrictEqual(["A"]);

    // Only the null-ref entry is left: Escape is not consumed.
    const second = escapeOn(document.body);
    expect(second.ok).toBe(true);
    expect(second.ev.defaultPrevented).toBe(false);
    expect(nullEsc).toBe(0);
  });

  it("DE-26: only null-ref entries registered — Escape (plain and repeat) is not consumed and logs nothing", () => {
    let nullEsc = 0;
    render(
      <>
        <NullRefHost name="g1" onEscape={() => (nullEsc += 1)} />
        <NullRefHost name="g2" onEscape={() => (nullEsc += 1)} />
      </>,
    );
    for (const init of [{}, { repeat: true }] as PressInit[]) {
      const { ev, ok } = escapeOn(document.body, init);
      expect(ok, JSON.stringify(init)).toBe(true);
      expect(ev.defaultPrevented, JSON.stringify(init)).toBe(false);
      expect(probeLast(), JSON.stringify(init)).toBe(ev);
    }
    expect(nullEsc).toBe(0);
    expect(escapeLines()).toStrictEqual([]);
  });

  it("DE-27: LOGGING — a throwing onEscape logs a failure, not the success outcome; the error still propagates", () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      e.preventDefault();
      errors.push(e.error);
    };
    window.addEventListener("error", onError);
    try {
      mountInOrder(["A", "B"], {
        onEscapeOf: {
          B: () => {
            throw new Error("boom");
          },
        },
      });
      const failed = escapeOn(document.body);
      expect(failed.ok).toBe(false);
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe("boom");
      expect(openNames()).toStrictEqual(["A", "B"]);

      const lines = escapeLines();
      expect(lines).toHaveLength(1);
      expect(lines[0].level).toBe("error");
      expect(lines[0].status).toBe("fail");
      expect(lines[0].context).toStrictEqual({ dialog: "B", outcome: "error" });
      expect(JSON.stringify(lines[0])).not.toContain("boom");
    } finally {
      window.removeEventListener("error", onError);
    }
  });

  it("DE-28: LOGGING — a successful onEscape logs level info, status success, the dialog's outcome", () => {
    render(<Host name="A" dialog="confirm" />);
    escapeOn(document.body);
    const lines = escapeLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("info");
    expect(lines[0].status).toBe("success");
    expect(lines[0].context).toStrictEqual({ dialog: "confirm", outcome: "cancel" });
  });
});
