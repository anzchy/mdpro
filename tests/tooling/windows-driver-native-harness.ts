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
  public static int RectCalls, ForegroundCalls, HklCalls, SendCalls, LogicalCalls, MouseCalls, ThreadCalls, ProcessCalls;
  public static int RectChangeAt, ForegroundChangeAt, HklChangeAt, ShortSendAt, ThrowSendAt, ThrowReleaseAt, ThreadChangeAt, WrongExeAt, FocusChangesAfterMouseDownAt;
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
  }
  static void Trace(string s) { File.AppendAllText(TracePath, s + "\\n"); }
  public static bool SetProcessDPIAware() { return true; }
  public static bool IsWindowVisible(IntPtr h) { return h.ToInt64() == 101; }
  public static uint GetWindowThreadProcessId(IntPtr h, out uint pid) {
    ThreadCalls++; pid = ThreadChangeAt > 0 && ThreadCalls >= ThreadChangeAt ? 22u : 11u;
    return h.ToInt64() == 101 ? 7u : 0u;
  }
  public static string ProcessPath() {
    ProcessCalls++;
    return WrongExeAt > 0 && ProcessCalls >= WrongExeAt ? "C:\\\\Other\\\\tauri-app.exe" : "D:\\\\programs\\\\mdpro\\\\tauri-app.exe";
  }
  public static bool GetWindowRect(IntPtr h, out RECT r) {
    RectCalls++;
    int x = RectChangeAt > 0 && RectCalls >= RectChangeAt ? 1 : 0;
    r = new RECT { L = x, T = 0, R = 800 + x, B = 600 };
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
    return titlePath != null ? File.ReadAllText(titlePath) : "mdpro";
  }
  public static IntPtr GetKeyboardLayout(uint threadId) {
    HklCalls++;
    long value = threadId == 0 || (HklChangeAt > 0 && HklCalls >= HklChangeAt) ? 0x04090409 : 0x04070407;
    Trace("observe:hkl:" + HklCalls + ":" + threadId + ":" + value);
    return new IntPtr(value);
  }
  public static void keybd_event(byte key, byte scan, uint flags, UIntPtr extra) {
    LogicalCalls++; Trace("logical:" + key + ":" + flags);
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
    if ((FocusChangesAfterMouseDown || (FocusChangesAfterMouseDownAt > 0 && MouseCalls == FocusChangesAfterMouseDownAt)) &&
        (flags == 2 || flags == 8)) Foreground = 202;
  }
  public static bool SetCursorPos(int x, int y) { Trace("cursor:" + x + ":" + y); return true; }
  public static bool SetForegroundWindow(IntPtr h) { Foreground = h.ToInt64(); return true; }
  public static bool ShowWindow(IntPtr h, int command) { return true; }
}
"@`;

export interface NativeScenario {
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
}

export async function runNative(
  steps: unknown[], scenario: NativeScenario = {}, options: { cdpPort?: number; titlePath?: string } = {},
): Promise<{ status: number | null; log: string[]; trace: string[]; stderr: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mdpro-native-dispatch-"));
  const source = await readFile(path.join(WINDOWS, "ui.ps1"), "utf8");
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
function MdproWindows { return ,([pscustomobject]@{ Current = [pscustomobject]@{ NativeWindowHandle = 101; ProcessId = 11 } }) }
function Get-Process { param($Id, $ErrorAction) return [pscustomobject]@{ Path = [W32]::ProcessPath(); Id = 11 } }
function Start-Sleep { param($Milliseconds) }
`;
  script = script.replace("$failed = $false; $n = 0", fixture + "\n$failed = $false; $n = 0");
  const scriptPath = path.join(dir, "ui-test.ps1");
  const stepsPath = path.join(dir, "steps.json");
  const outPath = path.join(dir, "out.json");
  const tracePath = path.join(dir, "trace.txt");
  await Promise.all([
    writeFile(scriptPath, script), writeFile(stepsPath, JSON.stringify(steps)), writeFile(tracePath, ""),
  ]);
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
