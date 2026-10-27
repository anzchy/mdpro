/** Purpose: hold a per-report flock and make every archive write inside that lock. */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const LOCK_SCRIPT = [
  "import base64, fcntl, os, sys, tempfile, uuid",
  "out_path, lock_path = sys.argv[1:3]",
  "lock = open(lock_path, 'a+')",
  "try:",
  "    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)",
  "except BlockingIOError:",
  "    print('BUSY', flush=True)",
  "    sys.exit(0)",
  "marker = ('IN PROGRESS ' + str(uuid.uuid4()) + '\\n').encode()",
  "def replace(data):",
  "    fd, temp = tempfile.mkstemp(prefix='.mdpro-report-', dir=os.path.dirname(out_path))",
  "    try:",
  "        with os.fdopen(fd, 'wb') as file:",
  "            file.write(data)",
  "        os.replace(temp, out_path)",
  "    finally:",
  "        if os.path.exists(temp): os.unlink(temp)",
  "try:",
  "    replace(marker)",
  "except OSError:",
  "    print('REFUSED', flush=True)",
  "    sys.exit(1)",
  "print('LOCKED ' + marker.decode().strip().split()[-1], flush=True)",
  "request = sys.stdin.buffer.readline()",
  "if not request: sys.exit(0)",
  "try:",
  "    if not request.startswith(b'WRITE '): raise ValueError('invalid request')",
  "    report = base64.b64decode(request[6:].strip(), validate=True)",
  "    with open(out_path, 'rb') as file: current = file.read()",
  "    if current != marker: raise ValueError('marker changed')",
  "    replace(report)",
  "except (OSError, ValueError):",
  "    print('REFUSED', flush=True)",
  "    sys.exit(1)",
  "print('WROTE', flush=True)",
].join("\n");

/** A stale lock file is harmless: the kernel releases flock when its holder exits. */
export async function acquireReportLock(outPath) {
  const child = spawn("/usr/bin/python3", ["-u", "-c", LOCK_SCRIPT, outPath, `${outPath}.lock`], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  child.stdin.on("error", () => { /* the helper may die before a write */ });
  const lines = [];
  const waiters = [];
  let ended = false;
  const deliver = (line) => {
    if (waiters.length) waiters.shift()(line);
    else lines.push(line);
  };
  createInterface({ input: child.stdout }).on("line", deliver);
  child.on("error", () => { ended = true; deliver(null); });
  child.on("exit", () => { ended = true; deliver(null); });
  const nextLine = () => lines.length ? Promise.resolve(lines.shift())
    : ended ? Promise.resolve(null) : new Promise((resolve) => waiters.push(resolve));
  const status = await nextLine();
  if (!status?.startsWith("LOCKED ")) {
    child.stdin.end();
    return null;
  }
  let committed = false;
  return {
    pid: child.pid,
    waitForExit: () => ended ? Promise.resolve()
      : new Promise((resolve) => child.once("exit", resolve)),
    commit: async (report) => {
      if (committed || ended) return false;
      committed = true;
      child.stdin.end(`WRITE ${Buffer.from(report).toString("base64")}\n`);
      return await nextLine() === "WROTE";
    },
    release: async () => {
      if (ended) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.stdin.end();
      await exited;
    },
  };
}
