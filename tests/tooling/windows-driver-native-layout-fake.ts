// C# double for the Win32 keyboard-layout surface (D338), compiled into the native harness's
// partial W32 class. Inert unless the scenario has `layout`. Window A (101, outer thread 7) has a
// focused input child 111 on thread 9; window B (202, outer thread 8) has 222 on thread 19. Each
// thread has its own HKL. An input-language request (WM_INPUTLANGCHANGEREQUEST, 0x50) posted to a
// child is applied to that child's thread unless the scenario gives the thread another behaviour.
// Every state change is traced as `layout-state:<thread>:<hkl>`, so a test reads the final state
// from the fake, never from the driver's own claim.
export type LayoutMode = "apply" | "reject" | "noop" | "driver" | "outer" | "variant" | "late";
export interface LayoutScenario {
  /** B's title file (hwnd 202), written by B's fake page when label B binds; else "mdpro B". */
  titleB?: string;
  layout?: {
    /** The starting HKL of each thread, keyed by thread id. */
    threads: Record<string, number>;
    /** KLID (upper-case hex) → the HKL LoadKeyboardLayout returns; absent means 0. */
    load?: Record<string, number>;
    /** The installed layouts GetKeyboardLayoutList reports. */
    list?: number[];
    /**
     * How a request is handled, by target thread: `apply` (default), `reject` (post fails),
     * `noop` (accepted, no effect), `driver` (changes the driver's thread 99), `outer` (changes the
     * owner's outer thread), `variant` (applies another layout with the same language low word)
     * or `late` (applied only `lateReads` HKL reads later).
     */
    request?: Record<string, LayoutMode>;
    /** The same, for a request whose HKL is the thread's starting HKL (a restore). */
    restore?: Record<string, LayoutMode>;
    lateReads?: number;
    /** At this HKL read the foreground moves to B. */
    focusDriftAt?: number;
    /** At this HKL read `replaceHwnd` (111 or 222) is destroyed and re-created with the same HWND. */
    replaceAt?: number;
    replaceHwnd?: number;
    /** GetGUIThreadInfo reports no focus window. */
    zeroFocus?: boolean;
    /** GetGUIThreadInfo for A's thread reports B's input child, a window outside A. */
    foreignFocus?: boolean;
    /** The input threads' HKL reads return 0. */
    zeroHkl?: boolean;
    /** The process id owning an input child (111 or 222), e.g. a WebView2 renderer; else mdpro's 11. */
    inputPid?: Record<string, number>;
  };
}

export const layoutFakeSource = String.raw`
public static class LayoutFake {
  public static bool Active, ZeroFocus, ZeroHkl, ForeignFocus;
  public static int Reads, FocusDriftAt, ReplaceAt, LateReads; public static long ReplaceHwnd;
  public static System.Collections.Generic.Dictionary<uint, long> State = new System.Collections.Generic.Dictionary<uint, long>(), Initial = new System.Collections.Generic.Dictionary<uint, long>();
  public static System.Collections.Generic.Dictionary<string, long> Load = new System.Collections.Generic.Dictionary<string, long>();
  public static System.Collections.Generic.List<long> List = new System.Collections.Generic.List<long>();
  public static System.Collections.Generic.Dictionary<uint, string> Request = new System.Collections.Generic.Dictionary<uint, string>(), Restore = new System.Collections.Generic.Dictionary<uint, string>();
  static System.Collections.Generic.Dictionary<uint, long> Late = new System.Collections.Generic.Dictionary<uint, long>();
  static System.Collections.Generic.Dictionary<uint, int> LateDue = new System.Collections.Generic.Dictionary<uint, int>();
  static System.Collections.Generic.Dictionary<long, uint> InputPid = new System.Collections.Generic.Dictionary<long, uint>();
  public static uint Pid(IntPtr h) { return InputPid.TryGetValue(h.ToInt64(), out var p) ? p : 11u; }
  static System.Collections.Generic.Dictionary<long, System.Collections.Generic.Dictionary<string, IntPtr>> Props = new System.Collections.Generic.Dictionary<long, System.Collections.Generic.Dictionary<string, IntPtr>>();
  public static string TitleBPath;
  public static string TitleB() { return TitleBPath != null ? File.ReadAllText(TitleBPath) : "mdpro B"; }
  public static void Configure(System.Text.Json.JsonElement root) {
    if (root.TryGetProperty("titleB", out var tb)) TitleBPath = tb.GetString();
    if (!root.TryGetProperty("layout", out var l)) return;
    Active = true; Props[111] = new System.Collections.Generic.Dictionary<string, IntPtr>(); Props[222] = new System.Collections.Generic.Dictionary<string, IntPtr>();
    foreach (var t in l.GetProperty("threads").EnumerateObject()) { State[uint.Parse(t.Name)] = t.Value.GetInt64(); Initial[uint.Parse(t.Name)] = t.Value.GetInt64(); }
    if (l.TryGetProperty("load", out var ld)) foreach (var x in ld.EnumerateObject()) Load[x.Name.ToUpperInvariant()] = x.Value.GetInt64();
    if (l.TryGetProperty("list", out var ls)) foreach (var x in ls.EnumerateArray()) List.Add(x.GetInt64());
    if (l.TryGetProperty("request", out var rq)) foreach (var x in rq.EnumerateObject()) Request[uint.Parse(x.Name)] = x.Value.GetString();
    if (l.TryGetProperty("inputPid", out var ip)) foreach (var x in ip.EnumerateObject()) InputPid[long.Parse(x.Name)] = (uint)x.Value.GetInt32();
    if (l.TryGetProperty("restore", out var rs)) foreach (var x in rs.EnumerateObject()) Restore[uint.Parse(x.Name)] = x.Value.GetString();
    int number(string name) => l.TryGetProperty(name, out var v) ? v.GetInt32() : 0;
    LateReads = number("lateReads"); FocusDriftAt = number("focusDriftAt"); ReplaceAt = number("replaceAt");
    ReplaceHwnd = l.TryGetProperty("replaceHwnd", out var rh) ? rh.GetInt64() : 0;
    ZeroFocus = l.TryGetProperty("zeroFocus", out var zf) && zf.GetBoolean();
    ZeroHkl = l.TryGetProperty("zeroHkl", out var zh) && zh.GetBoolean();
    ForeignFocus = l.TryGetProperty("foreignFocus", out var ff) && ff.GetBoolean();
  }
  public static bool Has(IntPtr h) { return Active && (h.ToInt64() == 111 || h.ToInt64() == 222); }
  public static uint Thread(IntPtr h) { return h.ToInt64() == 111 ? 9u : 19u; }
  public static IntPtr Root(IntPtr h) { return new IntPtr(h.ToInt64() == 111 ? 101 : 202); }
  public static IntPtr Focus(uint thread) { return ZeroFocus ? IntPtr.Zero : new IntPtr(thread == 7 ? (ForeignFocus ? 222 : 111) : thread == 8 ? 222 : 0); }
  static void Set(uint thread, long hkl) { State[thread] = hkl; W32.Trace("layout-state:" + thread + ":" + hkl); }
  public static long Read(uint thread) {
    Reads++;
    if (FocusDriftAt > 0 && Reads == FocusDriftAt) { W32.Foreground = 202; W32.Trace("layout-focus-drift:B"); }
    if (ReplaceAt > 0 && Reads == ReplaceAt) { Props[ReplaceHwnd].Clear(); W32.Trace("layout-input-replaced:" + ReplaceHwnd); }
    if (LateDue.ContainsKey(thread) && Reads >= LateDue[thread]) { LateDue.Remove(thread); Set(thread, Late[thread]); }
    if (ZeroHkl && (thread == 9 || thread == 19)) return 0;
    return State.ContainsKey(thread) ? State[thread] : 0;
  }
  public static bool Post(IntPtr h, uint msg, IntPtr w, IntPtr l) {
    long hkl = l.ToInt64(); W32.Trace("layout-request:" + h.ToInt64() + ":" + msg + ":" + hkl);
    if (msg != 0x50 || !Has(h)) return false;
    uint t = Thread(h);
    var modes = Initial.ContainsKey(t) && hkl == Initial[t] ? Restore : Request;
    string mode = modes.ContainsKey(t) ? modes[t] : "apply";
    if (mode == "reject") return false;
    if (mode == "driver") Set(99, hkl);
    else if (mode == "outer") Set(t == 9 ? 7u : 8u, hkl);
    else if (mode == "variant") Set(t, (hkl & 0xFFFF) | 0xF0220000L);
    else if (mode == "late") { Late[t] = hkl; LateDue[t] = Reads + LateReads; }
    else if (mode != "noop") Set(t, hkl);
    return true;
  }
  public static IntPtr LoadLayout(string klid, uint flags) {
    W32.Trace("layout-load:" + klid + ":" + flags);
    return new IntPtr(Load.TryGetValue(klid.ToUpperInvariant(), out var v) ? v : 0);
  }
  public static IntPtr GetProp(IntPtr h, string key) { var p = Props[h.ToInt64()]; return p.ContainsKey(key) ? p[key] : IntPtr.Zero; }
  public static bool SetProp(IntPtr h, string key, IntPtr value) { Props[h.ToInt64()][key] = value; W32.Trace("layout-pin:" + h.ToInt64()); return true; }
  public static IntPtr RemoveProp(IntPtr h, string key) { var v = GetProp(h, key); Props[h.ToInt64()].Remove(key); W32.Trace("layout-unpin:" + h.ToInt64()); return v; }
}
public static partial class W32 {
  public static IntPtr FocusWindow(uint thread) { return LayoutFake.Active ? LayoutFake.Focus(thread) : new IntPtr(thread == 7 ? 101 : thread == 8 ? 202 : 0); }
  public static bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l) { return LayoutFake.Post(h, msg, w, l); }
  public static IntPtr LoadKeyboardLayout(string klid, uint flags) { return LayoutFake.LoadLayout(klid, flags); }
  public static bool UnloadKeyboardLayout(IntPtr hkl) { Trace("layout-unload:" + hkl.ToInt64()); return true; }
  public static IntPtr[] LayoutList() {
    Trace("layout-list"); var r = new IntPtr[LayoutFake.List.Count];
    for (int i = 0; i < r.Length; i++) r[i] = new IntPtr(LayoutFake.List[i]);
    return r;
  }
}
`;
