// Purpose: minimal Chrome DevTools Protocol client for the mdpro WebView2 page
// (127.0.0.1:9222; mdpro must be started by launch.cmd). Testing only.
// Usage:
//   node cdp.mjs eval "<js>"        evaluate in the page (awaits promises), print JSON
//   node cdp.mjs eval64 <base64>    same, expression base64-encoded (no quoting issues; ssh line ~8 KB)
//   node cdp.mjs evalfile <path>    same, expression read from a UTF-8 file (no size limit)
//   node cdp.mjs shot <out.png>     capture the page viewport
// Exit: 0 ok; 1 the expression threw (the JSON {exception} is still printed); 2 usage / no page;
// 3 CDP_TIMEOUT (the eval may have run); 4 the port is closed.
// Env: MDPRO_CDP_PORT (default 9222), MDPRO_CDP_URL_PREFIX (default http://tauri.localhost).
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
const [mode, arg] = process.argv.slice(2);
setTimeout(() => { console.log(JSON.stringify("CDP_TIMEOUT")); process.exit(3); }, 25000).unref?.();
const PORT = process.env.MDPRO_CDP_PORT || "9222";
const PREFIX = process.env.MDPRO_CDP_URL_PREFIX || "http://tauri.localhost";
let list;
try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); }
catch { console.log(JSON.stringify(`CDP_PORT_CLOSED: nothing on 127.0.0.1:${PORT}; start mdpro with scripts/mac/mdpro.sh debug`)); process.exit(4); }
const page = list.find((t) => t.type === "page" && t.url.startsWith(PREFIX));
if (!page) { console.error(`no page starting with ${PREFIX} on port ${PORT}`); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { id += 1; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((r) => (ws.onopen = r));
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
let code = 0;
if (mode === "eval" || mode === "eval64" || mode === "evalfile") {
  const expr = mode === "eval64" ? Buffer.from(arg, "base64").toString("utf8") : mode === "evalfile" ? fs.readFileSync(arg, "utf8") : arg;
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${/\breturn\b/.test(expr) ? expr : "return (" + expr + ")"} })()`, awaitPromise: true, returnByValue: true });
  const v = r.result?.exceptionDetails ? { exception: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text } : r.result?.result?.value;
  console.log(JSON.stringify(v, null, 1));
  if (r.result?.exceptionDetails) code = 1; // a thrown eval fails its caller (cdp.sh eval … && next)
} else if (mode === "shot") {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(arg, Buffer.from(r.result.data, "base64"));
  console.log("saved", arg);
} else {
  console.error("usage: node cdp.mjs eval|eval64|evalfile|shot <arg>"); process.exit(2);
}
ws.close(); process.exit(code);
