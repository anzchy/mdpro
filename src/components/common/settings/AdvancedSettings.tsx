import { useEffect } from "react";
import { useLoggingStore } from "../../../stores/loggingStore";
import type { LogLevel, LogSettings } from "../../../types/logging";
import { loggingService } from "../../../services/loggingService";
import { isWindowsPlatform, logFileHint } from "../../../utils/platformLabels";
import { ToggleSwitch } from "../ToggleSwitch";
import { useSettingsWriter } from "./useSettingsWriter";

const LOG_LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: "debug", label: "Debug" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warn" },
  { value: "error", label: "Error" },
];

const LOG_LEVEL_VALUES: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function isLogLevel(v: string): v is LogLevel {
  return (LOG_LEVEL_VALUES as readonly string[]).includes(v);
}

export function AdvancedSettings() {
  // Per-field selectors, not a whole-store destructure (rule 50 §1). A bare
  // `useLoggingStore()` subscribes to the state object's identity, so any field
  // this panel never reads would still re-render it.
  const storeEnabled = useLoggingStore((state) => state.enabled);
  const storeLevel = useLoggingStore((state) => state.level);
  const setEnabled = useLoggingStore((state) => state.setEnabled);
  const setLevel = useLoggingStore((state) => state.setLevel);

  // The switch and Log Level share one queued writer: each write is built when
  // it is sent from the confirmed pair, so neither carries the other's stale
  // value (PR #508 F508-1). The store moves only on a confirmed write; a
  // rejected one leaves it, and so the controls, at the saved value, and
  // `setLoggingSettings` raises the one save toast (rule 30 rule 5).
  const writer = useSettingsWriter<LogSettings>({
    group: "logging",
    save: (next) => loggingService.setLoggingSettings(next),
    onConfirm: (confirmed) => {
      setEnabled(confirmed.enabled);
      setLevel(confirmed.level);
    },
  });
  // Track the store until this page writes: App's hydrateSettings can land
  // after Settings opened, and a write must not be built on the store's
  // pre-hydration value (PR #508 N2). While a write is queued or in flight the
  // writer owns the value; its confirmed result reaches the store through
  // onConfirm and is re-seeded here, which changes nothing.
  useEffect(() => {
    if (!writer.busy()) writer.load({ enabled: storeEnabled, level: storeLevel });
  }, [storeEnabled, storeLevel]);
  const loggingEnabled = writer.value?.enabled ?? storeEnabled;
  const loggingLevel = writer.value?.level ?? storeLevel;

  const handleLoggingToggle = (next: boolean) => {
    loggingService.logUiEvent("ui.toggle.change", {
      controlId: "settings.advanced.logging.enabled",
      newValue: next,
    });
    void writer.write({ enabled: next });
  };

  const handleLogLevelChange = (rawValue: string) => {
    if (!isLogLevel(rawValue)) return;
    loggingService.logUiEvent("ui.select.change", {
      controlId: "settings.advanced.logging.level",
      newValue: rawValue,
    });
    void writer.write({ level: rawValue });
  };

  return (
    <div>
      <div className="settings-page-header">
        <h3 className="settings-page-title">Advanced</h3>
        <p className="settings-page-desc">Logging and diagnostic settings.</p>
      </div>

      <div className="settings-row">
        <div className="settings-row-content">
          <div className="settings-row-label">
            <h4 id="adv-logging-enabled-label">Enable Logging</h4>
            <p>{logFileHint(isWindowsPlatform())}</p>
          </div>
          <div className="settings-row-control">
            <ToggleSwitch
              id="adv-logging-enabled"
              labelledBy="adv-logging-enabled-label"
              checked={loggingEnabled}
              onChange={(v) => void handleLoggingToggle(v)}
            />
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-content">
          <div className="settings-row-label">
            <h4 id="adv-logging-level-label">Log Level</h4>
            <p>Minimum severity level to record.</p>
          </div>
          <div className="settings-row-control">
            <select
              id="adv-logging-level"
              aria-labelledby="adv-logging-level-label"
              className="settings-select"
              value={loggingLevel}
              onChange={(e) => void handleLogLevelChange(e.target.value)}
            >
              {LOG_LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
