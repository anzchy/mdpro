/**
 * Purpose: the file-name part of a path, on both macOS and Windows
 * (D190-WI-5, audit W5). Tab labels, toasts and log fields use it, so a
 * Windows `C:\Users\jack\notes.md` shows as `notes.md`.
 *
 * Key decisions:
 * - Splits on both `/` and `\`, whatever the platform, because a Windows
 *   path may mix the two. A macOS file name may legally contain `\`; such a
 *   name gets a shortened label (the part after its last `\`). Only the
 *   label is affected: the path itself is never rewritten.
 * - Trailing separators are ignored (`/a/dir/` → `dir`).
 * - A path with no name segment (`""`, `/`, `C:\`) comes back unchanged
 *   rather than as an empty label.
 *
 * @coordinates-with src/components/BottomTabs/BottomTabs.tsx,
 *   src/hooks/useOpenUrlParam.ts, src/hooks/useUpdater.ts
 */

const SEPARATORS = /[/\\]+/;
const BARE_DRIVE = /^[A-Za-z]:$/;

/** The last name in `path`, or `path` itself when it has no name segment. */
export function basename(path: string): string {
  const names = path.split(SEPARATORS).filter((name) => name !== "");
  const last = names[names.length - 1];
  if (last === undefined || (names.length === 1 && BARE_DRIVE.test(last))) {
    return path;
  }
  return last;
}
