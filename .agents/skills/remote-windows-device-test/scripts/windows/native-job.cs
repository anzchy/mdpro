// Purpose: kernel job lifetime containment. Built by native-build.ps1 before transactions.
// No child executes input before job assignment; only explicit app launches may break away.
// Snapshot pins owned lifetimes through identity reads; ambiguous members remain explicitly alive.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public sealed class NativeJobMember {
  public int pid;
  public string birth;
  public string exe;
  public bool alive;
}
public sealed class NativeJobScope : IDisposable {
  IntPtr job;
  readonly List<IntPtr> unowned = new List<IntPtr>();
  public string Name;
  const uint ALL = 0x1F003F;
  const uint BOOTSTRAP_ACCESS = 5; // ASSIGN_PROCESS | QUERY
  [StructLayout(LayoutKind.Sequential)] struct SECURITY { public int length; public IntPtr descriptor; public int inherit; }
  static IntPtr CreateUserJob(string name) {
    using (var identity = System.Security.Principal.WindowsIdentity.GetCurrent()) {
      var descriptor = new System.Security.AccessControl.RawSecurityDescriptor("D:(A;;GA;;;" + identity.User.Value + ")(A;;GA;;;SY)(A;;GA;;;BA)");
      byte[] bytes = new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(bytes, 0);
      IntPtr data = Marshal.AllocHGlobal(bytes.Length), attributes = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY)));
      try {
        Marshal.Copy(bytes, 0, data, bytes.Length);
        Marshal.StructureToPtr(new SECURITY { length = Marshal.SizeOf(typeof(SECURITY)), descriptor = data }, attributes, false);
        IntPtr result = CreateJobObject(attributes, name); int error = Marshal.GetLastWin32Error();
        if (result == IntPtr.Zero) throw new Win32Exception(error);
        if (error == 183) { CloseHandle(result); throw new Exception("NATIVE_JOB_ALREADY_EXISTS"); }
        return result;
      } finally { Marshal.FreeHGlobal(attributes); Marshal.FreeHGlobal(data); }
    }
  }
  [StructLayout(LayoutKind.Sequential)] struct BASIC {
    public long ProcessTime, JobTime; public uint Flags; public UIntPtr Min, Max;
    public uint Active; public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED {
    public BASIC Basic; public IO Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUP {
    public uint cb; public string reserved, desktop, title;
    public uint x,y,xsize,ysize,xchars,ychars,fill,flags; public ushort show, reserved2;
    public IntPtr reservedPointer, stdin, stdout, stderr;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS { public IntPtr process, thread; public uint pid, tid; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attr, string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr h, int type, ref EXTENDED value, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr h, int type, IntPtr data, uint size, out uint used);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr h, uint code);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUP startup, out PROCESS process);
  static void Check(bool result) { if (!result) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  // ui-run passes the validated poll and the transaction's absolute cleanup deadline.
  static int PollMs() {
    string pollText = Environment.GetEnvironmentVariable("MDPRO_NATIVE_POLL_MS");
    int poll = String.IsNullOrEmpty(pollText) ? 25 : Int32.Parse(pollText);
    if (poll < 1 || poll > 1000) throw new Exception("NATIVE_BUDGET_INVALID");
    return poll;
  }
  static long CleanupDeadline(long now) {
    string endText = Environment.GetEnvironmentVariable("MDPRO_NATIVE_CLEANUP_DEADLINE_MS");
    return String.IsNullOrEmpty(endText) ? now + 5000 : Int64.Parse(endText);
  }
  static bool DrainProcess(IntPtr process, uint code) {
    // Termination is asynchronous. Poll the pinned handle with the caller's bounded
    // cleanup reservation rather than assuming that a fixed 100 ms is sufficient.
    int poll = PollMs();
    long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    long end = CleanupDeadline(now);
    if (!TerminateProcess(process, code)) return false;
    while ((now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) < end) {
      uint wait = WaitForSingleObject(process, (uint)Math.Min(poll, end - now));
      if (wait == 0) return true;
      if (wait != 258) return false;
    }
    return false;
  }
  static void ValidName(string name) {
    if (!System.Text.RegularExpressions.Regex.IsMatch(name, @"^Global\\mdpro-driver-[a-f0-9]{32}$")) throw new ArgumentException("NATIVE_JOB_NAME_INVALID");
  }
  public NativeJobScope(string name) : this(name, true) { }
  public NativeJobScope(string name, bool allowAppBreakaway) {
    ValidName(name); Name = name;
    job = CreateUserJob(name);
    EXTENDED limits = new EXTENDED();
    // The trusted worker may explicitly launch the app; arbitrary helpers get a nested
    // non-breakaway job, so their detached or CREATE_BREAKAWAY descendants stay owned.
    limits.Basic.Flags = 0x2000 | (allowAppBreakaway ? 0x800u : 0u);
    try { Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(EXTENDED)))); }
    catch { Dispose(); throw; }
  }
  public NativeJobMember[] Snapshot() {
    if (unowned.Count != 0) throw new Exception("NATIVE_UNOWNED_CHILD_CLEANUP_FAILED");
    IntPtr buffer = Marshal.AllocHGlobal(65536);
    try {
      uint used; Check(QueryInformationJobObject(job, 3, buffer, 65536, out used));
      int assigned = Marshal.ReadInt32(buffer, 0), count = Marshal.ReadInt32(buffer, 4);
      if (assigned != count || count < 0 || count > 8000) throw new Exception("NATIVE_JOB_MEMBERSHIP_INCOMPLETE");
      List<NativeJobMember> members = new List<NativeJobMember>();
      for (int i = 0; i < count; i++) {
        int pid = IntPtr.Size == 8 ? checked((int)Marshal.ReadInt64(buffer, 8 + i * 8)) : Marshal.ReadInt32(buffer, 8 + i * 4);
        Process p = null; IntPtr pinned = IntPtr.Zero; bool owned = false;
        try {
          p = Process.GetProcessById(pid); pinned = p.Handle;
          bool member; Check(IsProcessInJob(pinned, job, out member));
          if (!member) continue; // independently proved replacement lifetime
          owned = true;
          var identity = new NativeJobMember { pid = pid, birth = p.StartTime.ToUniversalTime().Ticks.ToString(), exe = p.MainModule.FileName };
          members.Add(identity); // complete identity remains judgeable even if it exits next
        } catch (ArgumentException e) {
          // GetProcessById's not-found is positive absence; a later identity error is not.
          if (p != null) members.Add(new NativeJobMember { pid = pid, birth = "", exe = "unreadable: " + e.Message, alive = true });
        } catch (Exception e) {
          // Only this same, independently owned lifetime's signaled handle proves exit.
          if (owned && pinned != IntPtr.Zero && WaitForSingleObject(pinned, 0) == 0) continue;
          members.Add(new NativeJobMember { pid = pid, birth = "", exe = "unreadable: " + e.GetType().Name + ": " + e.Message, alive = true });
        } finally { if (p != null) p.Dispose(); }
      }
      return members.ToArray();
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  public void Stop() {
    bool stopped = TerminateJobObject(job, 124);
    int error = Marshal.GetLastWin32Error();
    for (int i = unowned.Count - 1; i >= 0; i--) {
      IntPtr process = unowned[i];
      if (DrainProcess(process, 124)) {
        CloseHandle(process); unowned.RemoveAt(i);
      }
    }
    if (!stopped) throw new Exception("NATIVE_JOB_STOP_FAILED win32=" + error);
    if (unowned.Count != 0) throw new Exception("NATIVE_UNOWNED_CHILD_CLEANUP_FAILED");
  }
  public Process StartOwned(string exe, string arguments) {
    PROCESS child = Launch(exe, arguments, 0); bool resumed = false; Process process = null;
    try {
      Check(AssignProcessToJobObject(job, child.process));
      process = Process.GetProcessById((int)child.pid);
      IntPtr pinnedHandle = process.Handle; // open the managed lifetime handle before resume
      if (ResumeThread(child.thread) == 0xFFFFFFFF) throw new Win32Exception(Marshal.GetLastWin32Error());
      resumed = true; return process;
    } finally {
      bool abandoned = false;
      if (!resumed) {
        // Assignment can fail before the job owns this suspended child. Retain its exact
        // process handle when termination is unproved so cleanup cannot report an empty job.
        if (!DrainProcess(child.process, 1)) {
          unowned.Add(child.process); child.process = IntPtr.Zero; abandoned = true;
        }
        if (process != null) process.Dispose();
      }
      if (child.process != IntPtr.Zero) CloseHandle(child.process);
      CloseHandle(child.thread);
      if (abandoned) throw new Exception("NATIVE_UNOWNED_CHILD_CLEANUP_FAILED pid=" + child.pid + " exe=" + exe);
    }
  }
  public void Dispose() {
    if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
    foreach (IntPtr process in unowned) CloseHandle(process);
    unowned.Clear();
  }
  static PROCESS Launch(string exe, string arguments, uint flags) {
    STARTUP startup = new STARTUP(); startup.cb = (uint)Marshal.SizeOf(typeof(STARTUP));
    PROCESS process;
    Check(CreateProcess(exe, new StringBuilder("\"" + exe + "\" " + arguments), IntPtr.Zero, IntPtr.Zero, false, flags | 4, IntPtr.Zero, null, ref startup, out process));
    return process;
  }
  public static void RunHelper(string exe, string arguments, long deadline) {
    if (String.IsNullOrEmpty(Environment.GetEnvironmentVariable("MDPRO_NATIVE_JOB"))) throw new Exception("NATIVE_JOB_MISSING");
    int poll = PollMs(); // validated before any helper exists
    using (NativeJobScope helper = new NativeJobScope("Global\\mdpro-driver-" + Guid.NewGuid().ToString("N"), false)) {
      using (Process child = helper.StartOwned(exe, arguments)) {
        string failure = null, cleanup = null;
        try {
          while (!child.WaitForExit(poll)) {
            if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= deadline) { failure = "NATIVE_PHASE_TIMEOUT phase=run-helper"; break; }
          }
          if (failure == null && child.ExitCode != 0) failure = "NATIVE_HELPER_FAILED exit=" + child.ExitCode;
        } catch (Exception error) { failure = error.Message; }
        // Job termination is asynchronous: drain within the transaction's cleanup reservation,
        // not the phase deadline that may already have expired, and keep the failed phase first.
        try {
          helper.Stop();
          long end = CleanupDeadline(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
          while (helper.Snapshot().Length != 0) {
            if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= end) { cleanup = "NATIVE_HELPER_CLEANUP_FAILED"; break; }
            System.Threading.Thread.Sleep(poll);
          }
        } catch (Exception error) { cleanup = error.Message; }
        if (failure != null || cleanup != null) throw new Exception(failure == null ? cleanup : cleanup == null ? failure : failure + "; " + cleanup);
      }
    }
  }
  public static void LaunchApp(string exe, string arguments) {
    string name = Environment.GetEnvironmentVariable("MDPRO_NATIVE_JOB");
    if (String.IsNullOrEmpty(name)) throw new Exception("NATIVE_JOB_MISSING");
    ValidName(name);
    IntPtr h = OpenJobObject(ALL, false, name); Check(h != IntPtr.Zero);
    PROCESS child = new PROCESS(); bool resumed = false;
    try {
      child = Launch(exe, arguments, 0x1000000); // explicit CREATE_BREAKAWAY_FROM_JOB only here
      bool member; Check(IsProcessInJob(child.process, h, out member));
      if (member) throw new Exception("NATIVE_APP_BREAKAWAY_FAILED");
      if (ResumeThread(child.thread) == 0xFFFFFFFF) throw new Win32Exception(Marshal.GetLastWin32Error());
      resumed = true;
    } finally {
      bool cleanupFailed = false;
      if (child.process != IntPtr.Zero) { if (!resumed) cleanupFailed = !DrainProcess(child.process, 1); CloseHandle(child.process); }
      if (child.thread != IntPtr.Zero) CloseHandle(child.thread);
      CloseHandle(h);
      if (cleanupFailed) throw new Exception("NATIVE_APP_CLEANUP_FAILED");
    }
  }
  static string Json(string text) {
    var result = new StringBuilder("\"");
    foreach (char c in text) {
      if (c == '"' || c == '\\') result.Append('\\').Append(c);
      else if (c < 32) result.Append("\\u").Append(((int)c).ToString("x4"));
      else result.Append(c);
    }
    return result.Append('"').ToString();
  }
  static void BootstrapLog(string path, string name, string stage, bool created, bool resumed, uint? code, string error) {
    if (path == null) return;
    string record = "{\"runId\":" + Json(name.Substring(name.Length - 32)) + ",\"job\":" + Json(name) +
      ",\"stage\":" + Json(stage) + ",\"childCreated\":" + (created ? "true" : "false") +
      ",\"childResumed\":" + (resumed ? "true" : "false") + ",\"code\":" + (code.HasValue ? code.Value.ToString() : "null") +
      ",\"error\":" + Json(error) + "}\n";
    System.IO.File.AppendAllText(path, record, new UTF8Encoding(false));
  }
  public static int Main(string[] args) {
    // New calls are run-bound. Legacy inspection has no release proof and retains rc1 failures.
    if (args.Length != 3 && args.Length != 4) return 2;
    bool modern = args.Length == 4, completed = false, resumed = false;
    IntPtr h = IntPtr.Zero; PROCESS child = new PROCESS(); int rc = 1;
    string stage = "setup", log = null, failure = "";
    try {
      ValidName(args[0]);
      if (modern) {
        string dir = System.IO.Path.GetFullPath(args[3]);
        string run = args[0].Substring(args[0].Length - 32);
        if (dir != args[3] || System.IO.Path.GetFileName(dir) != run ||
            System.IO.Path.GetFileName(System.IO.Path.GetDirectoryName(dir)) != "runs" || !System.IO.Directory.Exists(dir))
          throw new Exception("NATIVE_BOOTSTRAP_RUN_INVALID");
        log = System.IO.Path.Combine(dir, "bootstrap.log");
      }
      stage = "open"; BootstrapLog(log, args[0], stage, false, false, null, "");
      h = OpenJobObject(BOOTSTRAP_ACCESS, false, args[0]); Check(h != IntPtr.Zero);
      stage = "assign";
      using (Process self = Process.GetCurrentProcess()) Check(AssignProcessToJobObject(h, self.Handle));
      Environment.SetEnvironmentVariable("MDPRO_NATIVE_JOB", args[0]);
      stage = "launch";
      child = Launch(args[1], Encoding.UTF8.GetString(Convert.FromBase64String(args[2])), 0);
      bool member; Check(IsProcessInJob(child.process, h, out member));
      if (!member) Check(AssignProcessToJobObject(h, child.process));
      if (ResumeThread(child.thread) == 0xFFFFFFFF) throw new Win32Exception(Marshal.GetLastWin32Error());
      resumed = true; CloseHandle(h); h = IntPtr.Zero;
      stage = "wait";
      if (WaitForSingleObject(child.process, 0xFFFFFFFF) != 0) throw new Exception("NATIVE_BOOTSTRAP_WAIT_FAILED");
      uint code; Check(GetExitCodeProcess(child.process, out code));
      completed = true; rc = unchecked((int)code); stage = "exited";
    } catch (Exception error) {
      failure = error.Message;
      rc = !modern ? 1 : stage == "open" || stage == "assign" ? 65 : stage == "launch" ? 66 : stage == "wait" ? 67 : 68;
      Console.Error.WriteLine("NATIVE_BOOTSTRAP_FAILED stage=" + stage + ": " + failure);
    }
    if (child.process != IntPtr.Zero) {
      bool drained = completed;
      if (!completed) { try { drained = DrainProcess(child.process, 1); } catch { drained = false; } }
      if (!drained) {
        failure += "; NATIVE_BOOTSTRAP_CLEANUP_FAILED pid=" + child.pid;
        Console.Error.WriteLine(failure); if (!modern) rc = 1;
      }
      CloseHandle(child.process);
    }
    if (child.thread != IntPtr.Zero) CloseHandle(child.thread);
    if (h != IntPtr.Zero) CloseHandle(h);
    try { BootstrapLog(log, args[0], stage, child.process != IntPtr.Zero, resumed, unchecked((uint)rc), failure); }
    catch (Exception error) { Console.Error.WriteLine("NATIVE_BOOTSTRAP_FAILED stage=setup log=" + error.Message); rc = modern ? 68 : 1; }
    return rc;
  }
}
