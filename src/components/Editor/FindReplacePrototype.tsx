import { useEffect, useRef, useState } from "react";
import { MilkdownEditor } from "./MilkdownEditor";
import { useDocumentStore } from "../../stores/documentStore";
import { useMilkdownEditorStore } from "../../stores/milkdownEditorStore";
import { getMilkdownView } from "../../utils/focusActiveEditor";
import { loggingService } from "../../services/loggingService";
import { installPrototypeSearch, selectPrototypeMatch, updatePrototypeSearch, type PrototypeMatch, type PrototypeSearch } from "./FindReplacePrototypeSearch";
import type { Editor } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import "./FindReplacePrototype.css";

type Variant = "a" | "b" | "c";
const variants: Record<Variant, string> = { a: "A · Corner bar", b: "B · Editor strip", c: "C · Context popover" };
const sample = `# The quiet editor

The editor should keep the page calm while helping you find what matters. Search the editor for “editor” to see every match in context. Select a word in the editor, then press ⌘F to start from that selection.

## A working note

An editor can be a place for first thoughts. The editor needs to make small changes feel safe. In this editor, a search is a temporary layer over the document, and the document remains the center of attention.

> A good editor gives the words room to breathe. Search should be close when needed and quiet when it is not.

### What we want to compare

- **A** tucks the controls in a corner of the editor.
- **B** gives search a dedicated strip above the editor.
- **C** keeps a popover near the selection in the editor.

Try Find, Find Next, Replace, and Replace All. Try a query that has no matches. Change the case and whole-word options, then switch the theme. The editor highlights all matches, with the current match more distinct.

## Details in motion

The editor stays editable during this prototype. Moving between results scrolls to the match. The editor also accepts new text, so you can see how results respond. Every editor state here is temporary and lives only in this browser preview.

### A second page of notes

Read slowly. Good tools should disappear behind the work. A compact search can save space, while a full strip gives every action a steady location. A popover makes nearby results easy to scan, yet it may cover a sentence. The editor layout should make this tradeoff visible.

> When a word repeats, the editor should show the rhythm of those repetitions without taking over the page.

## Closing thought

Search is a way to move through a document. Replace changes it. The editor should make that difference clear, especially when replacing every match at once. Continue writing here to try the editor in motion.
`;

export function FindReplacePrototype() {
  const initial = new URLSearchParams(location.search).get("variant");
  const [variant, setVariant] = useState<Variant>(initial === "b" || initial === "c" ? initial : "a");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [open, setOpen] = useState(true);
  const [replaceOpen, setReplaceOpen] = useState(true);
  const [query, setQuery] = useState("editor");
  const [replacement, setReplacement] = useState("writer");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [current, setCurrent] = useState(0);
  const [matches, setMatches] = useState<PrototypeMatch[]>([]);
  const viewRef = useRef<EditorView | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const [anchor, setAnchor] = useState({ x: 180, y: 120 });
  const search: PrototypeSearch = { query, caseSensitive, wholeWord, current };

  useEffect(() => {
    useDocumentStore.getState().upsertDocument({ id: "find-prototype", path: null, content: sample, encoding: "utf-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: null });
    useDocumentStore.getState().setActiveDocumentId("find-prototype");
  }, []);

  useEffect(() => {
    document.documentElement.classList.remove("theme-light", "theme-dark");
    document.documentElement.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
  }, [theme]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const view = getMilkdownView(useMilkdownEditorStore.getState().getEditor() as Editor | null);
      if (!view || view === viewRef.current) return;
      viewRef.current = view;
      const cleanup = installPrototypeSearch(view, setMatches);
      updatePrototypeSearch(view, { query, caseSensitive, wholeWord, current });
      window.clearInterval(timer);
      cleanupRef.current = cleanup;
    }, 100);
    return () => { window.clearInterval(timer); cleanupRef.current?.(); };
  }, []);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const found = updatePrototypeSearch(view, open ? search : { ...search, query: "" });
    setMatches(found);
    if (open && found[current]) selectPrototypeMatch(view, found[current]);
  }, [query, caseSensitive, wholeWord, current, open]);

  useEffect(() => {
    if (!open) return;
    (replaceOpen ? replaceRef : inputRef).current?.focus();
  }, [open, replaceOpen, variant]);

  useEffect(() => {
    if (variant !== "c" || !open) return;
    const view = viewRef.current;
    const root = editorRef.current;
    if (!view || !root) return;
    const rect = root.getBoundingClientRect();
    const coords = view.coordsAtPos(matches[current]?.from ?? view.state.selection.from);
    setAnchor({ x: Math.min(Math.max(16, coords.left - rect.left), Math.max(16, rect.width - 350)), y: Math.min(Math.max(16, coords.bottom - rect.top + 12), Math.max(16, rect.height - 320)) });
  }, [variant, open, current, matches]);

  const log = (action: string) => loggingService.logEventSync({ level: "info", event: `ui.findPrototype.${action}`, status: "success", actionId: loggingService.generateActionId(), context: { variant } });
  const openFind = (replace: boolean) => {
    const view = viewRef.current;
    const selected = view?.state.doc.textBetween(view.state.selection.from, view.state.selection.to, " ") ?? "";
    if (selected) { setQuery(selected); setCurrent(0); }
    setReplaceOpen(replace);
    setOpen(true);
    window.setTimeout(() => (replace ? replaceRef : inputRef).current?.focus(), 0);
    log(replace ? "openReplace" : "openFind");
  };
  const close = () => { setOpen(false); viewRef.current?.focus(); log("close"); };
  const move = (delta: number) => {
    if (!matches.length) return;
    const next = (current + delta + matches.length) % matches.length;
    setCurrent(next);
    if (viewRef.current) selectPrototypeMatch(viewRef.current, matches[next]);
    log(delta > 0 ? "next" : "previous");
  };
  const replace = (all: boolean) => {
    const view = viewRef.current;
    if (!view || !matches.length) return;
    const targets = all ? [...matches].reverse() : [matches[current] ?? matches[0]];
    let transaction = view.state.tr;
    for (const match of targets) transaction = transaction.insertText(replacement, match.from, match.to);
    view.dispatch(transaction);
    setCurrent(0);
    log(all ? "replaceAll" : "replace");
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "f") { event.preventDefault(); openFind(false); }
      else if (mod && event.key.toLowerCase() === "h") { event.preventDefault(); openFind(true); }
      else if (mod && event.key.toLowerCase() === "g") { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
      else if (event.key === "Escape" && open) { event.preventDefault(); close(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const controls = <>
    <label className="find-prototype-field"><span>Find</span><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setCurrent(0); }} placeholder="Find in document" /></label>
    <span className="find-prototype-count" aria-live="polite">{query ? matches.length ? `${Math.min(current + 1, matches.length)} of ${matches.length}` : "No matches" : "Enter a word"}</span>
    <button type="button" aria-label="Previous match" onClick={() => move(-1)} title="Previous · ⇧⌘G">↑</button>
    <button type="button" aria-label="Next match" onClick={() => move(1)} title="Next · ⌘G">↓</button>
    <button type="button" className={caseSensitive ? "is-active" : ""} aria-pressed={caseSensitive} onClick={() => { setCaseSensitive(!caseSensitive); setCurrent(0); }}>Aa</button>
    <button type="button" className={wholeWord ? "is-active" : ""} aria-pressed={wholeWord} onClick={() => { setWholeWord(!wholeWord); setCurrent(0); }}>Whole word</button>
    <button type="button" aria-label="Close find" onClick={close}>×</button>
  </>;
  const replaceControls = <div className="find-prototype-replace"><label className="find-prototype-field"><span>Replace</span><input ref={replaceRef} value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="Replace with" /></label><button type="button" onClick={() => replace(false)}>Replace</button><button type="button" className="find-prototype-primary" onClick={() => replace(true)}>Replace All</button></div>;
  const choose = (next: Variant) => { history.replaceState(null, "", `?variant=${next}`); setVariant(next); log(`variant${next}`); };

  return <div className={`find-prototype-page variant-${variant}`}>
    <header className="find-prototype-title"><span>Notes / <strong>Finding the right words</strong></span><span>WYSIWYG</span></header>
    <main className="find-prototype-workspace" ref={editorRef}>
      <MilkdownEditor />
      {open && <section className="find-prototype-popup" aria-label="Find and replace" style={variant === "c" ? { left: anchor.x, top: anchor.y } : undefined}>
        <div className="find-prototype-find">{controls}</div>
        {replaceOpen && replaceControls}
        {variant === "c" && matches.length > 0 && <div className="find-prototype-results" aria-label="Matches">{matches.slice(Math.max(0, Math.min(current - 2, matches.length - 5)), Math.max(5, current + 3)).map((match) => { const index = matches.indexOf(match); return <button type="button" key={match.from} className={index === current ? "is-current" : ""} onClick={() => setCurrent(index)}><span>{index + 1}</span><span className="find-prototype-preview">{match.preview}</span></button>; })}{matches.length > 5 && <small>{matches.length} matches total · use ↑ ↓ to move</small>}</div>}
      </section>}
      {!open && <button className="find-prototype-reopen" type="button" onClick={() => openFind(false)}>Find · ⌘F</button>}
    </main>
    <footer className="find-prototype-switcher"><span>Find / Replace · U12</span>{(Object.keys(variants) as Variant[]).map((choice) => <button type="button" key={choice} className={choice === variant ? "is-active" : ""} onClick={() => choose(choice)}>{variants[choice]}</button>)}<button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "Dark" : "Light"} theme</button></footer>
  </div>;
}
