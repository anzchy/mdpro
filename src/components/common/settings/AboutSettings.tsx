import { useState, useEffect, useRef, useCallback } from "react";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Update } from "@tauri-apps/plugin-updater";
import { loggingService } from "../../../services/loggingService";
import type { LogContext } from "../../../types/logging";
import { updaterService } from "../../../services/updaterService";
import { useUpdaterStore } from "../../../stores/updaterStore";
import type { CacheSafeState } from "../../../stores/updaterStore";
import { ConfirmDialog } from "../ConfirmDialog";
import { prepareForRelaunch } from "../../../hooks/useUpdater";
import { isUpdatesDisabledError } from "./updaterErrors";

/**
 * Purpose: Settings → About page: app version, update check via
 * @tauri-apps/plugin-updater, download + install + relaunch. Each non-cached
 * check logs one `ui.about.update_check` start and one terminal line: success,
 * success + `outcome: "updates-disabled"` (no endpoints configured only), or
 * fail (incl. ReleaseNotFound, D85); a cache hit logs none. Finding an update
 * clears the cached result, so a remount re-checks instead of a stale error.
 * Each check takes a request id from updaterStore and writes the cache only
 * while it is still the newest check; its screen update additionally needs
 * the panel to be mounted (D110). A superseded check still logs its terminal line.
 *
 * @coordinates-with updaterErrors (updates-disabled vs network-error detection)
 * @coordinates-with updaterStore (cache-safe state persistence)
 * @coordinates-with useUpdater (prepareForRelaunch save guard)
 * @coordinates-with ConfirmDialog (restart confirmation)
 */

type UpdateState =
  | { phase: "checking" }
  | { phase: "up-to-date" }
  | { phase: "error"; message: string }
  | { phase: "updates-disabled" }
  | { phase: "available"; version: string; body: string | null; handle: Update }
  | { phase: "downloading"; progress: number }
  | { phase: "ready" };

const marked = new Marked();

export function AboutSettings() {
  const [currentVersion, setCurrentVersion] = useState("");
  const [state, setState] = useState<UpdateState>({ phase: "checking" });
  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const actionId = useRef(loggingService.generateActionId());
  const mounted = useRef(false);

  // One place for the About log shape; level follows status (fail → error).
  // Reads actionId.current, so it is safe inside useCallback([]).
  function logAbout(event: string, status: "start" | "success" | "fail", context?: LogContext) {
    const level = status === "fail" ? "error" : "info";
    loggingService.logEventSync({
      level, event, status, actionId: actionId.current, ...(context && { context }),
    });
  }
  const logCheck = (status: "start" | "success" | "fail", context: LogContext) =>
    logAbout("ui.about.update_check", status, context);

  useEffect(() => {
    mounted.current = true;
    void updaterService.getAppVersion().then((v) => mounted.current && setCurrentVersion(v));
    void runCheck(false);
    return () => { mounted.current = false; };
  }, []);

  const runCheck = useCallback(async (forceRefresh: boolean) => {
    // Read from store directly to avoid stale closure (rule 50)
    const cached = useUpdaterStore.getState().cachedResult;
    if (!forceRefresh && cached) {
      setState(cached);
      return;
    }

    setState({ phase: "checking" });
    logCheck("start", { forceRefresh });
    const store = useUpdaterStore.getState();
    const requestId = store.beginRequest();
    // Only the newest check, on a mounted panel, may change what is shown (D110).
    const show = (next: UpdateState) => {
      if (mounted.current && useUpdaterStore.getState().activeRequestId === requestId) setState(next);
    };
    const commit = (next: CacheSafeState) => {
      store.setCachedResult(next, requestId);
      show(next);
    };

    try {
      // Dynamic import to avoid bundling the plugin when not needed
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();

      if (update) {
        // Don't cache 'available' (handle may go stale); drop any earlier error (D85)
        store.clearCache(requestId);
        const { version, body } = update;
        show({ phase: "available", version, body: body ?? null, handle: update });
      } else {
        commit({ phase: "up-to-date" });
      }

      logCheck("success", { hasUpdate: !!update, version: update?.version });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      // Updates disabled (no endpoints configured) is a definite answer, not an
      // error: success + `outcome`. ReleaseNotFound (any non-2xx) is a fail (D85).
      if (isUpdatesDisabledError(msg)) {
        commit({ phase: "updates-disabled" });
        logCheck("success", { outcome: "updates-disabled", error: msg });
        return;
      }

      commit({ phase: "error", message: "Couldn't get update information. Try again later." });
      logCheck("fail", { error: msg });
    }
  }, []);

  async function handleInstall() {
    if (state.phase !== "available") return;
    const { handle } = state;
    let received = 0;
    let total = 0;

    setState({ phase: "downloading", progress: 0 });
    logAbout("ui.about.update_install", "start");

    try {
      await handle.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          total = event.data.contentLength;
        }
        if (event.event === "Progress") {
          received += event.data.chunkLength;
          const pct = total > 0 ? Math.round((received / total) * 100) : 0;
          setState({ phase: "downloading", progress: pct });
        }
      });
      setState({ phase: "ready" });
      logAbout("ui.about.update_install", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState({
        phase: "error",
        message: `Download failed: ${msg}`,
      });
      logAbout("ui.about.update_install", "fail", { error: msg });
    }
  }

  async function handleRelaunch() {
    const canProceed = await prepareForRelaunch();
    if (!canProceed) return;

    logAbout("ui.about.relaunch", "start");
    try {
      await relaunch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState({
        phase: "error",
        message: `Restart failed: ${msg}`,
      });
      logAbout("ui.about.relaunch", "fail", { error: msg });
    }
  }

  function renderReleaseNotes(body: string): string {
    const raw = marked.parse(body);
    const html = typeof raw === "string" ? raw : "";
    return DOMPurify.sanitize(html);
  }

  const checkDisabled =
    state.phase === "checking" ||
    state.phase === "downloading" ||
    state.phase === "ready";

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">About</h3>

      <div className="about-app-info">
        <div className="about-app-name">mdpro</div>
        <div className="about-version">
          Version {currentVersion ? `v${currentVersion}` : "..."}
        </div>
      </div>

      <div className="about-update-status">
        {state.phase === "checking" && (
          <span className="about-status-text">Checking for updates...</span>
        )}

        {state.phase === "up-to-date" && (
          <span className="about-status-text about-status-ok">
            ✓ You're up to date
          </span>
        )}

        {state.phase === "updates-disabled" && (
          <span className="about-status-text about-status-disabled">
            Automatic updates coming soon.
          </span>
        )}

        {state.phase === "error" && (
          <span className="about-status-text about-status-error">
            {state.message}
          </span>
        )}

        {state.phase === "available" && (
          <div className="about-update-available">
            <span className="about-status-text">
              Update available — v{state.version}
            </span>
            <button
              className="toolbar-button toolbar-button--primary"
              onClick={() => void handleInstall()}
              type="button"
            >
              Install Update
            </button>
            {state.body && (
              <div
                className="about-release-notes"
                dangerouslySetInnerHTML={{
                  __html: renderReleaseNotes(state.body),
                }}
              />
            )}
          </div>
        )}

        {state.phase === "downloading" && (
          <div className="about-download-progress">
            <progress
              value={state.progress > 0 ? state.progress : undefined}
              max={100}
              className="about-progress-bar"
              aria-label="Download progress"
            />
            <span className="about-progress-label">
              {state.progress > 0
                ? `Downloading update (${state.progress}%)...`
                : "Downloading update..."}
            </span>
          </div>
        )}

        {state.phase === "ready" && (
          <div className="about-update-ready">
            <span className="about-status-text about-status-ok">
              ✓ Ready to install
            </span>
            <button
              className="toolbar-button toolbar-button--primary"
              onClick={() => setShowRestartDialog(true)}
              type="button"
            >
              Restart to Apply
            </button>
          </div>
        )}
      </div>

      {state.phase !== "updates-disabled" && (
        <button
          className="toolbar-button"
          onClick={() => void runCheck(true)}
          disabled={checkDisabled}
          type="button"
        >
          Check Again
        </button>
      )}

      <ConfirmDialog
        open={showRestartDialog}
        title="Restart to apply update?"
        message="mdpro will save your open documents and restart to finish installing the update."
        confirmLabel="Save and Restart"
        cancelLabel="Don't restart yet"
        onConfirm={() => {
          setShowRestartDialog(false);
          void handleRelaunch();
        }}
        onCancel={() => setShowRestartDialog(false)}
      />
    </div>
  );
}
