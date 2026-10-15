const D = devicePixelRatio, OY = 24.5;
window.__sc = {
  mode() { return document.querySelector(".cm-editor") ? "S" : (document.querySelector(".ProseMirror") ? "W" : "?"); },
  root() { return document.querySelector(".cm-content") || document.querySelector(".ProseMirror"); },
  find(t) {
    const r = this.root(); if (!r) return null;
    const els = r.querySelectorAll(".cm-line, p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, td, th");
    let best = null;
    for (const e of els) if (e.textContent.includes(t)) { if (!best || e.textContent.length < best.textContent.length) best = e; }
    return best;
  },
  textNodeAt(el, t) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) { const i = n.data.indexOf(t); if (i >= 0) return [n, i]; }
    return null;
  },
  pt(t, which) {
    const el = this.find(t); if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const hit = this.textNodeAt(el, t); if (!hit) return null;
    const r = document.createRange(); const [n, i] = hit;
    const at = which === "start" ? i : i + t.length;
    r.setStart(n, at); r.setEnd(n, at);
    const b = r.getBoundingClientRect();
    return { x: Math.round((b.left + 1) * D), y: Math.round((b.top + b.height / 2 + OY) * D) };
  },
  select(t) {
    const el = this.find(t); const hit = el && this.textNodeAt(el, t); if (!hit) return false;
    const [n, i] = hit; const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new Event("selectionchange")); return s.toString();
  },
  caret(t, which) {
    const el = this.find(t); const hit = el && this.textNodeAt(el, t); if (!hit) return false;
    const [n, i] = hit; const at = which === "start" ? i : i + t.length;
    const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true;
  },
  sel() { return getSelection().toString(); },
  line(t) { const e = this.find(t); return e ? e.tagName + ":" + e.textContent.slice(0, 60) : null; },
};

window.__sc.st = function () { return { mode: this.mode(), sel: getSelection().toString().slice(0, 40), tabs: document.querySelectorAll(".bottom-tabs [role=tab], .tab-item, .bottom-tab").length }; };

window.__sc.ptSel = function (sel, text) {
  let els = [...document.querySelectorAll(sel)];
  if (text) els = els.filter(e => e.textContent.trim() === text);
  const e = els[0]; if (!e) return null;
  const b = e.getBoundingClientRect();
  return { x: Math.round((b.left + b.width / 2) * D), y: Math.round((b.top + b.height / 2 + OY) * D) };
};
window.__sc.d240 = function () {
  const link = document.querySelector(".link-insert-input");
  const mcp = document.querySelector(".mcp-confirm-dialog");
  const ae = document.activeElement;
  const pm = document.querySelector(".ProseMirror");
  return { linkOpen: !!link, linkValue: link ? link.value : null, mcpOpen: !!mcp,
    mcpText: mcp ? mcp.innerText.replace(/\n+/g, " | ").slice(0, 200) : null,
    active: ae ? (ae.tagName + "." + (ae.className || "") + ":" + (ae.textContent || "").trim().slice(0, 20)) : null,
    modals: document.querySelectorAll('[aria-modal="true"]').length,
    links: pm ? [...pm.querySelectorAll("a")].map(a => a.getAttribute("href") + "=" + a.textContent) : null,
    doc: pm ? pm.innerText.replace(/\n+/g, " | ").slice(0, 200) : null };
};
return { mode: __sc.mode(), p: __sc.pt("CTRL control line"), iw: innerWidth };
