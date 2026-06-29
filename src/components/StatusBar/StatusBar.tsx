/**
 * Purpose: thin bottom status bar showing word / character count and an
 * estimated reading time for the active document. Hidden when
 * `showStatusBar` is false (View menu toggle).
 *
 * Counting is delegated to the pure `countText` util (CJK-correct). The
 * doc content is debounced before recomputation so fast typing doesn't
 * thrash the counter.
 *
 * @coordinates-with src/utils/countText.ts (counting model)
 * @coordinates-with src/stores/editorStore.ts (showStatusBar)
 */
import { useEffect, useMemo, useState } from "react";
import { countText } from "../../utils/countText";
import "./StatusBar.css";

interface StatusBarProps {
  content: string;
}

const DEBOUNCE_MS = 250;

export function StatusBar({ content }: StatusBarProps) {
  const [debounced, setDebounced] = useState(content);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(content), DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [content]);

  const { words, chars, readingTimeMinutes } = useMemo(
    () =>
      countText(debounced, {
        excludeFrontmatter: true,
        excludeCode: true,
      }),
    [debounced],
  );

  return (
    <div className="status-bar" role="status" aria-label="Document statistics">
      <span className="status-bar__item">{words} words</span>
      <span className="status-bar__item">{chars} characters</span>
      <span className="status-bar__item">
        {readingTimeMinutes} min read
      </span>
    </div>
  );
}
