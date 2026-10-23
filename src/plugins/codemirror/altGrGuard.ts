/** Keep printable AltGr input out of every Source keymap before dispatch. */
const CODE_BASE: Readonly<Record<string, string>> = {
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", IntlBackslash: "\\",
  Minus: "-", Equal: "=", Semicolon: ";", Quote: "'", Backquote: "`", Slash: "/",
};

function baseKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return CODE_BASE[code] ?? null;
}

export function isPrintableAltGr(event: KeyboardEvent, isMac: boolean): boolean {
  if (isMac || !event.ctrlKey || !event.altKey || event.metaKey || event.key.length !== 1) return false;
  if (event.getModifierState("AltGraph")) return true;
  const base = baseKey(event.code);
  return base !== null && base.toLowerCase() !== event.key.toLowerCase();
}

/** Capture before CodeMirror's keymap listener; leave browser text input intact. */
export function installAltGrGuard(element: HTMLElement, isMac: boolean): () => void {
  const guard = (event: KeyboardEvent) => {
    if (!isPrintableAltGr(event, isMac)) return;
    event.stopImmediatePropagation();
    event.stopPropagation();
  };
  element.addEventListener("keydown", guard, true);
  return () => element.removeEventListener("keydown", guard, true);
}
