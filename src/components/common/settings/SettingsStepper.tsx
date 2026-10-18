import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

interface StepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  unit?: string;
  /** id of the row title that names the group; without it the value names it. */
  labelledBy?: string;
  /** id of the visible line saying why − or + is disabled (rule 30 rule 4). */
  reasonId?: string;
  /** Called with the bound the shown value sits at, so the owner can show the reason. */
  onBoundChange?: (bound: StepperBound) => void;
}

/** Which end of the range the shown value sits at, if either. */
export type StepperBound = "min" | "max" | null;

/**
 * A +/− stepper control used for numeric settings like font size.
 * Tracks pending value in a ref so rapid clicks accumulate correctly even
 * before the parent has re-rendered with the new prop.  Debounces the
 * onChange callback by 150ms so the preferences service is not hammered on
 * every keypress or click.
 *
 * With `labelledBy`, the group is named by its row title (WI-4.3a) and the
 * current value becomes its description, so it is still announced.
 */
export function SettingsStepper({
  value, min, max, onChange, unit = "", labelledBy, reasonId, onBoundChange,
}: StepperProps) {
  const valueId = useId();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // pendingRef tracks the optimistic value between rapid clicks
  const pendingRef = useRef(value);
  const [displayValue, setDisplayValue] = useState(value);

  // Sync display and pending when the parent propagates the flushed value
  useEffect(() => {
    pendingRef.current = value;
    setDisplayValue(value);
  }, [value]);

  // Report the bound from the shown value, so a reason appears with the step
  // that disables the button, not after the debounced write. A layout effect,
  // so the owner's reason line is in the DOM before the first paint at a bound.
  const atMin = displayValue <= min;
  const atMax = displayValue >= max;
  useLayoutEffect(() => {
    onBoundChange?.(atMin ? "min" : atMax ? "max" : null);
  }, [atMin, atMax, onBoundChange]);

  // Clean up any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const flush = (next: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(next), 150);
  };

  const decrement = () => {
    if (pendingRef.current <= min) return;
    const next = pendingRef.current - 1;
    pendingRef.current = next;
    setDisplayValue(next);
    flush(next);
  };

  const increment = () => {
    if (pendingRef.current >= max) return;
    const next = pendingRef.current + 1;
    pendingRef.current = next;
    setDisplayValue(next);
    flush(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      increment();
    }
    if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      decrement();
    }
  };

  return (
    <div
      className="settings-stepper"
      role="group"
      aria-label={labelledBy ? undefined : `Value: ${displayValue}${unit}`}
      aria-labelledby={labelledBy}
      aria-describedby={labelledBy ? valueId : undefined}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <button
        className="settings-stepper__step"
        onClick={decrement}
        disabled={displayValue <= min}
        aria-describedby={atMin ? reasonId : undefined}
        aria-label="Decrease"
        type="button"
      >
        −
      </button>
      <span id={valueId}>
        {displayValue}
        {unit}
      </span>
      <button
        className="settings-stepper__step"
        onClick={increment}
        disabled={displayValue >= max}
        aria-describedby={atMax ? reasonId : undefined}
        aria-label="Increase"
        type="button"
      >
        +
      </button>
    </div>
  );
}
