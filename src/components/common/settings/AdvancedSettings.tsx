import { useLoggingStore } from "../../../stores/loggingStore";
import type { LogLevel } from "../../../types/logging";
import { loggingService } from "../../../services/loggingService";
import { isWindowsPlatform, logFileHint } from "../../../utils/platformLabels";
import { ToggleSwitch } from "../ToggleSwitch";

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
  const loggingEnabled = useLoggingStore((state) => state.enabled);
  const loggingLevel = useLoggingStore((state) => state.level);
  const setEnabled = useLoggingStore((state) => state.setEnabled);
  const setLevel = useLoggingStore((state) => state.setLevel);

  // A rejected write leaves the store, and so the control, at the saved value;
  // `setLoggingSettings` raises the one save toast (rule 30 rule 5).
  const handleLoggingToggle = async (next: boolean) => {
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
    } catch {
      // Already signalled and logged by the service.
    }
  };

  const handleLogLevelChange = async (rawValue: string) => {
    if (!isLogLevel(rawValue)) return;
    loggingService.logUiEvent("ui.select.change", {
      controlId: "settings.advanced.logging.level",
      newValue: rawValue,
    });
    const { enabled } = useLoggingStore.getState();
    try {
      await loggingService.setLoggingSettings({ enabled, level: rawValue });
      setLevel(rawValue);
    } catch {
      // Already signalled and logged by the service.
    }
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
