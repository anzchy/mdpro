import { useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { loggingService } from "../services/loggingService";
import { applyNativeAppearance } from "../services/nativeAppearance";
import { preferencesService } from "../services/preferencesService";
import type { ThemeMode } from "../stores/themeStore";
import { useThemeStore } from "../stores/themeStore";

/**
 * Monotonic token identifying the most recent theme intent in this window.
 *
 * Module scope rather than a ref: it describes "the latest theme the user asked
 * for", which is a property of the window, not of one hook instance. Both real
 * callers are fire-and-forget (`App.tsx` `onThemeModeChange`, `cycleThemeMode`
 * below), so nothing serialises them — and without this token a slow write that
 * fails *after* a newer write already succeeded would roll the store back to a
 * mode two choices old.
 */
let latestThemeIntent = 0;

function claimThemeIntent(): number {
  latestThemeIntent += 1;
  return latestThemeIntent;
}

/**
 * The mode a failed write must restore, and the number of writes in flight.
 *
 * NOT "the store value when this call was made". That is only the persisted
 * value while nothing else is in flight; the moment two writes overlap, the
 * second one captures the first one's *optimistic* value. If both then fail —
 * newer first, older last — the newer call restores a mode that was never
 * written anywhere and the older call declines to correct it, because
 * {@link latestThemeIntent} (correctly) says a newer intent owns the store. The
 * user is left looking at a theme that is on no disk anywhere.
 *
 * So the target is pinned when the first write of a burst starts, advanced only
 * when a write actually *lands*, and released when the burst drains — at which
 * point the store itself is again the last persisted value and can be re-read.
 *
 * Found at review, 2026-09-24. `latestThemeIntent` alone closes the
 * failure-after-success arm; this closes the failure-after-failure arm.
 */
let rollbackTarget: ThemeMode | null = null;
let writesInFlight = 0;

export function useTheme() {
  const mode = useThemeStore((state) => state.mode);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setMode = useThemeStore((state) => state.setMode);
  const setResolvedTheme = useThemeStore((state) => state.setResolvedTheme);

  const applySystemTheme = useCallback(async () => {
    try {
      const theme = await preferencesService.getSystemTheme();
      setResolvedTheme(theme);
    } catch {
      setResolvedTheme("light");
    }
  }, [setResolvedTheme]);

  // D238: the native appearance (pop-up menus, Open / Save panels) follows the
  // mode. System releases it (null) and only then reads the system theme, so a
  // forced appearance is never read back as the OS theme; the read is dropped
  // if the mode moved off System meanwhile.
  useEffect(() => {
    if (mode === "system") {
      void applyNativeAppearance("system").then(() => {
        if (useThemeStore.getState().mode === "system") return applySystemTheme();
        return undefined;
      });
      // Assigned only after an await. `cancelled` is what makes a teardown that
      // beats it still remove the handler the boundary registers afterwards.
      let cancelled = false;
      let unlisten: (() => void) | null = null;
      listen<{ theme: "light" | "dark" }>("theme:changed", (event) => {
        // Read the mode NOW, not from this render's closure: a handler that
        // outlives its effect would keep a stale `mode === "system"` and
        // overwrite an explicit Dark/Light choice (rule 50 §1).
        if (useThemeStore.getState().mode === "system") {
          setResolvedTheme(event.payload.theme);
        }
      })
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {
          // Ignore if events are not supported.
        });
      return () => {
        cancelled = true;
        if (unlisten) unlisten();
      };
    }
    void applyNativeAppearance(mode);
    setResolvedTheme(mode === "dark" ? "dark" : "light");
    return undefined;
  }, [applySystemTheme, mode, setResolvedTheme]);

  /**
   * Apply a theme mode **without** persisting it.
   *
   * Startup hydration reads the stored mode and must not write it straight back:
   * the round trip is a redundant write on every launch, and with two windows it
   * is a last-writer-wins clobber (B reads the old mode, A writes a new one, B
   * writes the old one back over the choice the user just made). Dropping the
   * write closes that by construction — there is nothing left to interleave.
   */
  const applyThemeMode = useCallback(
    (next: ThemeMode) => {
      // Claimed here too, so a pending failed write cannot roll back over a mode
      // that hydration applied after it was issued.
      claimThemeIntent();
      // The applied value came off disk, so it *is* the persisted value: if a
      // burst is open, it supersedes the target that burst started with.
      if (writesInFlight > 0) rollbackTarget = next;
      setMode(next);
    },
    [setMode],
  );

  const setThemeMode = useCallback(
    async (next: ThemeMode) => {
      // Pin the rollback target on the FIRST write of a burst only. Reading the
      // store here — rule 50 §1, never the render closure — is correct while
      // nothing is in flight, because then the store holds the last persisted
      // value. Once a write is open it does not, so later calls in the same
      // burst must inherit the pinned target rather than capture an optimistic
      // one. See {@link rollbackTarget}.
      if (writesInFlight === 0) rollbackTarget = useThemeStore.getState().mode;
      const previous = rollbackTarget as ThemeMode;
      const intent = claimThemeIntent();
      writesInFlight += 1;
      setMode(next);
      try {
        await preferencesService.setPreferences({ themeMode: next });
        // This write landed, so it is now the value a later failure restores.
        rollbackTarget = next;
      } catch {
        // Enum-only context (ADR-0031 step 5b): the rejection text can carry
        // filesystem paths, so it never reaches the log.
        loggingService.logEventSync({
          level: "error",
          event: "ui.theme.persist",
          status: "fail",
          actionId: loggingService.generateActionId(),
          context: { requestedMode: next, previousMode: previous, reason: "invoke_rejected" },
        });
        // No toast here on purpose. `preferencesService.setPreferences` already
        // raises "Failed to save preferences" and rule 30 §5 allows exactly one
        // signal per surface per event, so this path contributes a log entry and
        // a rollback — never a second toast.
        //
        // No rethrow either: both callers are fire-and-forget, so rethrowing
        // would convert a swallowed error into an unhandled rejection.
        if (intent !== latestThemeIntent) {
          // A newer intent already moved the store. Rolling back to this call's
          // `previous` would stamp a stale mode over the user's latest choice.
          return;
        }
        // `rollbackTarget`, not this call's captured `previous`: an earlier
        // write in the same burst may have landed since, and its value is the
        // one on disk.
        setMode(rollbackTarget ?? previous);
      } finally {
        writesInFlight -= 1;
        // Burst drained: the store is the last persisted value again, so the
        // next call can re-read it rather than trust a stale pin.
        if (writesInFlight === 0) rollbackTarget = null;
      }
    },
    [setMode],
  );

  const cycleThemeMode = useCallback(() => {
    const next = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
    void setThemeMode(next);
  }, [mode, setThemeMode]);

  return {
    mode,
    resolvedTheme,
    applyThemeMode,
    setThemeMode,
    cycleThemeMode,
  };
}
