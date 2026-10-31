// C# double for a desktop change that lands exactly at a durable progress write (D336–D338 fix 1,
// MH1). The native harness wraps the production Write-Progress so every write reports its phase
// and held count here. `progressTransition` fires once, at the first write in `phase` (and, when
// `held` is given, with that held count): the foreground moves, an overlay covers A, a dialog or
// control is re-created under its HWND, or an input thread's HKL changes. Before fix 1 these writes
// sat between the last check and the native mutation, so a transition here reached the old gap.
export interface ProgressScenario {
  progressTransition?: {
    phase: string;
    held?: number;
    foreground?: number;
    overlay?: boolean;
    /** The dialog or control HWND destroyed and re-created with the same handle. */
    replaceDialog?: number;
    hkl?: { thread: number; value: number };
  };
}

export const progressFakeSource = String.raw`
public static class ProgressFake {
  static string Phase = ""; static int Held = -1; static bool Overlay, Fired;
  static long Foreground, ReplaceDialog, HklThread, HklValue;
  public static void Configure(System.Text.Json.JsonElement root) {
    if (!root.TryGetProperty("progressTransition", out var t)) return;
    Phase = t.GetProperty("phase").GetString();
    Held = t.TryGetProperty("held", out var h) ? h.GetInt32() : -1;
    Foreground = t.TryGetProperty("foreground", out var f) ? f.GetInt64() : 0;
    Overlay = t.TryGetProperty("overlay", out var o) && o.GetBoolean();
    ReplaceDialog = t.TryGetProperty("replaceDialog", out var r) ? r.GetInt64() : 0;
    if (t.TryGetProperty("hkl", out var k)) { HklThread = k.GetProperty("thread").GetInt64(); HklValue = k.GetProperty("value").GetInt64(); }
  }
  public static void Written(string phase, int held) {
    if (Fired || Phase == "" || phase != Phase || (Held >= 0 && held != Held)) return;
    Fired = true; W32.Trace("progress-transition:" + phase + ":" + held);
    if (Foreground != 0) W32.Foreground = Foreground;
    if (Overlay) W32.OverlayAtA = true;
    if (ReplaceDialog != 0) { DialogFake.ReplaceHwnd = ReplaceDialog; DialogFake.ReplaceNow(); }
    if (HklThread != 0) { LayoutFake.State[(uint)HklThread] = HklValue; W32.Trace("layout-state:" + HklThread + ":" + HklValue); }
  }
}
`;
