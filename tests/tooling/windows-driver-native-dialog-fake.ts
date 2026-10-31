// C# double for the Win32 surface of a common file dialog (D336), compiled into the native
// harness's partial W32 class. Inert unless the scenario has `dialogs`. A dialog opens either at
// start, at the end of a logical chord (ctrl key-up) or on the menu item's mouse-up, and an Enter
// or Esc key-up while it is foreground dismisses it.
export interface FakeDialogControl { hwnd: number; className: string; id: number; parent?: number; visible?: boolean }
export interface FakeDialog {
  hwnd: number; owner: number; title?: string; className?: string; visible?: boolean; pid?: number;
  controls: FakeDialogControl[];
}
export interface DialogScenario {
  dialogs?: FakeDialog[];
  dialogOpensOn?: "start" | "chord" | "menu";
  dialogForeground?: number;
  /** Enter/Esc reach the dialog but it stays open (an overwrite prompt, a refused name). */
  dialogStaysOpen?: boolean;
  /** The foreground moves to this HWND right after a path write reaches a control. */
  dialogForegroundAfterWrite?: number;
  /**
   * The window `dialogReplaceHwnd` (a dialog, with its controls, or one control) is destroyed and
   * a new one takes the same HWND: its window properties are gone, every other observation is the
   * same. `after-pin` fires at the first foreground read after that window is pinned,
   * `after-write` right after a path write, `on-submit` on the Enter or Esc key-up.
   */
  dialogReplace?: "after-pin" | "after-write" | "on-submit";
  dialogReplaceHwnd?: number;
  /** A further dialog that opens right after a path write. */
  dialogAddAfterWrite?: FakeDialog;
  /** Window properties A already carries when this invocation starts (a pin from an earlier run). */
  ownerProps?: Record<string, string>;
  /** UIA lists each open dialog as a top-level window of mdpro's process, beside its owner. */
  dialogInUiaRoot?: boolean;
}

export const dialogFakeSource = String.raw`
public static class DialogFake {
  public class Ctl { public long Hwnd, Parent; public string Cls = "Edit"; public int Id; public bool Visible = true; public string Text = "";
    public System.Collections.Generic.Dictionary<string, IntPtr> Props = new System.Collections.Generic.Dictionary<string, IntPtr>(); }
  public class Dlg { public long Hwnd, Owner; public string Cls = "", Title = ""; public bool Visible = true; public uint Pid = 11;
    public System.Collections.Generic.List<Ctl> Controls = new System.Collections.Generic.List<Ctl>();
    public System.Collections.Generic.Dictionary<string, IntPtr> Props = new System.Collections.Generic.Dictionary<string, IntPtr>(); }
  public static System.Collections.Generic.List<Dlg> Open = new System.Collections.Generic.List<Dlg>(), Pending = new System.Collections.Generic.List<Dlg>();
  public static string OpensOn = "start", Replace = ""; public static long OpenForeground, ForegroundAfterWrite, ReplaceHwnd; public static bool StaysOpen, Pinned, Replaced;
  public static Dlg Added; public static bool InUiaRoot;
  public static void Configure(System.Text.Json.JsonElement root) {
    InUiaRoot = root.TryGetProperty("dialogInUiaRoot", out var uia) && uia.GetBoolean();
    if (root.TryGetProperty("ownerProps", out var op)) foreach (var x in op.EnumerateObject()) W32.Props[x.Name] = new IntPtr(long.Parse(x.Value.GetString()));
    if (!root.TryGetProperty("dialogs", out var list)) return;
    if (root.TryGetProperty("dialogOpensOn", out var on)) OpensOn = on.GetString();
    if (root.TryGetProperty("dialogForeground", out var fg)) OpenForeground = fg.GetInt64();
    StaysOpen = root.TryGetProperty("dialogStaysOpen", out var so) && so.GetBoolean();
    if (root.TryGetProperty("dialogForegroundAfterWrite", out var faw)) ForegroundAfterWrite = faw.GetInt64();
    if (root.TryGetProperty("dialogReplace", out var rp)) Replace = rp.GetString();
    if (root.TryGetProperty("dialogReplaceHwnd", out var rh)) ReplaceHwnd = rh.GetInt64();
    if (root.TryGetProperty("dialogAddAfterWrite", out var add)) Added = Parse(add);
    foreach (var d in list.EnumerateArray()) (OpensOn == "start" ? Open : Pending).Add(Parse(d));
    if (OpensOn == "start" && OpenForeground != 0) W32.Foreground = OpenForeground;
  }
  static Dlg Parse(System.Text.Json.JsonElement d) {
      var dlg = new Dlg { Hwnd = d.GetProperty("hwnd").GetInt64(), Owner = d.GetProperty("owner").GetInt64(),
        Cls = d.TryGetProperty("className", out var c) ? c.GetString() : "#" + "32770",
        Title = d.TryGetProperty("title", out var t) ? t.GetString() : "Open",
        Visible = !d.TryGetProperty("visible", out var v) || v.GetBoolean(),
        Pid = d.TryGetProperty("pid", out var p) ? p.GetUInt32() : 11u };
      foreach (var x in d.GetProperty("controls").EnumerateArray()) dlg.Controls.Add(new Ctl {
        Hwnd = x.GetProperty("hwnd").GetInt64(), Cls = x.GetProperty("className").GetString(), Id = x.GetProperty("id").GetInt32(),
        Parent = x.TryGetProperty("parent", out var pa) ? pa.GetInt64() : dlg.Hwnd,
        Visible = !x.TryGetProperty("visible", out var cv) || cv.GetBoolean() });
      return dlg;
  }
  static System.Collections.Generic.Dictionary<string, IntPtr> PropsOf(IntPtr h) { var d = Find(h.ToInt64()); return d != null ? d.Props : Control(h.ToInt64()).Props; }
  public static IntPtr GetProp(IntPtr h, string key) { var p = PropsOf(h); return p.ContainsKey(key) ? p[key] : IntPtr.Zero; }
  public static bool SetProp(IntPtr h, string key, IntPtr value) {
    PropsOf(h)[key] = value; W32.Trace("dialog-pin:" + h.ToInt64()); if (h.ToInt64() == ReplaceHwnd) Pinned = true; return true;
  }
  public static IntPtr RemoveProp(IntPtr h, string key) { var p = PropsOf(h); var v = GetProp(h, key); p.Remove(key); W32.Trace("dialog-unpin:" + h.ToInt64()); return v; }
  // Destroy and re-create with the same HWND: the new window has none of the old one's properties.
  public static void ReplaceNow() {
    if (Replaced) return; Replaced = true;
    var d = Find(ReplaceHwnd);
    if (d != null) { d.Props.Clear(); foreach (var c in d.Controls) c.Props.Clear(); } else Control(ReplaceHwnd).Props.Clear();
    W32.Trace("dialog-replaced:" + ReplaceHwnd);
  }
  public static void BeforeForeground() { if (Replace == "after-pin" && Pinned) ReplaceNow(); }
  public static Dlg Find(long h) { foreach (var d in Open) if (d.Hwnd == h) return d; return null; }
  public static Ctl Control(long h) { foreach (var d in Open) foreach (var c in d.Controls) if (c.Hwnd == h) return c; return null; }
  public static bool Has(IntPtr h) { return Find(h.ToInt64()) != null || Control(h.ToInt64()) != null; }
  public static bool Visible(IntPtr h) { var d = Find(h.ToInt64()); return d != null ? d.Visible : Control(h.ToInt64()).Visible; }
  public static uint Pid(IntPtr h) { var d = Find(h.ToInt64()); return d != null ? d.Pid : 11u; }
  public static string Class(IntPtr h) { var d = Find(h.ToInt64()); return d != null ? d.Cls : Control(h.ToInt64()).Cls; }
  public static string Title(IntPtr h) { var d = Find(h.ToInt64()); return d != null ? d.Title : Control(h.ToInt64()).Text; }
  static void OpenPending(string route) {
    if (Pending.Count == 0 || OpensOn != route) return;
    Open.AddRange(Pending); Pending.Clear(); W32.Trace("dialog-open:" + route);
    if (OpenForeground != 0) W32.Foreground = OpenForeground;
  }
  public static void Key(byte key, uint flags) {
    W32.Trace("key-hwnd:" + W32.Foreground + ":" + key + ":" + flags);
    if (flags == 2 && key == 17) OpenPending("chord");
    var d = Find(W32.Foreground);
    if (d != null && flags == 2 && (key == 13 || key == 27)) {
      W32.Trace((key == 13 ? "dialog-submit:" : "dialog-cancel:") + d.Hwnd);
      if (Replace == "on-submit") ReplaceNow();
      else if (!StaysOpen) { Open.Remove(d); W32.Foreground = d.Owner; }
    }
  }
  public static void MouseUp(int x, int y) { if (x == 150 && y == 150) OpenPending("menu"); }
}
public static partial class W32 {
  public static IntPtr GetWindow(IntPtr h, uint cmd) { var d = DialogFake.Find(h.ToInt64()); return cmd == 4 && d != null ? new IntPtr(d.Owner) : IntPtr.Zero; }
  public static System.Collections.Generic.List<IntPtr> AllTops(uint pid) {
    var r = new System.Collections.Generic.List<IntPtr>();
    if (pid == 11) { r.Add(new IntPtr(101)); if (SecondMdpro) r.Add(new IntPtr(202)); }
    foreach (var d in DialogFake.Open) if (d.Pid == pid) r.Add(new IntPtr(d.Hwnd));
    return r;
  }
  public static System.Collections.Generic.List<IntPtr> Children(IntPtr h) {
    var r = new System.Collections.Generic.List<IntPtr>(); var d = DialogFake.Find(h.ToInt64());
    if (d != null) foreach (var c in d.Controls) r.Add(new IntPtr(c.Hwnd));
    return r;
  }
  public static int GetDlgCtrlID(IntPtr h) { var c = DialogFake.Control(h.ToInt64()); return c != null ? c.Id : 0; }
  public static IntPtr GetParent(IntPtr h) { var c = DialogFake.Control(h.ToInt64()); return c != null ? new IntPtr(c.Parent) : IntPtr.Zero; }
  public static IntPtr SendMessageW(IntPtr h, uint msg, IntPtr w, string text) {
    var c = DialogFake.Control(h.ToInt64());
    Trace("dialog-write:" + h.ToInt64() + ":" + msg + ":" + text);
    // A hung dialog: WM_SETTEXT is a cross-thread SendMessage that never returns.
    if (System.Environment.GetEnvironmentVariable("MDPRO_TEST_STALL") == "dialog-write") System.Threading.Thread.Sleep(60000);
    if (c != null && msg == 0x000C) c.Text = text;
    if (DialogFake.ForegroundAfterWrite != 0) W32.Foreground = DialogFake.ForegroundAfterWrite;
    if (DialogFake.Replace == "after-write") DialogFake.ReplaceNow();
    if (DialogFake.Added != null) { DialogFake.Open.Add(DialogFake.Added); DialogFake.Added = null; Trace("dialog-open:after-write"); }
    return new IntPtr(1);
  }
}
`;
