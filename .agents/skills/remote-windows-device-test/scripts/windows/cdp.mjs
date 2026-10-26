// Purpose: minimal Chrome DevTools Protocol client for the mdpro WebView2 page
// (127.0.0.1:9222; mdpro must be started by launch.cmd). Testing only.
// Usage:
//   node cdp.mjs eval "<js>"        evaluate in the page (awaits promises), print JSON
//   node cdp.mjs eval64 <base64>    same, expression base64-encoded (no quoting issues; ssh line ~8 KB)
//   node cdp.mjs evalfile <path>    same, expression read from a UTF-8 file (no size limit)
//   node cdp.mjs shot <out.png>     capture the page viewport
//   node cdp.mjs identity           read every page's Tauri label and physical outer rect
//   node cdp.mjs identity-native    same, plus page id for closed/recreated-page rejection
//   node cdp.mjs --window <label> bind <base64 JSON {rect,nonce}>
//   node cdp.mjs --window <label> unbind <base64 JSON {nonce}>
//                                    temporarily challenge/restore this page's native title
//   node cdp.mjs --window <label> … run in the page whose Tauri window label is <label> (WI-E2E-W
//                                     item 3). Each page is asked for its label, and the chosen page is
//                                     asked again on the eval's own connection just before the eval.
//                                     Without a label, several pages is an error, never "the first".
// Exit: 0 ok; 1 the expression threw (the JSON {exception} is still printed); 2 usage / no page;
// 3 CDP_TIMEOUT (the eval may have run); 4 the port is closed; 5 no page has the label, or its
// label changed before the eval (WINDOW_NOT_FOUND / WINDOW_MISMATCH); 6 several pages and no label,
// or several with the label (WINDOW_AMBIGUOUS). 5 and 6 print the candidates and evaluate nothing.
// A protocol error instead of a result (e.g. "Execution context was destroyed") prints
// {"error":"CDP_ERROR", code, message} and exits 1: the eval may or may not have run.
// Once a socket is open, every exit goes through end(): it closes each socket, waits for the close
// (at most 1 s), sets process.exitCode and lets the event loop drain. Calling process.exit, even
// after the close events, aborted Node 24 on Windows in libuv (UV_HANDLE_CLOSING, 0xC0000409)
// after the answer was printed: the handles are still closing when `close` fires (D248, device
// re-check). Only a socket that never closes reaches the unref'd fallback exit after 2 s.
// A connection that drops, or never opens, prints {"error":"CDP_CONNECTION_LOST"} and exits 3: the
// eval may have run. end() keeps the first code and stops the timer, so nothing that happens during
// the shutdown (a late CDP_TIMEOUT, a late /json/list failure) prints or changes it (D248-WI-4).
// MDPRO_CDP_TIMEOUT_MS overrides the 25 s CDP_TIMEOUT (tests).
// Env: MDPRO_CDP_PORT (default 9222), MDPRO_CDP_URL_PREFIX (default http://tauri.localhost),
// MDPRO_CDP_LABEL (same as --window).
// The expression may use `return`; it runs inside an async function. Helpers on window.__a
// (trusted CDP input; installed on every run):
//   __a.q(sel)                        document.querySelector
//   __a.sleep(ms)
//   __a.click(selOrEl, {button, count, dx, dy, mods:["ctrl","shift","alt","meta"]})
//   __a.clickXY(x, y, {button, count})  CSS px in the viewport
//   __a.text(s)                       Input.insertText — the only safe way to type (the PC's IME composes real keys)
//   __a.key(key, mods)                named keys (Enter, Escape, Tab, Backspace, Delete, Arrow*, Home, End,
//                                     PageUp, PageDown, F1-F12), letters, digits and US punctuation ` - = [ ] \ ; ' , . /
//   __a.toastsOn() / __a.toasts()     start collecting text of nodes added to the DOM / read and clear it
//   __a.cspProbe(url)                 load url as an <img>; resolves {loaded, violations:[{directive, blocked}]}
// Limits: CDP input reaches the page only. It does not move Windows keyboard focus into the WebView
// and does not trigger native menu accelerators — use ui.ps1 (clickat + chord) for real input.
import fs from "node:fs";
let argv = process.argv.slice(2);
let label = process.env.MDPRO_CDP_LABEL || "";
if (argv[0] === "--window") { label = argv[1] || ""; argv = argv.slice(2); }
const [mode, arg] = argv;
const sockets = new Set();
const CLOSE_WAIT_MS = 1000;
// The wait timer is ref'd: a socket that failed before opening may never fire `close`, and an
// unref'd timer let the loop drain before end() set the code (exit 0; D248-WI-4).
const closed = (ws) => new Promise((done) => {
  if (ws.readyState === WebSocket.CLOSED) return done();
  const t = setTimeout(done, CLOSE_WAIT_MS);
  ws.addEventListener("close", () => { clearTimeout(t); done(); }, { once: true });
  ws.close();
});
// Runs once: a later end() joins the first and its code is dropped. Once it has started, connect()
// opens nothing more, so no socket escapes the close (audit b171), and the timer is cleared, so a
// CDP_TIMEOUT never follows an answer (audit b174 M2).
let ending = null;
let timer = null;
const DRAIN_FALLBACK_MS = 2000;
const end = (code) => (ending ??= (async () => { clearTimeout(timer); await Promise.all([...sockets].map(closed)); process.exitCode = code; setTimeout(() => process.exit(code), DRAIN_FALLBACK_MS).unref?.(); })());
// fail() throws Stop; main() turns it into end(code). Nothing is left awaiting at top level, so
// the drained loop exits with process.exitCode (a pending top-level await would exit 13).
class Stop { constructor(code) { this.code = code; } }
// The socket dropped or never opened. main() turns it into CDP_CONNECTION_LOST and end(3).
class ConnLost {}
timer = setTimeout(() => { console.log(JSON.stringify("CDP_TIMEOUT")); end(3); }, Number(process.env.MDPRO_CDP_TIMEOUT_MS) || 25000);
timer.unref?.();
const PORT = process.env.MDPRO_CDP_PORT || "9222";
const PREFIX = process.env.MDPRO_CDP_URL_PREFIX || "http://tauri.localhost";
// Never settles once end() has started: that socket would escape the close. main() is then left
// pending, which is fine, because end() owns the exit.
const connect = (url) => new Promise((open, lost) => {
  if (ending) return;
  const ws = new WebSocket(url);
  sockets.add(ws);
  let id = 0; const waiting = new Map();
  const drop = () => { lost(new ConnLost()); for (const w of waiting.values()) w.lost(new ConnLost()); waiting.clear(); };
  ws.addEventListener("close", () => { sockets.delete(ws); drop(); });
  ws.addEventListener("error", drop);
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id).res(d); waiting.delete(d.id); } });
  const send = (method, params = {}) => new Promise((res, rej) => {
    if (ws.readyState !== WebSocket.OPEN) return rej(new ConnLost());
    id += 1; waiting.set(id, { res, lost: rej }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onopen = () => open({ ws, send });
});
// Tauri 2 puts the window's label in its injected metadata (to be confirmed on WebView2 in demo W6).
const LABEL_PROBE = "window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null";
const IDENTITY_PROBE = `(async () => {
  const internals = window.__TAURI_INTERNALS__;
  const label = internals?.metadata?.currentWindow?.label;
  if (!label) throw new Error("IDENTITY_LABEL_MISSING");
  const [position, size] = await Promise.all([
    internals.invoke("plugin:window|outer_position", { label }),
    internals.invoke("plugin:window|outer_size", { label }),
  ]);
  return { label, rect: [position.x, position.y, position.x + size.width, position.y + size.height] };
})()`;
const validRect = (rect) => Array.isArray(rect) && rect.length === 4 &&
  rect.every(Number.isSafeInteger) && rect[2] > rect[0] && rect[3] > rect[1];
const sameRect = (a, b) => validRect(a) && validRect(b) && a.every((n, i) => n === b[i]);
const labelOf = async (send) => (await send("Runtime.evaluate", { expression: LABEL_PROBE, returnByValue: true })).result?.result?.value ?? null;
// Prints only before end() starts: after it, the outcome is already printed and decided.
const say = (v) => { if (!ending) console.log(JSON.stringify(v, null, 1)); };
const fail = (code, error, extra) => { say({ error, ...extra }); throw new Stop(code); };
async function main() {
let list;
try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); }
catch { say(`CDP_PORT_CLOSED: nothing on 127.0.0.1:${PORT}; after unsaved-work clearance run scripts/mac/mdpro.sh debug --yes`); throw new Stop(4); }
const pages = list.filter((t) => t.type === "page" && t.url.startsWith(PREFIX));
if (!pages.length) { if (!ending) console.error(`no page starting with ${PREFIX} on port ${PORT}`); throw new Stop(2); }
if (mode === "identity" || mode === "identity-native") {
  const records = [];
  for (const page of pages) {
    const connection = await connect(page.webSocketDebuggerUrl);
    const response = await connection.send("Runtime.evaluate", { expression: IDENTITY_PROBE, awaitPromise: true, returnByValue: true });
    await closed(connection.ws);
    if (response.error || response.result?.exceptionDetails) fail(1, "IDENTITY_READ_FAILED", { page: page.id });
    const record = response.result?.result?.value;
    if (!record || typeof record.label !== "string" || !record.label || !validRect(record.rect)) fail(1, "IDENTITY_INVALID", { page: page.id });
    records.push(mode === "identity-native" ? { ...record, pageId: page.id } : record);
  }
  if (new Set(records.map((r) => r.label)).size !== records.length) fail(6, "IDENTITY_DUPLICATE_LABEL");
  say(records);
  return 0;
}
let page = pages[0];
if (label || pages.length > 1) {
  const candidates = [];
  for (const p of pages) { const c = await connect(p.webSocketDebuggerUrl); candidates.push({ id: p.id, label: await labelOf(c.send), url: p.url }); await closed(c.ws); }
  if (!label) fail(6, "WINDOW_AMBIGUOUS", { hint: "several mdpro windows: pass --window <label>", candidates });
  const hits = candidates.filter((c) => c.label === label);
  if (hits.length !== 1) fail(hits.length ? 6 : 5, hits.length ? "WINDOW_AMBIGUOUS" : "WINDOW_NOT_FOUND", { label, candidates });
  page = pages.find((p) => p.id === hits[0].id);
}
const { ws, send } = await connect(page.webSocketDebuggerUrl);
// Trusted input goes through CDP Input.* (isTrusted=true), driven from Node via a binding.
await send("Runtime.addBinding", { name: "__cdpInput" });
// A send lost here also fails the eval main() is waiting on, which reports it.
ws.addEventListener("message", (m) => onBinding(m).catch(() => {}));
async function onBinding(m) {
  const d = JSON.parse(m.data);
  if (d.method !== "Runtime.bindingCalled" || d.params.name !== "__cdpInput") return;
  const { seq, kind, x, y, text, key, code, mods, vk, button = "left", count = 1 } = JSON.parse(d.params.payload);
  if (kind === "click") {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: count, modifiers: mods || 0 });
  } else if (kind === "text") {
    await send("Input.insertText", { text });
  } else if (kind === "key") {
    const base = { key, code, modifiers: mods || 0, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    if (key.length === 1 && !(mods & 2) && !(mods & 4)) await send("Input.dispatchKeyEvent", { type: "char", text: key, ...base });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
  await send("Runtime.evaluate", { expression: `window.__cdpDone && window.__cdpDone(${seq})` });
}
const helpers = `(() => { if (window.__a) return; let seq = 0; const pend = new Map();
  window.__cdpDone = (s) => { const r = pend.get(s); if (r) { pend.delete(s); r(); } };
  const call = (o) => new Promise((r) => { seq += 1; pend.set(seq, r); window.__cdpInput(JSON.stringify({ seq, ...o })); });
  const NAMED = { Enter: [13, "Enter"], Escape: [27, "Escape"], Tab: [9, "Tab"], Backspace: [8, "Backspace"], Delete: [46, "Delete"],
    ArrowUp: [38, "ArrowUp"], ArrowDown: [40, "ArrowDown"], ArrowLeft: [37, "ArrowLeft"], ArrowRight: [39, "ArrowRight"],
    Home: [36, "Home"], End: [35, "End"], PageUp: [33, "PageUp"], PageDown: [34, "PageDown"] };
  for (let i = 1; i <= 12; i++) NAMED["F" + i] = [111 + i, "F" + i];
  // US layout punctuation: [vk, code, shifted key]
  const PUNCT = { "\`": [0xC0, "Backquote", "~"], "-": [0xBD, "Minus", "_"], "=": [0xBB, "Equal", "+"], "[": [0xDB, "BracketLeft", "{"],
    "]": [0xDD, "BracketRight", "}"], "\\\\": [0xDC, "Backslash", "|"], ";": [0xBA, "Semicolon", ":"], "'": [0xDE, "Quote", "\\""],
    ",": [0xBC, "Comma", "<"], ".": [0xBE, "Period", ">"], "/": [0xBF, "Slash", "?"] };
  const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
  window.__a = {
    q: (s) => document.querySelector(s),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    click: (t, o = {}) => { const el = typeof t === "string" ? document.querySelector(t) : t; if (!el) throw new Error("no element " + t);
      const b = el.getBoundingClientRect(); return call({ kind: "click", x: b.left + (o.dx ?? b.width / 2), y: b.top + (o.dy ?? b.height / 2), button: o.button, count: o.count, mods: (o.mods || []).reduce((a, m) => a | MOD[m], 0) }); },
    clickXY: (x, y, o = {}) => call({ kind: "click", x, y, button: o.button, count: o.count }),
    text: (text) => call({ kind: "text", text }),
    key: (key, mods = []) => {
      const m = mods.reduce((a, k) => a | MOD[k], 0), shift = mods.includes("shift");
      if (NAMED[key]) return call({ kind: "key", key: NAMED[key][1], code: NAMED[key][1], vk: NAMED[key][0], mods: m });
      if (/^[a-z]$/i.test(key)) { const up = key.toUpperCase(); return call({ kind: "key", key: shift ? up : key.toLowerCase(), code: "Key" + up, vk: up.charCodeAt(0), mods: m }); }
      if (/^[0-9]$/.test(key)) return call({ kind: "key", key, code: "Digit" + key, vk: key.charCodeAt(0), mods: m });
      if (PUNCT[key]) { const [vk, code, sh] = PUNCT[key]; return call({ kind: "key", key: shift ? sh : key, code, vk, mods: m }); }
      throw new Error("__a.key: unsupported key " + JSON.stringify(key));
    },
    toastsOn: () => { window.__seen = []; if (!window.__obs) { window.__obs = new MutationObserver((ms) => { for (const mu of ms) for (const n of mu.addedNodes) { if (n.nodeType !== 1) continue; const t = (n.innerText || "").trim(); if (t && t.length < 300) window.__seen.push(new Date().toISOString().slice(11, 23) + " " + t.replace(/\\n/g, " / ")); } }); window.__obs.observe(document.body, { childList: true, subtree: true }); } return "collecting"; },
    toasts: () => { const s = window.__seen || []; window.__seen = []; return s; },
    cspProbe: (url) => new Promise((resolve) => { const v = []; const h = (e) => v.push({ directive: e.violatedDirective, blocked: e.blockedURI });
      document.addEventListener("securitypolicyviolation", h); const img = new Image(); let done = false;
      const fin = (loaded) => { if (done) return; done = true; document.removeEventListener("securitypolicyviolation", h); resolve({ loaded, width: img.naturalWidth, violations: v }); };
      img.onload = () => fin(true); img.onerror = () => fin(false); img.src = url + (url.includes("?") ? "&" : "?") + "probe=" + Date.now(); setTimeout(() => fin(false), 4000); }),
  }; })()`;
await send("Runtime.evaluate", { expression: helpers });
// Identity check on the connection that will act: the page must still be the labelled window.
if (label) { const now = await labelOf(send); if (now !== label) fail(5, "WINDOW_MISMATCH", { label, now }); }
let code = 0;
// A top-level CDP `error` is a failed call, never an `undefined` answer (audit b163 H1).
const cdpError = (r) => { if (r.error || !r.result) fail(1, "CDP_ERROR", { code: r.error?.code ?? null, message: r.error?.message ?? "no result" }); };
if (mode === "bind" || mode === "unbind") {
  if (!label) fail(2, "IDENTITY_LABEL_REQUIRED");
  let request;
  try { request = JSON.parse(Buffer.from(arg ?? "", "base64").toString("utf8")); }
  catch { fail(2, "IDENTITY_ARGUMENT_INVALID"); }
  if (!request || typeof request.nonce !== "string" || !/^[a-f0-9]{32}$/.test(request.nonce) ||
      (mode === "bind" && (!validRect(request.rect) || typeof request.pageId !== "string" || !request.pageId)))
    fail(2, "IDENTITY_ARGUMENT_INVALID");
  if (mode === "bind" && page.id !== request.pageId) fail(1, "IDENTITY_PAGE_REPLACED");
  const suffix = ` [mdpro-b7:${request.nonce}]`;
  const expression = mode === "bind" ? `(async () => {
    const i = window.__TAURI_INTERNALS__, label = i?.metadata?.currentWindow?.label;
    if (label !== ${JSON.stringify(label)}) throw new Error("IDENTITY_LABEL_CHANGED");
    const [p, s, title] = await Promise.all([
      i.invoke("plugin:window|outer_position", { label }), i.invoke("plugin:window|outer_size", { label }),
      i.invoke("plugin:window|title", { label })]);
    const rect = [p.x, p.y, p.x + s.width, p.y + s.height];
    if (JSON.stringify(rect) !== ${JSON.stringify(JSON.stringify(request.rect))} || title.includes("[mdpro-b7:"))
      throw new Error("IDENTITY_STALE_BEFORE_BIND");
    const challenge = title + ${JSON.stringify(suffix)};
    await i.invoke("plugin:window|set_title", { label, value: challenge });
    if (await i.invoke("plugin:window|title", { label }) !== challenge) throw new Error("IDENTITY_BIND_NOT_VISIBLE");
    return { label, rect, challenge };
  })()` : `(async () => {
    const i = window.__TAURI_INTERNALS__, label = i?.metadata?.currentWindow?.label;
    if (label !== ${JSON.stringify(label)}) throw new Error("IDENTITY_LABEL_CHANGED");
    const title = await i.invoke("plugin:window|title", { label }), suffix = ${JSON.stringify(suffix)};
    if (!title.endsWith(suffix)) throw new Error("IDENTITY_UNBIND_MARKER_MISSING");
    const original = title.slice(0, -suffix.length);
    await i.invoke("plugin:window|set_title", { label, value: original });
    if (await i.invoke("plugin:window|title", { label }) !== original) throw new Error("IDENTITY_UNBIND_NOT_VISIBLE");
    return { label, restored: true };
  })()`;
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  cdpError(r);
  if (r.result?.exceptionDetails) fail(1, "IDENTITY_TITLE_FAILED", { detail: r.result.exceptionDetails.text });
  const value = r.result?.result?.value;
  if (mode === "bind" && (!value || value.label !== label || !sameRect(value.rect, request.rect) ||
      typeof value.challenge !== "string" || !value.challenge.endsWith(suffix))) fail(1, "IDENTITY_BIND_INVALID");
  if (mode === "unbind" && (!value || value.label !== label || value.restored !== true)) fail(1, "IDENTITY_UNBIND_INVALID");
  say(value);
} else if (mode === "eval" || mode === "eval64" || mode === "evalfile") {
  const expr = mode === "eval64" ? Buffer.from(arg, "base64").toString("utf8") : mode === "evalfile" ? fs.readFileSync(arg, "utf8") : arg;
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${/\breturn\b/.test(expr) ? expr : "return (" + expr + ")"} })()`, awaitPromise: true, returnByValue: true });
  cdpError(r);
  const v = r.result?.exceptionDetails ? { exception: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text } : r.result?.result?.value;
  say(v);
  if (r.result?.exceptionDetails) code = 1; // a thrown eval fails its caller (cdp.sh eval … && next)
} else if (mode === "shot") {
  const r = await send("Page.captureScreenshot", { format: "png" });
  cdpError(r);
  if (typeof r.result.data !== "string") fail(1, "CDP_ERROR", { code: null, message: "no screenshot data" });
  fs.writeFileSync(arg, Buffer.from(r.result.data, "base64"));
  console.log("saved", arg);
} else {
  console.error("usage: node cdp.mjs [--window <label>] eval|eval64|evalfile|shot <arg>"); throw new Stop(2);
}
return code;
}
// A lost connection is 3 (the eval may have run); an unexpected error (a bug) prints and fails with 1.
main().then(end, (e) => {
  if (e instanceof ConnLost) { say({ error: "CDP_CONNECTION_LOST" }); return end(3); }
  if (!(e instanceof Stop) && !ending) console.error(e?.stack ?? String(e));
  end(e instanceof Stop ? e.code : 1);
});
// Belt and braces: the loop drained with no exit code set, because main() was still pending or
// end() was still waiting. That is an outcome nobody decided, never a success (audit b174 M1).
process.on("beforeExit", () => {
  if (process.exitCode !== undefined) return;
  if (!ending) console.log(JSON.stringify({ error: "CDP_CONNECTION_LOST" }));
  process.exitCode = 3;
});
