import { useEffect, useId, useRef, useState } from "react";

interface StepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  unit?: string;
  /** id of the row title that names the group; without it the value names it. */
  labelledBy?: string;
}

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
export function SettingsStepper({ value, min, max, onChange, unit = "", labelledBy }: StepperProps) {
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
        aria-label="Increase"
        type="button"
      >
        +
      </button>
    </div>
  );
}
