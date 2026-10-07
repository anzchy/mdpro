/*
 * scripts/redesign/snapshot.js — computed-style snapshot for the UI redesign (plan P, E5)
 *
 * Purpose: prove that a zero-change stage (Stages 1-2) changed no rendered style.
 * For one Appendix B surface and one theme it drives a fresh `pnpm dev` page into
 * that surface, forces the states the surface's selectors style, asserts that
 * every state applied, and returns sorted JSON holding getComputedStyle (A5
 * property families + box model + typography) and the box size for a fixed
 * selector list, including ::before / ::after. Before/after files are compared
 * with plain `/usr/bin/diff -r`; an empty diff passes. (Call it by full path: a
 * shell `diff` wrapper can report "identical" for files that differ.)
 *
 * How to run (through gstack /browse, against `pnpm dev`; $B is the browse binary):
 *
 *   cd <repo>                                   # eval paths must sit under cwd
 *   $B viewport 1200x800 --scale 1              # or the surface's viewport, see SURFACES
 *   $B goto http://localhost:<port>/            # a FRESH load for every surface
 *   $B wait --networkidle
 *   $B js "window.__MDPRO_SNAP__={surface:'main-source',theme:'dark'};1"
 *   $B eval scripts/redesign/snapshot.js > <dir>/main-source-dark.json
 *
 * `{list:true}` instead of a surface returns the surface catalogue (name,
 * viewport). The evidence layout and the stage-0 run record live in
 * ~/.mdpro-redesign/<stage>/index.md (A4, outside the repo).
 *
 * Size: this file is over rule 50's 300-line limit on purpose. /browse `eval`
 * runs exactly one file, so the payload has to be self-contained; splitting it
 * would need a concatenation build step (user decision, 2026-10-03).
 *
 * Failure contract: the output always carries `ok`. `ok:false` plus a non-empty
 * `errors` array means a selector the surface expects matched nothing, a forced
 * state did not apply, the viewport is not the surface's viewport, the page
 * was not fresh, or the page did not have focus. Without focus WebKit does not
 * match :focus, so focus rings silently vanish; the script waits up to
 * FOCUS_TIMEOUT_MS for focus (a harness that pastes into Web Inspector raises
 * the app window afterwards) and flags any phase captured without it. Never
 * treat an `ok:false` file as a baseline.
 *
 * Constraint: /browse wraps any eval file containing the a-w-a-i-t keyword in an
 * async IIFE that discards the file's completion value, so this file uses
 * generators (`yield`) driven by `co()` instead. Do not introduce that keyword.
 *
 * Element identity is selector + index (first ITEM_LIMIT matches; the full
 * match count is recorded too, except for VIRTUALIZED selectors, whose count is
 * how far the editor's virtual viewport had rendered and flips between runs in
 * WKWebView). Hover cannot be forced from script; each surface lists its
 * hover-only styling under `manual`.
 */
(function () {
  "use strict";

  var SCHEMA = 2; // 2: no `count` for VIRTUALIZED selectors
  var ITEM_LIMIT = 8;
  var SETTLE_MS = 120;
  var VIRTUALIZED = { ".cm-line": true };
  var WAIT_TIMEOUT_MS = 4000;
  var FOCUS_TIMEOUT_MS = 8000;

  // A5 families (colour, font-family, font-size, radius, motion, z-index,
  // shadow, icon size via box) plus box model and typography, so a padding or
  // weight drift in Stages 1-2 also shows up.
  var PROPS = [
    "animation-duration", "animation-name", "animation-timing-function",
    "background-color", "background-image",
    "border-bottom-color", "border-bottom-left-radius", "border-bottom-right-radius",
    "border-bottom-style", "border-bottom-width",
    "border-left-color", "border-left-style", "border-left-width",
    "border-right-color", "border-right-style", "border-right-width",
    "border-top-color", "border-top-left-radius", "border-top-right-radius",
    "border-top-style", "border-top-width",
    "box-shadow", "caret-color", "color", "display", "fill",
    "font-family", "font-size", "font-style", "font-weight", "gap",
    "height", "letter-spacing", "line-height",
    "margin-bottom", "margin-left", "margin-right", "margin-top",
    "opacity",
    "outline-color", "outline-offset", "outline-style", "outline-width",
    "padding-bottom", "padding-left", "padding-right", "padding-top",
    "stroke", "text-decoration-color", "text-decoration-line", "text-transform",
    "transition-duration", "transition-property", "transition-timing-function",
    "width", "z-index"
  ];
  var PSEUDO_PROPS = PROPS.concat(["content"]);

  var TINY_IMAGE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAiIGhlaWdodD0iOTAiPjxyZWN0IHdpZHRoPSIxNjAiIGhlaWdodD0iOTAiIGZpbGw9IiM4OGEiLz48L3N2Zz4=";

  // The WI-0.4 fixture, embedded so every run sees byte-identical content.
  var FIXTURE_LINES = [
    "# Surfaces fixture",
    "",
    "Intro with **bold**, *italic*, `inline code`, ~~strike~~, ==highlight==, a [link](https://example.com), an autolink <https://example.org>, and inline <kbd>HTML</kbd>.",
    "",
    "## Section A",
    "",
    "### Child A1",
    "",
    "Text under A1.",
    "",
    "### Child A2",
    "",
    "Text under A2.",
    "",
    "#### Level four",
    "",
    "##### Level five",
    "",
    "###### Level six",
    "",
    "## Section B",
    "",
    "> A blockquote line.",
    "",
    "- bullet one",
    "- bullet two",
    "",
    "1. ordered one",
    "2. ordered two",
    "",
    "- [ ] task open",
    "- [x] task done",
    "",
    "```js",
    "const answer = 42;",
    "function hello(name) { return 'hi ' + name; }",
    "```",
    "",
    "| Col A | Col B |",
    "| --- | --- |",
    "| a1 | b1 |",
    "| a2 | b2 |",
    "",
    "![tiny](" + TINY_IMAGE + ")",
    "",
    "## Filler"
  ];
  for (var f = 1; f <= 40; f++) {
    FIXTURE_LINES.push("", "Filler paragraph " + f + " keeps the editor scrollable so the scrolled state can be forced.");
  }
  var FIXTURE = FIXTURE_LINES.join("\n") + "\n";

  // ---------------------------------------------------------------- helpers

  function co(genFn) {
    return new Promise(function (resolve, reject) {
      var it = genFn();
      function step(method, arg) {
        var r;
        try { r = it[method](arg); } catch (e) { reject(e); return; }
        if (r.done) { resolve(r.value); return; }
        Promise.resolve(r.value).then(
          function (v) { step("next", v); },
          function (e) { step("throw", e); }
        );
      }
      step("next");
    });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function waitFor(pred, desc, timeout) {
    var limit = timeout || WAIT_TIMEOUT_MS;
    var start = Date.now();
    return new Promise(function (resolve, reject) {
      (function poll() {
        var v = null;
        try { v = pred(); } catch (e) { v = null; }
        if (v) { resolve(v); return; }
        if (Date.now() - start > limit) { reject(new Error("timeout waiting for: " + desc)); return; }
        setTimeout(poll, 25);
      })();
    });
  }

  function finiteRunning() {
    return document.getAnimations().filter(function (a) {
      if (a.playState !== "running") return false;
      var t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      return !(t && t.iterations === Infinity);
    });
  }

  // Let React commit, then let every finite transition/animation finish.
  function settle() {
    return co(function* () {
      yield sleep(SETTLE_MS);
      yield waitFor(function () { return finiteRunning().length === 0; }, "finite animations to finish", 3000);
      yield new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
    });
  }

  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function must(sel, desc) {
    return waitFor(function () { return q(sel); }, desc || sel);
  }

  function byText(sel, text) {
    return qa(sel).filter(function (el) { return el.textContent.trim() === text; })[0] || null;
  }

  // Dispatch a keydown the app's window-level handlers (useKeyboardShortcuts,
  // ProseMirror keymaps, the shortcut recorder) understand.
  function key(spec, target) {
    var parts = spec.split("+");
    var k = parts.pop();
    var init = {
      key: k, bubbles: true, cancelable: true,
      metaKey: parts.indexOf("Meta") >= 0, ctrlKey: parts.indexOf("Control") >= 0,
      altKey: parts.indexOf("Alt") >= 0, shiftKey: parts.indexOf("Shift") >= 0
    };
    if (k.length === 1 && /[a-z]/i.test(k)) init.code = "Key" + k.toUpperCase();
    (target || document.body).dispatchEvent(new KeyboardEvent("keydown", init));
  }

  function click(el) {
    if (!el) throw new Error("click target missing");
    el.click();
  }

  function centre(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }

  // Right-click at the centre of `text` inside `root` (or at the element centre
  // when no text is given). The menus resolve the document position with
  // posAtCoords, so the point must sit on rendered text, not line padding.
  function contextMenu(root, text) {
    return co(function* () {
    root.scrollIntoView({ block: "center" });
    yield settle();
    var c = centre(root);
    if (text) {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      var n;
      while ((n = walker.nextNode())) {
        var i = n.nodeValue.indexOf(text);
        if (i >= 0) {
          var range = document.createRange();
          range.setStart(n, i);
          range.setEnd(n, i + text.length);
          var r = range.getBoundingClientRect();
          c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          break;
        }
      }
    }
    if (c.y < 0 || c.y > window.innerHeight) throw new Error("context-menu target is off screen at y=" + Math.round(c.y));
    var target = document.elementFromPoint(c.x, c.y) || root;
    target.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, button: 2
    }));
    });
  }

  function setInputValue(input, value) {
    var proto = Object.getPrototypeOf(input);
    var setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function openFixture(name) {
    return co(function* () {
      var before = qa(".bottom-tab").length;
      // dev-open-file: the hidden input after 1703dbb; .dev-toolbar: the a5767d5 baseline.
      var input = yield must("[data-testid=dev-open-file], .dev-toolbar input[type=file]", "dev file input");
      var dt = new DataTransfer();
      dt.items.add(new File([FIXTURE], name || "surfaces-fixture.md", { type: "text/markdown" }));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      yield waitFor(function () { return qa(".bottom-tab").length === before + 1; }, "fixture tab to open");
      yield settle();
    });
  }

  function modeLabel() {
    var el = q(".sidebar-mode-label");
    return el ? el.textContent.trim() : null;
  }

  function currentMode() {
    if (q("#source-container")) return "source";
    if (q("#milkdown-container")) return "wysiwyg";
    return null;
  }

  function setMode(mode) {
    return co(function* () {
      if (currentMode() !== mode) {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        key("Meta+/", document.body);
      }
      yield waitFor(function () { return currentMode() === mode; }, "view mode " + mode);
      if (mode === "source") yield must("#source-container .cm-content", "CodeMirror content");
      if (mode === "wysiwyg") yield must("#milkdown-container .ProseMirror", "ProseMirror root");
      yield settle();
    });
  }

  function cmView() {
    var el = q("#source-container .cm-content");
    // CodeMirror 6 hangs its tile/view object off the content DOM node
    // (`cmTile` in current releases, `cmView` in older ones).
    var tile = el ? (el.cmTile || el.cmView) : null;
    return tile && tile.view ? tile.view : null;
  }

  function cmLineContaining(text) {
    return qa("#source-container .cm-line").filter(function (l) { return l.textContent.indexOf(text) >= 0; })[0] || null;
  }

  // Put a DOM selection on `text` inside `root` (a contenteditable).
  function selectText(root, text) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = walker.nextNode())) {
      var i = n.nodeValue.indexOf(text);
      if (i >= 0) {
        var range = document.createRange();
        range.setStart(n, i);
        range.setEnd(n, i + text.length);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      }
    }
    return false;
  }

  function placeCaret(root, text, offset) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = walker.nextNode())) {
      var i = n.nodeValue.indexOf(text);
      if (i >= 0) {
        var range = document.createRange();
        range.setStart(n, i + (offset || 0));
        range.collapse(true);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      }
    }
    return false;
  }

  function typeInto(el, text) {
    el.focus();
    document.execCommand("insertText", false, text);
  }

  function openSettings(page) {
    return co(function* () {
      if (!q(".settings-dialog")) key("Meta+,", document.body);
      yield must(".settings-dialog", "Settings dialog");
      if (page) {
        var btn = yield waitFor(function () { return byText(".settings-category-btn", page) || qa(".settings-category-btn").filter(function (b) { return b.textContent.indexOf(page) >= 0; })[0]; }, "rail item " + page);
        click(btn);
        yield waitFor(function () { return btn.classList.contains("is-active"); }, "rail item " + page + " active");
      }
      yield settle();
    });
  }

  // ---------------------------------------------------------------- capture

  function round(n) { return Math.round(n * 100) / 100; }

  function pick(cs, props) {
    var o = {};
    for (var i = 0; i < props.length; i++) o[props[i]] = cs.getPropertyValue(props[i]);
    return o;
  }

  function pseudo(el, which) {
    var cs = getComputedStyle(el, which);
    var content = cs.getPropertyValue("content");
    if (!content || content === "none" || content === "normal") return null;
    return pick(cs, PSEUDO_PROPS);
  }

  function captureEl(el) {
    var r = el.getBoundingClientRect();
    var o = { box: { height: round(r.height), width: round(r.width) }, style: pick(getComputedStyle(el), PROPS) };
    var b = pseudo(el, "::before");
    var a = pseudo(el, "::after");
    if (b) o["::before"] = b;
    if (a) o["::after"] = a;
    return o;
  }

  function captureSelectors(list, errors, phase) {
    var out = {};
    list.forEach(function (sel) {
      var els = qa(sel);
      if (els.length === 0) errors.push("[" + phase + "] selector matched nothing: " + sel);
      var items = {};
      els.slice(0, ITEM_LIMIT).forEach(function (el, i) { items[String(i)] = captureEl(el); });
      out[sel] = VIRTUALIZED[sel] ? { items: items } : { count: els.length, items: items };
    });
    return out;
  }

  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      var o = {};
      Object.keys(v).sort().forEach(function (k) { o[k] = sortKeys(v[k]); });
      return o;
    }
    return v;
  }

  // ---------------------------------------------------------------- selectors

  var CHROME = [
    ".app-shell", ".main", ".workspace",
    ".dev-toolbar", ".dev-toolbar-label", ".dev-toolbar-button",
    ".bottom-tabs", ".bottom-tabs__add"
  ];
  var SIDEBAR = [".sidebar-header", ".sidebar-mode-label"];
  var TABS_OPEN = [".bottom-tab", ".bottom-tab--active", ".bottom-tab__name", ".bottom-tab__close"];
  var SOURCE = ["#source-container", ".cm-editor", ".cm-scroller", ".cm-content", ".cm-line"];
  var WYSIWYG = [".milkdown-editor", ".milkdown-editor .ProseMirror"];
  var MD_CONTENT = [
    ".milkdown-editor .ProseMirror h1", ".milkdown-editor .ProseMirror h2", ".milkdown-editor .ProseMirror h3",
    ".milkdown-editor .ProseMirror h4", ".milkdown-editor .ProseMirror h5", ".milkdown-editor .ProseMirror h6",
    ".milkdown-editor .ProseMirror p", ".milkdown-editor .ProseMirror strong", ".milkdown-editor .ProseMirror em",
    ".milkdown-editor .ProseMirror code", ".milkdown-editor .ProseMirror pre", ".milkdown-editor .ProseMirror mark",
    ".milkdown-editor .ProseMirror a", ".milkdown-editor .ProseMirror blockquote",
    ".milkdown-editor .ProseMirror ul", ".milkdown-editor .ProseMirror ol", ".milkdown-editor .ProseMirror li",
    ".milkdown-editor .ProseMirror table", ".milkdown-editor .ProseMirror th", ".milkdown-editor .ProseMirror td",
    ".milkdown-editor .ProseMirror img"
  ];
  var DIALOG = [".dialog-backdrop", ".dialog-card", ".dialog-title", ".dialog-actions", ".dialog-actions .toolbar-button"];
  var SETTINGS = [
    ".settings-dialog", ".settings-header", ".settings-title", ".settings-close", ".settings-content",
    ".settings-sidebar", ".settings-category-btn", ".settings-category-btn.is-active", ".settings-nav-icon",
    ".settings-main", ".settings-footer", ".settings-footer .toolbar-button"
  ];
  var SETTINGS_PAGE = [".settings-page-header", ".settings-page-title", ".settings-page-desc", ".settings-row", ".settings-row-label", ".settings-row-control"];

  function cat() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) out = out.concat(arguments[i]);
    return out;
  }

  // ---------------------------------------------------------------- phases

  function phase(name, kind, run, assert, capture, focusOnly) {
    return { name: name, kind: kind, run: run, assert: assert, capture: capture, focusOnly: !!focusOnly };
  }

  // A focus-visible phase: focus the first match with focusVisible, assert
  // :focus-visible, capture only that element, then blur.
  function focusPhase(sel) {
    return phase("focus-visible " + sel, "focus-visible", function () {
      return co(function* () {
        var el = yield must(sel, "focus target " + sel);
        el.focus({ focusVisible: true, preventScroll: true });
        yield settle();
      });
    }, function () {
      var el = q(sel);
      return !!el && document.activeElement === el && el.matches(":focus-visible");
    }, [sel], true);
  }

  function settingsSurface(page, extraBase, extraPhases, manual) {
    return {
      viewport: [1200, 800],
      setup: function () { return openSettings(page); },
      phases: [
        phase("base", "open modal", null, function () { return !!q(".settings-dialog") && q(".settings-category-btn.is-active").textContent.indexOf(page) >= 0; },
          cat(CHROME, SETTINGS, extraBase))
      ].concat(extraPhases || []),
      manual: (manual || []).concat([".settings-category-btn:hover", ".settings-close:hover", ".toolbar-button:hover"])
    };
  }

  // Record one unbound chord on the first two shortcut rows so they conflict
  // (an unbound chord, so the app's own shortcut handler does nothing with it).
  var CONFLICT_CHORD = "Control+Alt+Shift+j";
  function recordChord(btn) {
    return co(function* () {
      click(btn);
      yield waitFor(function () { return btn.classList.contains("is-editing"); }, "recording state");
      key(CONFLICT_CHORD, document.body);
      yield waitFor(function () { return !btn.classList.contains("is-editing"); }, "chord recorded");
    });
  }
  function conflictSurface(def) {
    var open = def.setup;
    def.setup = function () {
      return co(function* () {
        yield open();
        var vals = qa(".shortcut-value");
        yield recordChord(vals[0]);
        yield recordChord(qa(".shortcut-value")[1]);
        yield waitFor(function () { return q(".shortcut-row.has-conflict"); }, "conflict rows");
        yield settle();
      });
    };
    var base = def.phases[0].assert;
    def.phases[0].kind = "open modal + conflict + dirty";
    def.phases[0].assert = function () { return base() && qa(".shortcut-row.has-conflict").length === 2 && !!q(".settings-dirty-banner"); };
    return def;
  }

  // ---------------------------------------------------------------- surfaces

  var SURFACES = {
    "main-source": {
      viewport: [1200, 800],
      setup: function () { return co(function* () { yield openFixture(); yield setMode("source"); }); },
      phases: [phase("base", "document open", null, function () { return modeLabel() === "SOURCE" && qa(".bottom-tab").length === 1; },
        cat(CHROME, SIDEBAR, TABS_OPEN, SOURCE))],
      manual: [".dev-toolbar-button:hover", ".bottom-tab:hover", ".bottom-tab__close:hover"]
    },

    "source-syntax": {
      viewport: [1200, 800],
      setup: function () { return co(function* () { yield openFixture(); yield setMode("source"); }); },
      phases: [
        phase("scrolled", "scrolled container", function () {
          return co(function* () {
            var sc = q("#source-container .cm-scroller");
            sc.scrollTop = 200;
            yield settle();
          });
        }, function () { return q("#source-container .cm-scroller").scrollTop === 200; },
          cat(SOURCE, [".wysiwyg-marker"])),
        phase("caret in table cell", "active table cell", function () {
          return co(function* () {
            var view = cmView();
            var doc = view.state.doc.toString();
            var at = doc.indexOf("| a1 |") + 3;
            view.focus();
            view.dispatch({ selection: { anchor: at } });
            yield settle();
          });
        }, function () { return !!q(".cm-table-active-cell"); }, [".editor-shell .cm-table-active-cell", ".cm-table-active-cell"]),
        phase("text selection", "selection", function () {
          return co(function* () {
            var view = cmView();
            var doc = view.state.doc.toString();
            var at = doc.indexOf("Text under A1.");
            view.focus();
            view.dispatch({ selection: { anchor: at, head: at + 10 } });
            yield settle();
          });
        }, function () { return !!q(".cm-selectionBackground"); }, [".editor-shell .cm-selectionBackground"])
      ],
      manual: []
    },

    "main-wysiwyg": {
      viewport: [1200, 800],
      setup: function () { return co(function* () { yield openFixture(); yield setMode("wysiwyg"); }); },
      phases: [
        phase("base", "document open", null, function () { return modeLabel() === "WYSIWYG"; },
          cat(CHROME, SIDEBAR, TABS_OPEN, WYSIWYG, MD_CONTENT)),
        phase("caret in link", "inline expansion", function () {
          return co(function* () {
            var pm = q(".milkdown-editor .ProseMirror");
            pm.focus();
            placeCaret(pm, "link", 2);
            document.dispatchEvent(new Event("selectionchange"));
            yield settle();
          });
        }, function () { return !!q(".milkdown-editor .ProseMirror .milkdown-link-expanded"); },
          [".milkdown-editor .ProseMirror .milkdown-link-expanded"]),
        phase("caret in inline code", "inline expansion", function () {
          return co(function* () {
            var pm = q(".milkdown-editor .ProseMirror");
            pm.focus();
            placeCaret(pm, "inline code", 3);
            document.dispatchEvent(new Event("selectionchange"));
            yield settle();
          });
        }, function () { return !!q(".milkdown-editor .ProseMirror .milkdown-code-expanded"); },
          [".milkdown-editor .ProseMirror .milkdown-inline-expanded", ".milkdown-editor .ProseMirror .milkdown-code-expanded"])
      ],
      manual: [".milkdown-editor .ProseMirror .column-resize-handle (appears on pointer hover over a column border)"]
    },

    "sidebar-hidden": {
      viewport: [1200, 800],
      setup: function () {
        return co(function* () {
          yield openFixture(); yield setMode("source");
          key("Meta+Shift+L", document.body);
          yield must(".main-traffic-area", "sidebar hidden");
          yield settle();
        });
      },
      phases: [phase("base", "sidebar hidden", null, function () { return !!q(".app-shell.no-sidebar") && !!q(".main-traffic-area"); },
        cat(CHROME, TABS_OPEN, SOURCE, [".app-shell.no-sidebar", ".main-traffic-area", ".main-traffic-area .sidebar-mode-label"]))],
      manual: []
    },

    "bottom-tabs": {
      viewport: [1200, 800],
      setup: function () {
        return co(function* () {
          yield openFixture("first.md"); yield setMode("source");
          yield openFixture("second.md");
          var line = yield must("#source-container .cm-content", "CodeMirror content");
          var view = cmView();
          view.focus();
          view.dispatch({ selection: { anchor: 0 } });
          typeInto(line, "x");
          yield waitFor(function () { return q(".bottom-tab__modified"); }, "modified dot");
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
          yield settle();
        });
      },
      phases: [
        phase("base", "dirty tab", null, function () { return qa(".bottom-tab").length === 2 && qa(".bottom-tab__modified").length === 1; },
          cat(CHROME, TABS_OPEN, [".bottom-tabs__divider", ".bottom-tabs__scroll", ".bottom-tab__modified"])),
        focusPhase(".bottom-tabs__add"),
        focusPhase(".bottom-tab"),
        focusPhase(".bottom-tab__close")
      ],
      manual: [".bottom-tab:hover", ".bottom-tab__close:hover", ".bottom-tabs__add:hover"]
    },

    "toc": {
      viewport: [1200, 800],
      setup: function () { return co(function* () { yield openFixture(); yield setMode("source"); }); },
      phases: [
        phase("active entry", "active row", function () {
          return co(function* () {
            var link = yield waitFor(function () { return qa(".toc-entry__link").filter(function (a) { return a.textContent.trim() === "Section B"; })[0]; }, "TOC entry Section B");
            click(link);
            yield waitFor(function () { return q(".toc-entry__content--active"); }, "active TOC row");
            if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
            yield settle();
          });
        }, function () { var a = q(".toc-entry__content--active"); return !!a && a.textContent.indexOf("Section B") >= 0; },
          cat(CHROME, SIDEBAR, [".toc-sidebar", ".toc-entry", ".toc-entry__content", ".toc-entry__content--active", ".toc-entry__collapse", ".toc-entry__collapse-icon", ".toc-entry__spacer", ".toc-entry__link", ".toc-entry__text", ".toc-entry__children"])),
        focusPhase(".toc-entry__link"),
        focusPhase(".toc-entry__collapse"),
        phase("collapsed parent", "collapsed", function () {
          return co(function* () {
            var btns = qa(".toc-entry__collapse");
            var target = btns.filter(function (b) { return b.parentElement.textContent.indexOf("Section A") >= 0 && b.getAttribute("aria-expanded") === "true"; }).pop();
            click(target);
            yield waitFor(function () { return q(".toc-entry__collapse--collapsed"); }, "collapsed caret");
            if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
            yield settle();
          });
        }, function () { return !!q(".toc-entry__collapse--collapsed"); },
          [".toc-entry__collapse--collapsed", ".toc-entry__collapse--collapsed .toc-entry__collapse-icon", ".toc-entry"])
      ],
      manual: [".toc-entry__content:hover", ".toc-entry__collapse:hover"]
    },

    "toc-empty": {
      viewport: [1200, 800],
      setup: function () {
        return co(function* () {
          key("Meta+n", document.body);
          yield waitFor(function () { return qa(".bottom-tab").length === 1; }, "new document tab");
          yield settle();
        });
      },
      phases: [phase("base", "empty TOC", null, function () { return !!q(".toc-sidebar__empty-message") && qa(".bottom-tab").length === 1; },
        cat(CHROME, SIDEBAR, TABS_OPEN, [".toc-sidebar", ".toc-sidebar--empty", ".toc-sidebar__empty-message"]))],
      manual: []
    },

    "empty-source": {
      viewport: [1200, 800],
      setup: function () { return setMode("source"); },
      phases: [phase("base", "no tabs", null, function () { return qa(".bottom-tab").length === 0 && modeLabel() === "SOURCE"; },
        cat(CHROME, SIDEBAR, SOURCE, [".toc-sidebar__empty-message"]))],
      manual: []
    },

    "empty-wysiwyg": {
      viewport: [1200, 800],
      setup: function () { return setMode("wysiwyg"); },
      phases: [phase("base", "no tabs", null, function () { return qa(".bottom-tab").length === 0 && modeLabel() === "WYSIWYG"; },
        cat(CHROME, SIDEBAR, WYSIWYG, [".toc-sidebar__empty-message"]))],
      manual: []
    },

    "link-modal": {
      viewport: [1200, 800],
      setup: function () {
        return co(function* () {
          yield openFixture(); yield setMode("wysiwyg");
          var pm = q(".milkdown-editor .ProseMirror");
          pm.focus();
          selectText(pm, "Text under A1");
          document.dispatchEvent(new Event("selectionchange"));
          yield sleep(60);
          key("Meta+k", pm);
          yield must(".link-insert-modal", "link modal");
          yield settle();
        });
      },
      phases: [
        phase("base", "open modal + disabled Insert", null, function () {
          var b = q(".link-insert-modal .toolbar-button--primary");
          return !!q(".link-insert-modal") && !!b && b.disabled;
        }, cat(CHROME, DIALOG, [".link-insert-modal", ".link-insert-label", ".link-insert-input", ".toolbar-button--primary", ".toolbar-button--primary:disabled"])),
        focusPhase(".link-insert-input"),
        focusPhase(".link-insert-modal .dialog-actions .toolbar-button"),
        phase("url entered", "enabled Insert", function () {
          return co(function* () {
            setInputValue(q(".link-insert-input"), "https://example.com");
            yield settle();
          });
        }, function () { var b = q(".link-insert-modal .toolbar-button--primary"); return !!b && !b.disabled; },
          [".toolbar-button--primary", ".link-insert-input"])
      ],
      manual: [".toolbar-button--primary:hover:not(:disabled)", ".toolbar-button:hover"]
    },

    "table-insert-modal": {
      viewport: [1200, 800],
      setup: function () {
        return co(function* () {
          yield openFixture(); yield setMode("wysiwyg");
          var pm = q(".milkdown-editor .ProseMirror");
          pm.focus();
          placeCaret(pm, "Text under A2", 4);
          document.dispatchEvent(new Event("selectionchange"));
          yield sleep(60);
          key("Meta+Alt+t", document.body);
          yield must(".table-insert-modal", "table insert modal");
          yield settle();
        });
      },
      phases: [
        phase("base", "open modal", null, function () { return !!q(".table-insert-modal"); },
          cat(CHROME, DIALOG, [".table-insert-modal", ".dialog-title-hint", ".grid-picker-cell", ".table-insert-count", ".table-insert-divider", ".table-insert-numeric", ".table-insert-label", ".table-insert-input", ".toolbar-button--primary"])),
        focusPhase(".table-insert-input"),
        focusPhase(".table-insert-modal .toolbar-button--primary")
      ],
      manual: [".grid-picker-cell:hover", ".toolbar-button:hover", ".table-insert-error (no on-demand trigger, Appendix B)"]
    },

    "table-ctx-wysiwyg": {
      viewport: [1200, 800],
      setup: function () {
        return co(function* () {
          yield openFixture(); yield setMode("wysiwyg");
          var cell = yield waitFor(function () { return qa(".milkdown-editor .ProseMirror td").filter(function (td) { return td.textContent.trim() === "a1"; })[0]; }, "table cell a1");
          yield contextMenu(cell, "a1");
          yield must(".table-context-menu", "table context menu");
          yield settle();
        });
      },
      phases: [phase("base", "open menu", null, function () { return !!q(".table-context-menu"); },
        cat(CHROME, [".table-context-menu", ".table-context-menu-group-label", ".table-context-menu-item", ".table-context-menu-item-hint"]))],
      manual: [".table-context-menu-item:hover"]
    },

    "table-ctx-source": {
      viewport: [1200, 800],
      setup: function () {
        return co(function* () {
          yield openFixture(); yield setMode("source");
          var line = yield waitFor(function () { return cmLineContaining("| a1 |"); }, "source table line");
          yield contextMenu(line, "a1");
          yield must(".table-context-menu", "source table context menu");
          yield settle();
        });
      },
      phases: [phase("base", "open menu", null, function () { return !!q(".table-context-menu"); },
        cat(CHROME, SOURCE, [".table-context-menu", ".table-context-menu-group-label", ".table-context-menu-item", ".table-context-menu-item-hint"]))],
      manual: [".table-context-menu-item:hover"]
    },

    "image-ctx-custom": {
      viewport: [1200, 800],
      setup: function () {
        return co(function* () {
          yield openFixture(); yield setMode("wysiwyg");
          var img = yield must(".milkdown-editor .ProseMirror img[src^='data:image/svg']", "fixture image");
          // Apply the 50% preset first so the reopened menu has an active preset.
          yield contextMenu(img);
          yield must(".image-context-menu", "image context menu");
          var preset = yield waitFor(function () { return qa(".image-context-menu-button").filter(function (b) { return b.textContent.trim() === "50%"; })[0]; }, "50% preset");
          click(preset);
          yield waitFor(function () { return !q(".image-context-menu"); }, "menu to close after preset");
          yield settle();
          img = yield must(".milkdown-editor .ProseMirror img[src^='data:image/svg']", "fixture image after resize");
          yield contextMenu(img);
          yield must(".image-context-menu", "image context menu (reopened)");
          var custom = yield waitFor(function () { return qa(".image-context-menu-button").filter(function (b) { return b.textContent.indexOf("Custom") >= 0; })[0]; }, "Custom… button");
          click(custom);
          yield must(".image-context-menu-input", "custom percent input");
          yield settle();
        });
      },
      phases: [
        phase("base", "open menu + Custom", null, function () { return !!q(".image-context-menu") && !!q(".image-context-menu-input"); },
          cat(CHROME, [".image-context-menu", ".image-context-menu-label", ".image-context-menu-button", ".image-context-menu-button.is-active", ".image-context-menu-custom", ".image-context-menu-input", ".image-context-menu-apply"])),
        phase("empty percent", "disabled Apply", function () {
          return co(function* () {
            setInputValue(q(".image-context-menu-input"), "");
            yield settle();
          });
        }, function () { var b = q(".image-context-menu-apply"); return !!b && b.disabled; },
          [".image-context-menu-apply", ".image-context-menu-input"]),
        focusPhase(".image-context-menu-input")
      ],
      manual: [".image-context-menu-button:hover"]
    },

    "settings-general": settingsSurface("General", cat(SETTINGS_PAGE, [".settings-select"]),
      [focusPhase(".settings-category-btn"), focusPhase(".settings-close"), focusPhase(".settings-select"), focusPhase(".settings-footer .toolbar-button")]),
    "settings-editor": settingsSurface("Editor", cat(SETTINGS_PAGE, [".settings-section-label", ".settings-select", ".settings-stepper", ".settings-stepper button", ".settings-stepper span"]),
      [focusPhase(".settings-stepper button:not(:disabled)")]),
    "settings-markdown": settingsSurface("Markdown", SETTINGS_PAGE, []),
    "settings-image": settingsSurface("Image", cat(SETTINGS_PAGE, [".settings-input"]), [focusPhase(".settings-input")]),
    "settings-export": settingsSurface("Export", cat(SETTINGS_PAGE, [".settings-input"]), []),
    "settings-appearance": settingsSurface("Appearance", cat(SETTINGS_PAGE, [".settings-select"]), []),
    "settings-shortcuts": settingsSurface("Keyboard Shortcuts",
      [".shortcuts-layout", ".shortcuts-header h3", ".shortcuts-header p", ".shortcuts-section", ".shortcuts-section h4", ".shortcut-row", ".shortcut-label", ".shortcut-value"],
      [focusPhase(".shortcut-value"),
        phase("recording", "editing", function () {
          return co(function* () {
            click(q(".shortcut-value"));
            yield waitFor(function () { return q(".shortcut-value.is-editing"); }, "recording state");
            yield settle();
          });
        }, function () { return !!q(".shortcut-value.is-editing"); }, [".shortcut-value.is-editing"])]),
    "settings-shortcuts-conflict": conflictSurface(settingsSurface("Keyboard Shortcuts",
      [".shortcuts-layout", ".settings-dirty-banner", ".settings-dirty-banner button", ".toolbar-button.primary", ".settings-error", ".shortcut-row.has-conflict", ".shortcut-row.has-conflict .shortcut-value"],
      [], [".toolbar-button.primary:hover"])),
    "settings-advanced": settingsSurface("Advanced", cat(SETTINGS_PAGE, [".settings-select"]), []),

    "settings-narrow": {
      viewport: [400, 640],
      setup: function () { return openSettings("General"); },
      phases: [phase("base", "open modal", null, function () { return !!q(".settings-dialog"); }, cat(CHROME, SETTINGS, SETTINGS_PAGE))],
      manual: []
    },

    "toast-info": {
      viewport: [1200, 800],
      setup: function () {
        return co(function* () {
          yield openFixture(); yield setMode("source");
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
          key("Meta+Alt+t", document.body);
          yield must(".toast", "toast");
          yield settle();
        });
      },
      phases: [phase("base", "toast shown", null, function () { return !!q(".toast"); }, cat(CHROME, [".toast"]))],
      manual: [".toast-close (never rendered: no Toast caller passes onClose at a5767d5)"]
    },

    "unsaved-confirm-tab": {
      viewport: [1200, 800],
      setup: function () {
        return co(function* () {
          yield openFixture(); yield setMode("source");
          var content = q("#source-container .cm-content");
          var view = cmView();
          view.focus();
          view.dispatch({ selection: { anchor: 0 } });
          typeInto(content, "x");
          yield waitFor(function () { return q(".bottom-tab__modified"); }, "modified dot");
          click(q(".bottom-tab__close"));
          yield must(".dialog-card", "unsaved-changes confirm");
          yield settle();
        });
      },
      phases: [
        phase("base", "open modal", null, function () { return !!q(".dialog-card") && /without saving/i.test(q(".dialog-card").textContent); },
          cat(CHROME, DIALOG, [".dialog-message"])),
        focusPhase(".dialog-actions .toolbar-button"),
        focusPhase(".dialog-actions .toolbar-button:last-child")
      ],
      manual: [".toolbar-button:hover"]
    }
  };

  // Supplementary browser-render surfaces. Appendix B lists Settings
  // Integrations and About as Tauri-only: under `pnpm dev` there is no IPC, so
  // they render their error states. They are captured anyway because they are
  // the only `pnpm dev` route to the .mcp-* / .about-* / .toggle-slider
  // selectors. They do NOT replace the Tauri screenshot pass for those rows.
  SURFACES["browser-settings-integrations"] = {
    viewport: [1200, 800],
    supplementary: true,
    setup: function () {
      return co(function* () {
        yield openSettings("Integrations");
        yield must(".settings-integrations .settings-error", "IPC error message");
        yield settle();
      });
    },
    phases: [
      phase("base", "open modal (IPC error state)", null, function () { return !!q(".settings-integrations") && /invoke/.test(q(".settings-integrations .settings-error").textContent); },
        cat(CHROME, SETTINGS, [".settings-integrations", ".settings-integrations h3", ".settings-integrations h4", ".settings-error", ".settings-row", ".settings-row-label", ".settings-row-label strong", ".settings-row-description", ".settings-row-control", ".toggle-switch", ".toggle-slider", ".mcp-installations", ".mcp-installations-description", ".mcp-actions", ".mcp-actions .toolbar-button"])),
      phase("checked toggle", "checked", function () {
        return co(function* () {
          var box = q(".toggle-switch input[type=checkbox]");
          if (box && !box.checked) click(box);
          yield settle();
        });
      }, function () { var box = q(".toggle-switch input[type=checkbox]"); return !!box && box.checked; },
        [".toggle-switch", ".toggle-slider"]),
      focusPhase(".toggle-switch input[type=checkbox]")
    ],
    manual: ["IPC-backed states (server running, client list, copy buttons): Tauri screenshot pass"]
  };
  SURFACES["browser-settings-about"] = {
    viewport: [1200, 800],
    supplementary: true,
    setup: function () {
      return co(function* () {
        yield openSettings("About");
        yield must(".about-status-error", "update-check error state");
        yield settle();
      });
    },
    phases: [phase("base", "open modal (update error state)", null, function () { return !!q(".about-status-error"); },
      cat(CHROME, SETTINGS, [".about-app-info", ".about-app-name", ".about-version", ".about-update-status", ".about-status-text", ".about-status-error", ".settings-section", ".settings-section-title", ".settings-main .toolbar-button"]))],
    manual: ["About ok/disabled/progress/release-notes states: Tauri screenshot pass"]
  };

  // Narrow-window surfaces (DR16): same frame, different viewport.
  [[400, 640, true], [400, 640, false], [959, 800, true], [900, 800, true]].forEach(function (v) {
    var name = "narrow-" + v[0] + "x" + v[1] + (v[2] ? "" : "-nosidebar");
    SURFACES[name] = {
      viewport: [v[0], v[1]],
      setup: function () {
        return co(function* () {
          yield openFixture(); yield setMode("source");
          if (!v[2]) { key("Meta+Shift+L", document.body); yield must(".main-traffic-area", "sidebar hidden"); }
          yield settle();
        });
      },
      phases: [phase("base", v[2] ? "sidebar shown" : "sidebar hidden", null, function () { return v[2] ? !q(".app-shell.no-sidebar") : !!q(".app-shell.no-sidebar"); },
        cat(CHROME, TABS_OPEN, SOURCE, [".sidebar-mode-label"], v[2] ? [".toc-sidebar"] : [".main-traffic-area"]))],
      manual: []
    };
  });

  // ---------------------------------------------------------------- run

  function setTheme(theme) {
    var root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
  }

  function probe() {
    var sels = {};
    Array.prototype.forEach.call(document.styleSheets, function (ss) {
      var rules;
      try { rules = ss.cssRules; } catch (e) { return; }
      (function walk(list) {
        Array.prototype.forEach.call(list, function (r) {
          if (r.cssRules && !r.selectorText) { walk(r.cssRules); return; }
          if (!r.selectorText) return;
          r.selectorText.split(",").forEach(function (s) {
            var base = s.trim().replace(/::?[a-z-]+(\([^)]*\))?/gi, "").trim();
            if (!base || base === "*") return;
            try { if (document.querySelector(base)) sels[base] = qa(base).length; } catch (e) { /* invalid */ }
          });
        });
      })(rules);
    });
    return sels;
  }

  // Coverage mode (`cover: [selectors]`, not used for baselines): for each
  // inventory selector, list the phases in which some captured element matches
  // it. Pseudo-elements and :hover are stripped; the base element must be
  // captured.
  function recordCoverage(list, p, cover) {
    var captured = [];
    p.capture.forEach(function (sel) { captured = captured.concat(qa(sel).slice(0, ITEM_LIMIT)); });
    list.forEach(function (raw) {
      raw.split(",").forEach(function (part) {
        var sel = part.trim().replace(/::?(before|after|-webkit-[a-z-]+)/g, "").replace(/:hover/g, "");
        var hit = false;
        try { hit = captured.some(function (el) { return el.matches(sel); }); } catch (e) { hit = false; }
        if (hit) { cover[raw] = cover[raw] || []; if (cover[raw].indexOf(p.name) < 0) cover[raw].push(p.name); }
      });
    });
  }

  function run(args) {
    return co(function* () {
      var errors = [];
      var cover = {};
      var out = {
        schema: SCHEMA, surface: args.surface, theme: args.theme,
        viewport: { width: window.innerWidth, height: window.innerHeight, deviceScaleFactor: window.devicePixelRatio },
        phases: {}, errors: errors
      };
      var def = SURFACES[args.surface];
      if (!def) { errors.push("unknown surface: " + args.surface); out.ok = false; return out; }
      if (args.theme !== "light" && args.theme !== "dark") errors.push("theme must be light or dark");
      if (window.__MDPRO_SNAP_RAN__) errors.push("page is not fresh: snapshot.js already ran on this load");
      window.__MDPRO_SNAP_RAN__ = true;
      if (qa(".bottom-tab").length !== 0) errors.push("page is not fresh: documents already open");
      if (window.innerWidth !== def.viewport[0] || window.innerHeight !== def.viewport[1]) {
        errors.push("viewport " + window.innerWidth + "x" + window.innerHeight + " is not the surface viewport " + def.viewport.join("x"));
      }
      if (errors.length) { out.ok = false; return out; }
      try {
        yield waitFor(function () { return document.hasFocus(); }, "page focus (bring the app window to the front)", FOCUS_TIMEOUT_MS);
      } catch (e) {
        errors.push("page never had focus: " + e.message);
        out.ok = false;
        return out;
      }

      setTheme(args.theme);
      try {
        yield def.setup();
        setTheme(args.theme); // re-assert in case a React effect rewrote the class
        if (!document.documentElement.classList.contains("theme-" + args.theme)) errors.push("theme class did not apply");
        out.themeApplied = document.documentElement.classList.contains("theme-" + args.theme);
        if (args.probe) { out.probe = probe(); out.ok = errors.length === 0; return out; }
        for (var i = 0; i < def.phases.length; i++) {
          var p = def.phases[i];
          if (p.run) yield p.run();
          var applied = false;
          try { applied = !!p.assert(); } catch (e) { applied = false; }
          if (!applied) errors.push("[" + p.name + "] forced state did not apply: " + p.kind);
          if (!document.hasFocus()) errors.push("[" + p.name + "] page lost focus: :focus styles are unreliable");
          if (args.cover) recordCoverage(args.cover, p, cover);
          out.phases[String(i).padStart(2, "0") + " " + p.name] = {
            kind: p.kind, applied: applied, selectors: captureSelectors(p.capture, errors, p.name)
          };
          if (p.focusOnly && document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
            yield settle();
          }
        }
      } catch (e) {
        errors.push("setup/phase threw: " + (e && e.message ? e.message : String(e)));
      }
      out.manual = def.manual.slice().sort();
      out.supplementary = !!def.supplementary;
      if (args.cover) out.coverage = cover;
      out.ok = errors.length === 0;
      return out;
    });
  }

  var args = window.__MDPRO_SNAP__ || {};
  if (args.list) {
    var cat0 = {};
    Object.keys(SURFACES).sort().forEach(function (k) { cat0[k] = { viewport: SURFACES[k].viewport.join("x") }; });
    return JSON.stringify(cat0, null, 2);
  }
  return run(args).then(function (out) { return JSON.stringify(sortKeys(out), null, 2); },
    function (e) { return JSON.stringify({ ok: false, errors: ["snapshot.js crashed: " + (e && e.message ? e.message : String(e))] }); });
})();
