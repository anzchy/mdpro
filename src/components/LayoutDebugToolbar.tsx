import { useEffect, useState } from "react";

/**
 * Debug toolbar for testing layout constraints.
 * Only visible in development mode (both browser and Tauri dev).
 * Shows window size and allows adjusting content width/padding CSS variables.
 */
export function LayoutDebugToolbar() {
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
  const [maxWidth, setMaxWidth] = useState(780);
  const [padding, setPadding] = useState(40);

  // Only show in development mode
  if (!import.meta.env.DEV) {
    return null;
  }

  // Track window size
  useEffect(() => {
    const updateSize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Update CSS variables when values change
  useEffect(() => {
    document.documentElement.style.setProperty("--content-max-width", `${maxWidth}px`);
  }, [maxWidth]);

  useEffect(() => {
    document.documentElement.style.setProperty("--content-padding", `${padding}px`);
  }, [padding]);

  const minContentWidth = maxWidth + padding * 2;

  return (
    <div className="layout-debug-toolbar">
      <span className="layout-debug-label">LAYOUT DEBUG</span>
      <div className="layout-debug-item">
        <span>Window: {windowSize.width} × {windowSize.height}</span>
      </div>
      <div className="layout-debug-item">
        <label>Max Width:</label>
        <input
          type="number"
          value={maxWidth}
          onChange={(e) => setMaxWidth(Number(e.target.value))}
          min={200}
          max={1600}
          step={10}
        />
        <span>px</span>
      </div>
      <div className="layout-debug-item">
        <label>Padding:</label>
        <input
          type="number"
          value={padding}
          onChange={(e) => setPadding(Number(e.target.value))}
          min={0}
          max={200}
          step={5}
        />
        <span>px</span>
      </div>
      <div className="layout-debug-item">
        <span>Min container: {minContentWidth}px</span>
      </div>
    </div>
  );
}
