// Purpose: kernel job lifetime containment. Built by native-build.ps1 before transactions.
// No child executes input before job assignment; only explicit app launches may break away.
// Snapshot lists every member, an unreadable one with an empty birth, and never throws per member.
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
}
public sealed class NativeJobScope : IDisposable {
  IntPtr job;
  readonly List<IntPtr> unowned = new List<IntPtr>();
  public string Name;
  const uint ALL = 0x1F003F;
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
    job = CreateJobObject(IntPtr.Zero, name); Check(job != IntPtr.Zero);
    if (Marshal.GetLastWin32Error() == 183) { Dispose(); throw new Exception("NATIVE_JOB_ALREADY_EXISTS"); }
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
        try {
          using (Process p = Process.GetProcessById(pid)) {
            // A PID from the kernel list may have exited and been reused before opening it.
            // Pin this lifetime and independently confirm job membership before reading identity.
            bool member; Check(IsProcessInJob(p.Handle, job, out member));
            if (!member || p.HasExited) continue;
            NativeJobMember identity = new NativeJobMember {
              pid = pid, birth = p.StartTime.ToUniversalTime().Ticks.ToString(), exe = p.MainModule.FileName
            };
            if (!p.HasExited) members.Add(identity);
          }
        } catch (ArgumentException) { /* Process exited after the kernel snapshot. */ }
        catch (Exception e) {
          // One member whose identity cannot be read (access denied, a handle or module read failing
          // mid-termination) must not hide the others (opus M2). It stays listed, so cleanup still sees
          // it remaining, with no birth: its manifest record fails reconcile closed instead of matching.
          members.Add(new NativeJobMember { pid = pid, birth = "", exe = "unreadable: " + e.GetType().Name + ": " + e.Message });
        }
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
  public static int Main(string[] args) {
    // Scheduler starts only this trusted bootstrap. It creates no descendants until self-assigned.
    if (args.Length != 3) return 2;
    IntPtr h = IntPtr.Zero; PROCESS child = new PROCESS(); bool completed = false; int rc = 1;
    try {
      ValidName(args[0]);
      h = OpenJobObject(ALL, false, args[0]); Check(h != IntPtr.Zero);
      using (Process self = Process.GetCurrentProcess()) Check(AssignProcessToJobObject(h, self.Handle));
      Environment.SetEnvironmentVariable("MDPRO_NATIVE_JOB", args[0]);
      child = Launch(args[1], Encoding.UTF8.GetString(Convert.FromBase64String(args[2])), 0);
      bool member; Check(IsProcessInJob(child.process, h, out member));
      if (!member) Check(AssignProcessToJobObject(h, child.process));
      if (ResumeThread(child.thread) == 0xFFFFFFFF) throw new Win32Exception(Marshal.GetLastWin32Error());
      CloseHandle(h); h = IntPtr.Zero; // the supervisor alone owns the kill-on-close handle
      // A failed wait leaves the child live; its STILL_ACTIVE code (259) is not an exit status.
      if (WaitForSingleObject(child.process, 0xFFFFFFFF) != 0) throw new Exception("NATIVE_BOOTSTRAP_WAIT_FAILED");
      uint code; Check(GetExitCodeProcess(child.process, out code));
      completed = true; rc = unchecked((int)code);
    } catch (Exception error) { Console.Error.WriteLine("NATIVE_BOOTSTRAP_FAILED: " + error.Message); rc = 1; }
    if (child.process != IntPtr.Zero) {
      bool drained = completed;
      if (!completed) { try { drained = DrainProcess(child.process, 1); } catch { drained = false; } }
      // An unproved termination is reported beside the launch error, never hidden by it.
      if (!drained) { Console.Error.WriteLine("NATIVE_BOOTSTRAP_CLEANUP_FAILED pid=" + child.pid); rc = 1; }
      CloseHandle(child.process);
    }
    if (child.thread != IntPtr.Zero) CloseHandle(child.thread);
    if (h != IntPtr.Zero) CloseHandle(h);
    return rc;
  }
}
