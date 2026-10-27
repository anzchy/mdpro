/** Purpose: hold a per-report kernel lock across a device identity run. */
import { spawn } from "node:child_process";

const LOCK_SCRIPT = [
  "import fcntl, sys",
  "lock = open(sys.argv[1], 'a+')",
  "try:",
  "    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)",
  "except BlockingIOError:",
  "    print('BUSY', flush=True)",
  "    sys.exit(0)",
  "print('LOCKED', flush=True)",
  "sys.stdin.buffer.read()",
].join("\n");

/** The persistent lock file is harmless after a crash: the kernel releases flock. */
export async function acquireReportLock(outPath) {
  const child = spawn("/usr/bin/python3", ["-u", "-c", LOCK_SCRIPT, `${outPath}.lock`], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  child.stdin.on("error", () => { /* the contender may have exited after reporting BUSY */ });
  const status = await new Promise((resolve) => {
    let done = false;
    const settle = (value) => {
      if (done) return;
      done = true;
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      resolve(value);
    };
    const onData = (chunk) => settle(String(chunk).trim());
    const onError = () => settle("FAIL");
    const onExit = () => settle("FAIL");
    child.stdout.on("data", onData);
    child.on("error", onError);
    child.on("exit", onExit);
  });
  if (status !== "LOCKED") {
    child.stdin.end();
    return null;
  }
  return {
    isHeld: () => child.exitCode === null && child.signalCode === null,
    release: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.stdin.end();
      await exited;
    },
  };
}
