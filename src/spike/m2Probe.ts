/**
 * Purpose: M2 spike only (menu plan § 6, branch `spike/menu-m2`, never landed).
 * Logs every modified key, F-key and Tab in the capture and bubble phases
 * (`spike.m2.key`), typed text and IME commits (`spike.m2.input`), and runs the
 * clipboard probes of § 5.7 from the Spike menu and from in-page control buttons
 * (`spike.m2.clip`).
 *
 * @coordinates-with src-tauri/src/menu_spike.rs — emits the `spike.clip.*` actions
 */
import { listen } from "@tauri-apps/api/event";
import { loggingService } from "../services/loggingService";
import { useEditorStore } from "../stores/editorStore";

type Source = "menu" | "button";

const log = (event: string, context: Record<string, unknown>) =>
  loggingService.logEventSync({ level: "info", event, status: "success", context });

const describe = (el: Element | null): string => {
  if (!el) return "none";
  const role = el.getAttribute("role");
  const cls = typeof el.className === "string" ? el.className.split(" ").slice(0, 2).join(".") : "";
  return `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ""}${cls ? `.${cls}` : ""}`;
};

const mode = () => useEditorStore.getState().viewMode;

const isProbed = (e: KeyboardEvent) =>
  e.ctrlKey || e.metaKey || e.altKey || /^F\d{1,2}$/.test(e.key) || e.key === "Tab";

const keyContext = (e: KeyboardEvent, phase: string) => ({
  phase,
  key: e.key,
  code: e.code,
  ctrl: e.ctrlKey,
  meta: e.metaKey,
  alt: e.altKey,
  shift: e.shiftKey,
  altGraph: e.getModifierState("AltGraph"),
  isComposing: e.isComposing,
  defaultPrevented: e.defaultPrevented,
  target: describe(e.target instanceof Element ? e.target : null),
  mode: mode(),
  focused: document.hasFocus(),
});

/** The editor's editable root in the current mode, for execCommand. */
const editorRoot = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(mode() === "source" ? ".cm-content" : ".ProseMirror");

const PROBE_TEXT = () => `m2-probe-${Date.now()}`;

const CLIP_PROBES: Record<string, () => Promise<unknown>> = {
  "spike.clip.async_write_text": () => navigator.clipboard.writeText(PROBE_TEXT()),
  "spike.clip.async_write_item": () => {
    const text = PROBE_TEXT();
    return navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([`<p><strong>${text}</strong></p>`], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
  },
  "spike.clip.async_read": async () => {
    const items = await navigator.clipboard.read();
    const text = await navigator.clipboard.readText();
    return { types: items.flatMap((item) => item.types), textLength: text.length };
  },
  "spike.clip.exec_copy": async () => execCommand("copy"),
  "spike.clip.exec_cut": async () => execCommand("cut"),
  "spike.clip.exec_paste": async () => execCommand("paste"),
};

function execCommand(op: "copy" | "cut" | "paste") {
  const activeBefore = describe(document.activeElement);
  const root = editorRoot();
  const inEditor = !!root && root.contains(document.activeElement);
  if (!inEditor) root?.focus();
  const returned = document.execCommand(op);
  return { returned, activeBefore, inEditorBefore: inEditor };
}

async function runClipProbe(action: string, source: Source) {
  const probe = CLIP_PROBES[action];
  if (!probe) return;
  const started = performance.now();
  const base = {
    action,
    source,
    mode: mode(),
    focused: document.hasFocus(),
    userActivation: navigator.userActivation?.isActive ?? null,
  };
  try {
    const result = await probe();
    log("spike.m2.clip", { ...base, ok: true, result: result ?? null, ms: Math.round(performance.now() - started) });
  } catch (error) {
    log("spike.m2.clip", {
      ...base,
      ok: false,
      errorName: error instanceof Error ? error.name : "unknown",
      error: error instanceof Error ? error.message : String(error),
      ms: Math.round(performance.now() - started),
    });
  }
}

/** Control buttons: the same probes with a user activation. */
function mountButtons() {
  const panel = document.createElement("div");
  panel.setAttribute("data-spike", "m2");
  panel.style.cssText =
    "position:fixed;right:8px;bottom:40px;z-index:99999;display:flex;flex-direction:column;gap:2px;font:11px sans-serif;opacity:0.85";
  for (const action of Object.keys(CLIP_PROBES)) {
    const button = document.createElement("button");
    button.textContent = action.replace("spike.clip.", "");
    button.dataset.spikeAction = action;
    // Keep the editor's focus and selection: a mousedown on a button would take them.
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", () => void runClipProbe(action, "button"));
    panel.appendChild(button);
  }
  document.body.appendChild(panel);
}

export function installM2Probe() {
  window.addEventListener("keydown", (e) => isProbed(e) && log("spike.m2.key", keyContext(e, "capture")), true);
  window.addEventListener("keydown", (e) => isProbed(e) && log("spike.m2.key", keyContext(e, "bubble")));
  document.addEventListener(
    "beforeinput",
    (e) => log("spike.m2.input", { inputType: e.inputType, data: e.data, isComposing: e.isComposing, mode: mode() }),
    true,
  );
  document.addEventListener("compositionend", (e) => log("spike.m2.compositionend", { data: e.data, mode: mode() }), true);
  window.addEventListener("focus", () => log("spike.m2.focus", { focused: true }));
  window.addEventListener("blur", () => log("spike.m2.focus", { focused: false }));
  void listen<{ action: string }>("menu:action", (event) => {
    if (event.payload.action.startsWith("spike.clip.")) void runClipProbe(event.payload.action, "menu");
  });
  if (document.body) mountButtons();
  else window.addEventListener("DOMContentLoaded", mountButtons);
  log("spike.m2.installed", { mode: mode(), userAgent: navigator.userAgent });
}
