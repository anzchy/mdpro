import { useLoggingStore } from "../../../stores/loggingStore";
import type { LogLevel } from "../../../types/logging";
import { loggingService } from "../../../services/loggingService";

const LOG_LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: "debug", label: "Debug" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warn" },
  { value: "error", label: "Error" },
];

export function AdvancedSettings() {
  const { enabled: loggingEnabled, level: loggingLevel, setEnabled, setLevel } =
    useLoggingStore();

  const handleLoggingToggle = async (next: boolean) => {
    loggingService.logUiEvent("ui.toggle.change", {
      controlId: "settings.advanced.logging.enabled",
      newValue: next,
    });
    setEnabled(next);
    await loggingService.setLoggingSettings({ enabled: next, level: loggingLevel });
  };

  const handleLogLevelChange = async (next: LogLevel) => {
    loggingService.logUiEvent("ui.select.change", {
      controlId: "settings.advanced.logging.level",
      newValue: next,
    });
    setLevel(next);
    await loggingService.setLoggingSettings({ enabled: loggingEnabled, level: next });
  };

  return (
    <div>
      <div className="settings-page-header">
        <h3 className="settings-page-title">Advanced</h3>
        <p className="settings-page-desc">Logging and diagnostic settings.</p>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          <h4>Enable Logging</h4>
          <p>Write structured logs to ~/.mdpro/mdpro.log</p>
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
          <h4>Log Level</h4>
          <p>Minimum severity level to record.</p>
        </div>
        <div className="settings-row-control">
          <select
            id="adv-logging-level"
            className="settings-select"
            value={loggingLevel}
            onChange={(e) => void handleLogLevelChange(e.target.value as LogLevel)}
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
