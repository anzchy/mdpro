import { useEffect, useMemo, useRef } from "react";

interface StepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  unit?: string;
}

/**
 * A +/− stepper control used for numeric settings like font size.
 * Debounces the onChange callback by 150ms to avoid hammering the
 * preferences service on rapid repeated clicks.
 */
export function SettingsStepper({ value, min, max, onChange, unit = "" }: StepperProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable debounced wrapper — recreated only when `onChange` identity changes.
  const debouncedChange = useMemo(() => {
    return (next: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onChange(next), 150);
    };
  }, [onChange]);

  // Clean up any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const decrement = () => {
    if (value <= min) return;
    debouncedChange(value - 1);
  };

  const increment = () => {
    if (value >= max) return;
    debouncedChange(value + 1);
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
      aria-label={`Value: ${value}${unit}`}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <button
        onClick={decrement}
        disabled={value <= min}
        aria-label="Decrease"
        type="button"
      >
        −
      </button>
      <span>
        {value}
        {unit}
      </span>
      <button
        onClick={increment}
        disabled={value >= max}
        aria-label="Increase"
        type="button"
      >
        +
      </button>
    </div>
  );
}
