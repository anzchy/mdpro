import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const WINDOWS = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/windows");

const fakeW32 = `Add-Type @"
using System;
using System.IO;
using System.Text.Json;
public static class W32 {
  public struct RECT { public int L, T, R, B; }
  public struct POINT { public int X, Y; }
  public static System.Collections.Generic.Dictionary<string, IntPtr> Props = new System.Collections.Generic.Dictionary<string, IntPtr>();
  public static IntPtr GetProp(IntPtr h, string key) { return !NativeStale && Props.ContainsKey(key) ? Props[key] : IntPtr.Zero; }
  public static bool SetProp(IntPtr h, string key, IntPtr value) { Props[key] = value; Trace("property:pin"); return true; }
  public static IntPtr RemoveProp(IntPtr h, string key) { Trace("property:remove"); if (FailRemoveProp) return IntPtr.Zero; var value = GetProp(h, key); Props.Remove(key); return value; }
  public static bool FailRemoveProp, RectChangesAfterPin;
  public static int RectCalls, ForegroundCalls, HklCalls, SendCalls, LogicalCalls, MouseCalls, ThreadCalls, ProcessCalls;
  public static int CursorX, CursorY, SetCursorCalls, HitCalls, SleepCalls;
  public static int RectChangeAt, ForegroundChangeAt, HklChangeAt, ShortSendAt, ThrowSendAt, ThrowReleaseAt, ThreadChangeAt, WrongExeAt, FocusChangesAfterMouseDownAt;
  public static int DriftX, DriftY, HitChangeAt, OverlayAtRectCall, FailSetCursorAt;
  public static int InitialForeground;
  public static bool RefuseFocus, IgnoreFocus, DriftDuringFocusWait, OverlayAtPointValidation;
  public static bool DriftDuringWait, DriftAfterMouseDownToB, OverlayAtA, OverlayAfterMouseDown, StaleAfterMouseDown, NativeStale, FailCursorRead, NullHit, NullRoot, FailPopupThread, PopupBSharedThread, SecondMdpro;
  public static int DriftAtSleep;
  public static string PopupAtItem = "";
  public static string HeldRecipient = "";
  public static bool FocusChangesAfterLogicalDown, FocusChangesAfterMouseDown;
  public static long Foreground = 101;
  public static string TracePath;
  public static void Configure(string json, string tracePath) {
    TracePath = tracePath;
    var root = JsonDocument.Parse(json).RootElement;
    int number(string name) => root.TryGetProperty(name, out var v) ? v.GetInt32() : 0;
    bool flag(string name) => root.TryGetProperty(name, out var v) && v.GetBoolean();
    RectChangeAt = number("rectChangeAt"); ForegroundChangeAt = number("foregroundChangeAt");
    HklChangeAt = number("hklChangeAt"); ShortSendAt = number("shortSendAt");
    ThrowSendAt = number("throwSendAt"); ThrowReleaseAt = number("throwReleaseAt");
    ThreadChangeAt = number("threadChangeAt"); WrongExeAt = number("wrongExeAt");
    FocusChangesAfterMouseDownAt = number("focusChangesAfterMouseDownAt");
    FocusChangesAfterLogicalDown = flag("focusChangesAfterLogicalDown");
    FocusChangesAfterMouseDown = flag("focusChangesAfterMouseDown");
    DriftDuringWait = flag("driftDuringWait"); DriftAtSleep = number("driftAtSleep"); DriftX = number("driftX"); DriftY = number("driftY");
    OverlayAtA = flag("overlayAtA"); HitChangeAt = number("hitChangeAt"); OverlayAtRectCall = number("overlayAtRectCall");
    OverlayAfterMouseDown = flag("overlayAfterMouseDown"); PopupBSharedThread = flag("popupBSharedThread");
    OverlayAtPointValidation = flag("overlayAtPointValidation");
    FailRemoveProp = flag("failRemoveProp"); RectChangesAfterPin = flag("rectChangesAfterPin");
    StaleAfterMouseDown = flag("staleAfterMouseDown");
    DriftAfterMouseDownToB = flag("driftAfterMouseDownToB");
    SecondMdpro = flag("secondMdpro");
    FailSetCursorAt = number("failSetCursorAt"); FailCursorRead = flag("failCursorRead");
    NullHit = flag("nullHit"); NullRoot = flag("nullRoot"); FailPopupThread = flag("failPopupThread");
    PopupAtItem = root.TryGetProperty("popupAtItem", out var popup) ? popup.GetString() ?? "" : "";
    InitialForeground = number("initialForeground");
    if (InitialForeground != 0) Foreground = InitialForeground;
    RefuseFocus = flag("refuseFocus"); IgnoreFocus = flag("ignoreFocus");
    DriftDuringFocusWait = flag("driftDuringFocusWait");
  }
  static void Trace(string s) { File.AppendAllText(TracePath, s + "\\n"); }
  public static bool SetProcessDPIAware() { return true; }
  public static bool IsWindowVisible(IntPtr h) { return h.ToInt64() == 101 || SecondMdpro && h.ToInt64() == 202; }
  public static uint GetWindowThreadProcessId(IntPtr h, out uint pid) {
    ThreadCalls++;
    if (h.ToInt64() == 302) { pid = PopupBSharedThread ? 11u : 22u; return FailPopupThread ? 0u : PopupBSharedThread ? 7u : 8u; }
    if (h.ToInt64() == 301) { pid = 11; return FailPopupThread ? 0u : 7u; }
    pid = NativeStale || ThreadChangeAt > 0 && ThreadCalls >= ThreadChangeAt ? 22u : 11u;
    return h.ToInt64() == 101 ? 7u : h.ToInt64() == 202 && SecondMdpro ? 8u : 0u;
  }
  public static string ProcessPath() {
    ProcessCalls++;
    return WrongExeAt > 0 && ProcessCalls >= WrongExeAt ? "C:\\\\Other\\\\tauri-app.exe" : "D:\\\\programs\\\\mdpro\\\\tauri-app.exe";
  }
  public static bool GetWindowRect(IntPtr h, out RECT r) {
    RectCalls++;
    if (OverlayAtRectCall > 0 && RectCalls >= OverlayAtRectCall) OverlayAtA = true;
    int x = RectChangesAfterPin && Props.Count > 0 || RectChangeAt > 0 && RectCalls >= RectChangeAt ? 1 : 0;
    r = h.ToInt64() == 202
      ? new RECT { L = 900, T = 0, R = 1700, B = 600 }
      : new RECT { L = x, T = 0, R = 800 + x, B = 600 };
    Trace("observe:rect:" + RectCalls + ":" + x);
    return true;
  }
  public static IntPtr GetForegroundWindow() {
    ForegroundCalls++;
    if (ForegroundChangeAt > 0 && ForegroundCalls >= ForegroundChangeAt) Foreground = 202;
    Trace("observe:foreground:" + ForegroundCalls + ":" + Foreground);
    return new IntPtr(Foreground);
  }
  public static string Title(IntPtr h) {
    var titlePath = Environment.GetEnvironmentVariable("MDPRO_TEST_TITLE");
    return h.ToInt64() == 202 ? "mdpro B" : titlePath != null ? File.ReadAllText(titlePath) : "mdpro";
  }
  public static IntPtr GetKeyboardLayout(uint threadId) {
    HklCalls++;
    long value = threadId == 0 || (HklChangeAt > 0 && HklCalls >= HklChangeAt) ? 0x04090409 : 0x04070407;
    Trace("observe:hkl:" + HklCalls + ":" + threadId + ":" + value);
    return new IntPtr(value);
  }
  public static void keybd_event(byte key, byte scan, uint flags, UIntPtr extra) {
    LogicalCalls++; Trace("key:" + key + ":" + flags);
    Trace("key-target:" + (Foreground == 101 ? "A" : "B") + ":" + key + ":" + flags);
    Trace((key == 18 ? "focus:" : "logical:") + key + ":" + flags);
    if (key == 18 && flags == 2 && Foreground != 101) Trace("effect:B");
    if (FocusChangesAfterLogicalDown && flags == 0) Foreground = 202;
  }
  public static uint SendScan(ushort scan, bool up, bool extended) {
    SendCalls++; Trace("scan:" + scan + ":" + up + ":" + extended);
    if (up && ThrowReleaseAt == SendCalls) throw new Exception("injected release exception");
    if (ThrowSendAt == SendCalls) throw new Exception("injected send exception");
    return ShortSendAt == SendCalls ? 0u : 1u;
  }
  public static void mouse_event(uint flags, int x, int y, uint data, UIntPtr extra) {
    MouseCalls++; Trace("mouse:" + flags);
    string recipient = HitRecipient();
    Trace("mouse-target:" + recipient + ":" + flags);
    if (flags == 2 || flags == 8) HeldRecipient = recipient;
    if ((flags == 2 || flags == 8) && OverlayAfterMouseDown) OverlayAtA = true;
    if ((flags == 2 || flags == 8) && StaleAfterMouseDown) NativeStale = true;
    if ((flags == 2 || flags == 8) && DriftAfterMouseDownToB) { CursorX = 950; CursorY = 100; Trace("drift:950:100"); }
    if (flags == 4 || flags == 16) {
      if (HeldRecipient == recipient && recipient == "B") Trace("effect:B");
      if (HeldRecipient == recipient && recipient == "A") Trace("effect:A");
      HeldRecipient = "";
      if (CursorX == 100 && CursorY == 100 && PopupAtItem == "") PopupAtItem = "A";
    }
    if ((FocusChangesAfterMouseDown || (FocusChangesAfterMouseDownAt > 0 && MouseCalls == FocusChangesAfterMouseDownAt)) &&
        (flags == 2 || flags == 8)) Foreground = 202;
  }
  static string HitRecipient() {
    if (OverlayAtA || NativeStale || CursorX >= 900 || PopupAtItem == "B" && CursorX == 150 && CursorY == 150) return "B";
    return "A";
  }
  public static bool SetCursorPos(int x, int y) {
    SetCursorCalls++; Trace("cursor:" + x + ":" + y);
    if (FailSetCursorAt > 0 && SetCursorCalls >= FailSetCursorAt) return false;
    CursorX = x; CursorY = y; return true;
  }
  public static bool GetCursorPos(out POINT point) {
    if (OverlayAtPointValidation) OverlayAtA = true;
    Trace("observe:cursor:" + CursorX + ":" + CursorY);
    point = new POINT { X = CursorX, Y = CursorY }; return !FailCursorRead;
  }
  public static IntPtr WindowFromPoint(POINT point) {
    HitCalls++;
    if (HitChangeAt > 0 && HitCalls >= HitChangeAt) OverlayAtA = true;
    if (NullHit) return IntPtr.Zero;
    if (OverlayAtA) return new IntPtr(202);
    if (point.X == 150 && point.Y == 150 && PopupAtItem != "") return new IntPtr(PopupAtItem == "A" ? 301 : 302);
    return new IntPtr(NativeStale ? 101 : HitRecipient() == "A" ? 101 : 202);
  }
  public static IntPtr GetAncestor(IntPtr h, uint mode) { return NullRoot ? IntPtr.Zero : h; }
  public static string ClassName(IntPtr h) { return h.ToInt64() == 301 || h.ToInt64() == 302 ? "#32768" : "mdpro"; }
  public static IntPtr MenuOwner(uint threadId) { return new IntPtr(PopupAtItem == "B" ? 202 : 101); }
  public static IntPtr GetMenu(IntPtr h) { return new IntPtr(400); }
  public static int GetMenuItemCount(IntPtr m) { return 1; }
  public static string Item(IntPtr m, int index) { return m.ToInt64() == 400 ? "File" : "Save"; }
  public static IntPtr GetSubMenu(IntPtr m, int index) { return m.ToInt64() == 400 ? new IntPtr(401) : IntPtr.Zero; }
  public static bool GetMenuItemRect(IntPtr owner, IntPtr menu, uint index, out RECT r) {
    r = menu.ToInt64() == 400
      ? new RECT { L = 90, T = 90, R = 110, B = 110 }
      : new RECT { L = 140, T = 140, R = 160, B = 160 };
    return true;
  }
  public static void Sleep(int ms) {
    SleepCalls++;
    if (DriftDuringFocusWait && ms == 250) { Foreground = 202; Trace("focus-drift:B"); }
    if (DriftDuringWait && ms >= 120 && (DriftAtSleep == 0 || SleepCalls == DriftAtSleep)) {
      CursorX = DriftX; CursorY = DriftY; Trace("drift:" + CursorX + ":" + CursorY);
    }
  }
  public static bool SetForegroundWindow(IntPtr h) {
    Trace("focus-request:" + h.ToInt64());
    if (RefuseFocus) return false;
    if (!IgnoreFocus) Foreground = h.ToInt64();
    return true;
  }
  public static bool ShowWindow(IntPtr h, int command) { return true; }
}
"@`;

export interface NativeScenario {
  initialForeground?: number;
  refuseFocus?: boolean;
  ignoreFocus?: boolean;
  driftDuringFocusWait?: boolean;
  rectChangeAt?: number;
  foregroundChangeAt?: number;
  hklChangeAt?: number;
  shortSendAt?: number;
  throwSendAt?: number;
  throwReleaseAt?: number;
  threadChangeAt?: number;
  wrongExeAt?: number;
  focusChangesAfterMouseDownAt?: number;
  focusChangesAfterLogicalDown?: boolean;
  focusChangesAfterMouseDown?: boolean;
  driftDuringWait?: boolean;
  driftAtSleep?: number;
  driftX?: number;
  driftY?: number;
  overlayAtA?: boolean;
  overlayAtRectCall?: number;
  overlayAfterMouseDown?: boolean;
  overlayAtPointValidation?: boolean;
  staleAfterMouseDown?: boolean;
  driftAfterMouseDownToB?: boolean;
  secondMdpro?: boolean;
  hitChangeAt?: number;
  popupAtItem?: "A" | "B";
  failSetCursorAt?: number;
  failCursorRead?: boolean;
  nullHit?: boolean;
  nullRoot?: boolean;
  failPopupThread?: boolean;
  popupBSharedThread?: boolean;
  failRemoveProp?: boolean;
  rectChangesAfterPin?: boolean;
}

export async function prepareNative(
  // The scenario and options reach the script through runNative's environment, not this text.
  steps: unknown[], _scenario: NativeScenario = {}, _options: { cdpPort?: number; titlePath?: string } = {},
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mdpro-native-dispatch-"));
  let source = await readFile(path.join(WINDOWS, "ui.ps1"), "utf8");
  for (const file of ["native-platform.ps1", "native-runtime.ps1", "native-window.ps1", "native-input.ps1", "native-ops.ps1"]) {
    const helper = await readFile(path.join(WINDOWS, file), "utf8");
    source = source.replace(`. "$PSScriptRoot\\${file}"`, () => helper);
  }
  const platformStart = source.indexOf("Add-Type -AssemblyName UIAutomationClient");
  const platformEnd = source.indexOf("[void][W32]::SetProcessDPIAware()");
  if (platformStart < 0 || platformEnd < 0) throw new Error("native driver prelude changed");
  let script = source.slice(0, platformStart) + fakeW32 + "\n" + source.slice(platformEnd);
  script = script.replace("$AE = [System.Windows.Automation.AutomationElement]", "$AE = $null")
    .replace("$TS = [System.Windows.Automation.TreeScope]", "$TS = $null")
    .replaceAll("$PSScriptRoot\\window-binding.mjs", path.join(WINDOWS, "window-binding.mjs"))
    .replaceAll("$PSScriptRoot\\physical-chord.mjs", path.join(WINDOWS, "physical-chord.mjs"))
    .replaceAll("$PSScriptRoot\\cdp.mjs", path.join(WINDOWS, "cdp.mjs"));
  const fixture = `
[W32]::Configure($env:MDPRO_TEST_SCENARIO, $env:MDPRO_TEST_TRACE)
function MdproWindows {
  [IO.File]::AppendAllText($env:MDPRO_TEST_TRACE, "boundary:uia\n")
  [pscustomobject]@{ Current = [pscustomobject]@{ NativeWindowHandle = 101; ProcessId = 11 } }
  if ([W32]::SecondMdpro) { [pscustomobject]@{ Current = [pscustomobject]@{ NativeWindowHandle = 202; ProcessId = 11 } } }
}
function Get-Process { param($Id, $ErrorAction) return [pscustomobject]@{ Path = [W32]::ProcessPath(); Id = 11; StartTime = [datetime]"2026-01-01T00:00:00Z" } }
function Start-Sleep { param($Milliseconds) [W32]::Sleep([int]$Milliseconds) }
`;
  script = script.replace("$failed = $false; $n = 0", fixture + "\n$failed = $false; $n = 0");
  const scriptPath = path.join(dir, "ui-test.ps1");
  const stepsPath = path.join(dir, "steps.json");
  const outPath = path.join(dir, "out.json");
  const tracePath = path.join(dir, "trace.txt");
  await Promise.all([
    writeFile(scriptPath, script), writeFile(stepsPath, JSON.stringify(steps)), writeFile(tracePath, ""),
  ]);
  return { dir, scriptPath, stepsPath, outPath, tracePath };
}

export async function runNative(
  steps: unknown[], scenario: NativeScenario = {}, options: { cdpPort?: number; titlePath?: string } = {},
): Promise<{ status: number | null; log: string[]; trace: string[]; stderr: string }> {
  const { scriptPath, stepsPath, outPath, tracePath } = await prepareNative(steps, scenario, options);
  const result = await new Promise<{ status: number | null; stderr: string }>((done) => {
    const child = spawn("pwsh", ["-NoProfile", "-File", scriptPath, "-Steps", stepsPath, "-Out", outPath], {
      env: { ...process.env, MDPRO_TEST_SCENARIO: JSON.stringify(scenario), MDPRO_TEST_TRACE: tracePath,
        MDPRO_TEST_TITLE: options.titlePath, MDPRO_CDP_PORT: options.cdpPort?.toString() },
    });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += String(data); });
    child.on("close", (status) => done({ status, stderr }));
  });
  const log = JSON.parse(await readFile(outPath, "utf8")) as string | string[];
  const trace = (await readFile(tracePath, "utf8")).split("\n").filter(Boolean);
  return { ...result, log: Array.isArray(log) ? log : [log], trace };
}
