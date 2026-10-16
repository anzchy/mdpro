// Purpose: minimal Chrome DevTools Protocol client for the mdpro WebView2 page
// (127.0.0.1:9222; mdpro must be started by launch.cmd). Testing only.
// Usage:
//   node cdp.mjs eval "<js>"        evaluate in the page (awaits promises), print JSON
//   node cdp.mjs eval64 <base64>    same, expression base64-encoded (no quoting issues; ssh line ~8 KB)
//   node cdp.mjs evalfile <path>    same, expression read from a UTF-8 file (no size limit)
//   node cdp.mjs shot <out.png>     capture the page viewport
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
// Once a socket is open, every exit goes through end(): it closes each socket and waits for the
// close (at most 1 s) before process.exit. Exiting while they were still closing aborted Node 24
// on Windows in libuv (UV_HANDLE_CLOSING, 0xC0000409) after the answer was printed (D248).
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
const closed = (ws) => new Promise((done) => {
  if (ws.readyState === WebSocket.CLOSED) return done();
  ws.addEventListener("close", () => done(), { once: true });
  setTimeout(done, CLOSE_WAIT_MS).unref?.();
  ws.close();
});
// Runs once: a later end() (the timeout firing mid-shutdown) joins the first. Once it has started,
// connect() opens nothing more, so no socket escapes the close (audit b171).
let ending = null;
const end = (code) => (ending ??= (async () => { await Promise.all([...sockets].map(closed)); process.exit(code); })());
// Never resolves: the caller stops here while end() closes the sockets and exits.
const stop = (code) => { end(code); return new Promise(() => {}); };
setTimeout(() => { console.log(JSON.stringify("CDP_TIMEOUT")); end(3); }, Number(process.env.MDPRO_CDP_TIMEOUT_MS) || 25000).unref?.();
const PORT = process.env.MDPRO_CDP_PORT || "9222";
const PREFIX = process.env.MDPRO_CDP_URL_PREFIX || "http://tauri.localhost";
let list;
try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); }
catch { console.log(JSON.stringify(`CDP_PORT_CLOSED: nothing on 127.0.0.1:${PORT}; start mdpro with scripts/mac/mdpro.sh debug`)); process.exit(4); }
const pages = list.filter((t) => t.type === "page" && t.url.startsWith(PREFIX));
if (!pages.length) { console.error(`no page starting with ${PREFIX} on port ${PORT}`); process.exit(2); }
const connect = (url) => new Promise((open) => {
  if (ending) return;
  const ws = new WebSocket(url);
  sockets.add(ws);
  ws.addEventListener("close", () => sockets.delete(ws));
  let id = 0; const waiting = new Map();
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } });
  const send = (method, params = {}) => new Promise((res) => { id += 1; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  ws.onopen = () => open({ ws, send });
});
// Tauri 2 puts the window's label in its injected metadata (to be confirmed on WebView2 in demo W6).
const LABEL_PROBE = "window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null";
const labelOf = async (send) => (await send("Runtime.evaluate", { expression: LABEL_PROBE, returnByValue: true })).result?.result?.value ?? null;
const fail = (code, error, extra) => { console.log(JSON.stringify({ error, ...extra }, null, 1)); return stop(code); };
let page = pages[0];
if (label || pages.length > 1) {
  const candidates = [];
  for (const p of pages) { const c = await connect(p.webSocketDebuggerUrl); candidates.push({ id: p.id, label: await labelOf(c.send), url: p.url }); await closed(c.ws); }
  if (!label) await fail(6, "WINDOW_AMBIGUOUS", { hint: "several mdpro windows: pass --window <label>", candidates });
  const hits = candidates.filter((c) => c.label === label);
  if (hits.length !== 1) await fail(hits.length ? 6 : 5, hits.length ? "WINDOW_AMBIGUOUS" : "WINDOW_NOT_FOUND", { label, candidates });
  page = pages.find((p) => p.id === hits[0].id);
}
const { ws, send } = await connect(page.webSocketDebuggerUrl);
// Trusted input goes through CDP Input.* (isTrusted=true), driven from Node via a binding.
await send("Runtime.addBinding", { name: "__cdpInput" });
ws.addEventListener("message", async (m) => {
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
});
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
if (label) { const now = await labelOf(send); if (now !== label) await fail(5, "WINDOW_MISMATCH", { label, now }); }
let code = 0;
// A top-level CDP `error` is a failed call, never an `undefined` answer (audit b163 H1).
const cdpError = async (r) => { if (r.error || !r.result) await fail(1, "CDP_ERROR", { code: r.error?.code ?? null, message: r.error?.message ?? "no result" }); };
if (mode === "eval" || mode === "eval64" || mode === "evalfile") {
  const expr = mode === "eval64" ? Buffer.from(arg, "base64").toString("utf8") : mode === "evalfile" ? fs.readFileSync(arg, "utf8") : arg;
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${/\breturn\b/.test(expr) ? expr : "return (" + expr + ")"} })()`, awaitPromise: true, returnByValue: true });
  await cdpError(r);
  const v = r.result?.exceptionDetails ? { exception: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text } : r.result?.result?.value;
  console.log(JSON.stringify(v, null, 1));
  if (r.result?.exceptionDetails) code = 1; // a thrown eval fails its caller (cdp.sh eval … && next)
} else if (mode === "shot") {
  const r = await send("Page.captureScreenshot", { format: "png" });
  await cdpError(r);
  if (typeof r.result.data !== "string") await fail(1, "CDP_ERROR", { code: null, message: "no screenshot data" });
  fs.writeFileSync(arg, Buffer.from(r.result.data, "base64"));
  console.log("saved", arg);
} else {
  console.error("usage: node cdp.mjs [--window <label>] eval|eval64|evalfile|shot <arg>"); await stop(2);
}
await end(code);
