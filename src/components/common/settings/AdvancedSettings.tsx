import { useState } from "react";
import { useLoggingStore } from "../../../stores/loggingStore";
import type { LogLevel } from "../../../types/logging";
import { loggingService } from "../../../services/loggingService";

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
  const { enabled: loggingEnabled, level: loggingLevel, setEnabled, setLevel } =
    useLoggingStore();
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleLoggingToggle = async (next: boolean) => {
    setSaveError(null);
    loggingService.logUiEvent("ui.toggle.change", {
      controlId: "settings.advanced.logging.enabled",
      newValue: next,
    });
    // Read the latest level from the store (not the captured closure value) to
    // avoid a stale-state race when toggle and level change fire in quick succession.
    const { level } = useLoggingStore.getState();
    try {
      await loggingService.setLoggingSettings({ enabled: next, level });
      setEnabled(next);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to save logging settings");
    }
  };

  const handleLogLevelChange = async (rawValue: string) => {
    if (!isLogLevel(rawValue)) return;
    setSaveError(null);
    loggingService.logUiEvent("ui.select.change", {
      controlId: "settings.advanced.logging.level",
      newValue: rawValue,
    });
    const { enabled } = useLoggingStore.getState();
    try {
      await loggingService.setLoggingSettings({ enabled, level: rawValue });
      setLevel(rawValue);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to save logging settings");
    }
  };

  return (
    <div>
      <div className="settings-page-header">
        <h3 className="settings-page-title">Advanced</h3>
        <p className="settings-page-desc">Logging and diagnostic settings.</p>
      </div>

      {saveError && <p className="settings-error">{saveError}</p>}

      <div className="settings-row">
        <div className="settings-row-label">
          <label htmlFor="adv-logging-enabled">
            <h4>Enable Logging</h4>
            <p>Write structured logs to ~/.mdpro/mdpro.log</p>
          </label>
        </div>
        <div className="settings-row-control">
          <input
            id="adv-logging-enabled"
            type="checkbox"
            checked={loggingEnabled}
            onChange={(e) => void handleLoggingToggle(e.target.checked)}
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          <label htmlFor="adv-logging-level">
            <h4>Log Level</h4>
            <p>Minimum severity level to record.</p>
          </label>
        </div>
        <div className="settings-row-control">
          <select
            id="adv-logging-level"
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
  );
}
