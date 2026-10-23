/**
 * Purpose: docked WYSIWYG find and replace controls bound to the current editor view.
 * @coordinates-with ../../plugins/milkdown/find/findPlugin.ts
 * @coordinates-with MilkdownEditor.tsx
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { AppliedShortcuts } from "../../types/keyboardShortcuts";
import type { KeyboardShortcuts } from "../../types/preferences";
import { isMacPlatform } from "../../utils/platformLabels";
import { matchesShortcut } from "../../utils/shortcutMatch";
import { loggingService } from "../../services/loggingService";
import { closeFind, moveFind, openFind, replaceFind, setFindOptions, setFindQuery, type FindState } from "../../plugins/milkdown/find/findPlugin";
import "./FindReplaceBar.css";

interface Props {
  state: FindState;
  getView: () => EditorView | null;
  appliedShortcuts: AppliedShortcuts | null;
}

const findFields: readonly (keyof KeyboardShortcuts)[] = ["editFind", "editReplace", "editFindNext", "editFindPrevious"];

function matchedFindField(event: KeyboardEvent, applied: AppliedShortcuts | null): keyof KeyboardShortcuts | null {
  const mac = isMacPlatform();
  for (const options of [{ relaxed: false, physical: false }, { relaxed: false, physical: true }, { relaxed: !mac, physical: false }]) {
    for (const field of findFields) {
      const binding = applied?.bindings[field];
      if (binding?.state === "bound" && matchesShortcut(event.nativeEvent, binding.chord, { isMac: mac, ...options })) return field;
    }
  }
  return null;
}

export function FindReplaceBar({ state, getView, appliedShortcuts }: Props) {
  const findInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replacement, setReplacement] = useState("");

  useEffect(() => {
    if (!state.open) return;
    (state.replacing ? replaceInput : findInput).current?.focus();
  }, [state.open, state.replacing, state.focusEpoch]);

  if (!state.open) return null;

  const act = (name: string, effect: (view: EditorView) => boolean | void) => {
    const actionId = loggingService.generateActionId();
    loggingService.logEventSync({ level: "info", event: "ui.find.action", status: "start", actionId, context: { controlId: name } });
    const view = getView();
    const changed = view ? effect(view) !== false : false;
    loggingService.logEventSync({ level: "info", event: "ui.find.action", status: changed ? "success" : "cancel", actionId, context: { controlId: name } });
  };
  const close = () => act("close", (view) => { closeFind(view); view.focus(); });
  const move = (direction: 1 | -1) => act(direction === 1 ? "next" : "previous", (view) => moveFind(view, direction));
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    const field = matchedFindField(event, appliedShortcuts);
    if (field === "editFind") {
      event.preventDefault(); act("find", (view) => openFind(view, false)); return;
    }
    if (field === "editReplace") {
      event.preventDefault(); act("replace.open", (view) => openFind(view, true)); return;
    }
    if (field === "editFindNext") {
      event.preventDefault(); move(1); return;
    }
    if (field === "editFindPrevious") {
      event.preventDefault(); move(-1); return;
    }
    if (event.key === "Enter") { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
  };

  return <section className="mdpro-find-bar" aria-label="Find and replace" onKeyDown={handleKeyDown}>
    {state.replacing && <div className="mdpro-find-bar__row mdpro-find-bar__row--replace">
      <label className="mdpro-find-bar__field"><span>Replace</span><input ref={replaceInput} value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label>
      <button type="button" className="mdpro-find-bar__button" onClick={() => act("replace.one", (view) => replaceFind(view, replacement, false))}>Replace</button>
      <button type="button" className="mdpro-find-bar__button mdpro-find-bar__primary" onClick={() => act("replace.all", (view) => replaceFind(view, replacement, true))}>Replace All</button>
    </div>}
    <div className="mdpro-find-bar__row">
      <label className="mdpro-find-bar__field"><span>Find</span><input ref={findInput} value={state.query} onChange={(event) => act("query", (view) => setFindQuery(view, event.target.value))} /></label>
      <span className="mdpro-find-bar__count" aria-live="polite">{state.matches.length ? `${state.current + 1} of ${state.matches.length}` : "No matches"}</span>
      <button type="button" className="mdpro-find-bar__button" aria-label="Previous match" onClick={() => move(-1)}>↑</button>
      <button type="button" className="mdpro-find-bar__button" aria-label="Next match" onClick={() => move(1)}>↓</button>
      <button type="button" className="mdpro-find-bar__button" aria-pressed={state.caseSensitive} onClick={() => act("case", (view) => setFindOptions(view, { caseSensitive: !state.caseSensitive }))}>Aa</button>
      <button type="button" className="mdpro-find-bar__button" aria-pressed={state.wholeWord} onClick={() => act("whole-word", (view) => setFindOptions(view, { wholeWord: !state.wholeWord }))}>Whole word</button>
      <button type="button" className="mdpro-find-bar__button" aria-label="Close find" onClick={close}>×</button>
    </div>
  </section>;
}
