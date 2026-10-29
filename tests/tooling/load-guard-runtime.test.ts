// @vitest-environment node
import { runChild } from "../support/loadGuardChild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const script = path.resolve("scripts/heavy-lock.sh");
const guard = path.resolve("scripts/load-guard/guard.py");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture(readings: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-guard-runtime-"));
  dirs.push(dir);
  const sequence = path.join(dir, "readings.txt");
  fs.writeFileSync(sequence, readings.join("\n") + "\n");
  const sampler = path.join(dir, "sample.sh");
  fs.writeFileSync(sampler, `#!/bin/bash\nhead -n 1 "$MDPRO_LOAD_GUARD_SEQUENCE" | awk '{if (NF == 2) print $0 " 16"; else print}'\ntail -n +2 "$MDPRO_LOAD_GUARD_SEQUENCE" > "$MDPRO_LOAD_GUARD_SEQUENCE.next"\nmv "$MDPRO_LOAD_GUARD_SEQUENCE.next" "$MDPRO_LOAD_GUARD_SEQUENCE"\n`);
  fs.chmodSync(sampler, 0o700);
  return { dir, env: { ...process.env, MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_OS: "Darwin", MDPRO_HEAVY_LOCK_HELD: undefined, MDPRO_VITEST_WORKER_HEAP_MIB: undefined, MDPRO_HEAVY_LOCK: path.join(dir, "lock"), MDPRO_LOAD_GUARD_LOG: path.join(dir, "log"), MDPRO_LOAD_GUARD_SAMPLER: sampler, MDPRO_LOAD_GUARD_SEQUENCE: sequence, MDPRO_LOAD_GUARD_INTERVAL_SECS: "0.05", MDPRO_HEAVY_LOCK_KILL_GRACE_SECS: "1" } };
}

function macSampler(level: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-guard-mac-sample-"));
  dirs.push(dir);
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "sysctl"), `#!/bin/sh\ncase "$*" in\n  *kern.memorystatus_vm_pressure_level*) echo 1;;\n  *kern.memorystatus_level*) echo '${level}';;\n  *hw.memsize*) echo 17179869184;;\nesac\n`, { mode: 0o700 });
  fs.writeFileSync(path.join(bin, "top"), "#!/bin/sh\necho 'CPU usage: 0% user, 0% sys, 100% idle'\necho 'CPU usage: 5% user, 5% sys, 90% idle'\n", { mode: 0o700 });
  fs.writeFileSync(path.join(bin, "vm_stat"), "#!/bin/sh\necho 'Mach Virtual Memory Statistics: (page size of 16384 bytes)'\necho 'Pages free: 589824.'\necho 'Pages inactive: 0.'\necho 'Pages purgeable: 0.'\n", { mode: 0o700 });
  const sampler = path.join(dir, "production-sampler");
  fs.writeFileSync(sampler, `#!/bin/sh\nexec python3 '${guard}' sample\n`, { mode: 0o700 });
  return { dir, env: { ...process.env, MDPRO_LOAD_GUARD_SAMPLER: sampler, MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_OS: "Darwin", PATH: `${bin}:${process.env.PATH}` } };
}

it("uses the macOS memorystatus percentage for admission and retains vm_stat as comparison", async () => {
  const low = macSampler("37");
  const enough = macSampler("38");
  const unreadable = macSampler("101");
  const read = async (env: NodeJS.ProcessEnv) => (await runChild("python3", [guard, "sample"], { env, encoding: "utf8" }));
  expect((await read(low.env)).stdout.trim()).toBe("1 10.00 5.920 9.000 37");
  expect((await read(enough.env)).stdout.trim()).toBe("1 10.00 6.080 9.000 38");
  expect((await read(unreadable.env)).stdout.trim()).toBe("1 10.00 unreadable 9.000 unreadable");
});

it("admits from the macOS level at the margin and holds an unreadable level", async () => {
  for (const [level, expected] of [["37", 75], ["38", 0], ["101", 75]] as const) {
    const { dir, env } = macSampler(level);
    const marker = path.join(dir, "started");
    const result = (await runChild("/bin/bash", [script, "/bin/bash", "-c", `touch "${marker}"`], {
      env: { ...env, MDPRO_HEAVY_LOCK_HELD: undefined, MDPRO_VITEST_WORKER_HEAP_MIB: undefined, MDPRO_HEAVY_LOCK: path.join(dir, "lock"),
        MDPRO_LOAD_GUARD_LOG: path.join(dir, "log"), MDPRO_HEAVY_LOCK_WAIT_SECS: "1",
        MDPRO_LOAD_GUARD_INTERVAL_SECS: "0.05", MDPRO_LOAD_GUARD_BUDGET_GIB: "5" },
      encoding: "utf8", timeout: 6000,
    }));
    expect(result.status).toBe(expected);
    expect(fs.existsSync(marker)).toBe(expected === 0);
    const lines = fs.readFileSync(path.join(dir, "log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const decisive = lines.find((line) => line.event === "admission" || line.event === "warn");
    expect(decisive?.readings).toMatchObject({
      memorystatusLevel: level === "101" ? "unreadable" : level,
      availableGiB: level === "37" ? "5.920" : level === "38" ? "6.080" : "unreadable",
      vmStatFreeGiB: "9.000",
    });
  }
}, 15000);

it("stops after two critical memory samples and exits 76 with one stop record", async () => {
  const { dir, env } = fixture(["1 0", "4 0", "4 0", "1 0"]);
  const result = (await runChild("/bin/bash", [script, "/bin/bash", "-c", "sleep 5"], { env, encoding: "utf8", timeout: 9000 }));
  expect(result.status).toBe(76);
  expect(fs.existsSync(path.join(dir, "lock"))).toBe(false);
  const lines = fs.readFileSync(path.join(dir, "log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(lines.filter((line) => line.event === "stop")).toHaveLength(1);
  expect(lines.find((line) => line.event === "stop")?.reason).toBe("memory");
});

it("never starts under critical pressure before the admission deadline", async () => {
  const { dir, env } = fixture(Array(80).fill("4 0"));
  const marker = path.join(dir, "started");
  const start = Date.now();
  const result = (await runChild("/bin/bash", [script, "/bin/bash", "-c", `touch "${marker}"`], {
    env: { ...env, MDPRO_HEAVY_LOCK_WAIT_SECS: "1" }, encoding: "utf8", timeout: 5000,
  }));
  expect(result.status).toBe(75);
  expect(Date.now() - start).toBeGreaterThanOrEqual(900);
  expect(fs.existsSync(marker)).toBe(false);
  expect(fs.existsSync(path.join(dir, "lock"))).toBe(false);
});

it("admits coverage at its 5 GiB budget plus exactly 1 GiB, but not below", async () => {
  const blocked = fixture(Array(50).fill("1 0 5.99"));
  const admitted = fixture(["1 0 6.00"]);
  const run = async (env: NodeJS.ProcessEnv) => (await runChild("/bin/bash", [script, "/bin/echo", "vitest --coverage"], {
    env: { ...env, MDPRO_LOAD_GUARD_BUDGET_GIB: "5", MDPRO_HEAVY_LOCK_WAIT_SECS: "1" }, encoding: "utf8", timeout: 5000,
  }));
  expect((await run(blocked.env)).status).toBe(75);
  const result = (await run(admitted.env));
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("vitest --coverage");
});

it("uses a 4 GiB placeholder for other job classes", async () => {
  const { env } = fixture(["1 0 5.00"]);
  const result = (await runChild("/bin/bash", [script, "/bin/echo", "partial-run"], {
    env, encoding: "utf8", timeout: 5000,
  }));
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("partial-run");
});

it("never admits a job at warn pressure even after the old warn limit", async () => {
  const { dir, env } = fixture(Array(80).fill("2 0"));
  const marker = path.join(dir, "warn-started");
  const result = (await runChild("/bin/bash", [script, "/bin/bash", "-c", `touch "${marker}"`], {
    env: { ...env, MDPRO_HEAVY_LOCK_WAIT_SECS: "1", MDPRO_LOAD_GUARD_WARN_SECS: "0" },
    encoding: "utf8", timeout: 5000,
  }));
  expect(result.status).toBe(75);
  expect(fs.existsSync(marker)).toBe(false);
  expect(fs.existsSync(path.join(dir, "lock"))).toBe(false);
});

it("sets a 1024 MiB worker heap for a guard-only run", async () => {
  const { env } = fixture(["1 0"]);
  const result = (await runChild("/bin/bash", [script, "--guard-only", "/bin/bash", "-c", "echo ${MDPRO_VITEST_WORKER_HEAP_MIB:-unset}"], {
    env, encoding: "utf8", timeout: 5000,
  }));
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("1024");
});

it("logs but does not stop when another process causes sustained high CPU", async () => {
  const { dir, env } = fixture(["1 0 16 0", "1 96 16 0", "1 97 16 0", "1 98 16 0", "1 0 16 0"]);
  const result = (await runChild("/bin/bash", [script, "/bin/bash", "-c", "sleep 0.6"], {
    env, encoding: "utf8", timeout: 5000,
  }));
  expect(result.status).toBe(0);
  const lines = fs.readFileSync(path.join(dir, "log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(lines.filter((line) => line.reason === "cpu" && line.event === "warn")).toHaveLength(1);
  expect(lines.filter((line) => line.event === "stop")).toHaveLength(0);
});

it("treats an unexpected Darwin pressure value as warn and logs every raw reading", async () => {
  const { dir, env } = fixture(Array(50).fill("3 0 16"));
  const marker = path.join(dir, "unexpected-started");
  const result = (await runChild("/bin/bash", [script, "/bin/bash", "-c", `touch "${marker}"`], {
    env: { ...env, MDPRO_HEAVY_LOCK_WAIT_SECS: "1" }, encoding: "utf8", timeout: 5000,
  }));
  expect(result.status).toBe(75);
  expect(fs.existsSync(marker)).toBe(false);
  const lines = fs.readFileSync(path.join(dir, "log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(lines.filter((line) => line.readings.pressure === "unreadable" && line.readings.rawPressure === "3").length).toBeGreaterThanOrEqual(2);
});

it("stops a CPU-bound group only when it causes over 80 percent of sustained busy CPU", async () => {
  const { dir, env } = fixture(["1 0 16 0", "1 96 16 90", "1 97 16 90", "1 98 16 90"]);
  const result = (await runChild("/bin/bash", [script, "/bin/bash", "-c", "sleep 5"], {
    env, encoding: "utf8", timeout: 7000,
  }));
  expect(result.status).toBe(76);
  const lines = fs.readFileSync(path.join(dir, "log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(lines.filter((line) => line.event === "stop" && line.reason === "cpu")).toHaveLength(1);
});

it("holds on an unreadable Darwin sample and starts with one note on Linux", async () => {
  const darwin = fixture(Array(50).fill("unreadable 0 16"));
  const linux = fixture(["unreadable 0 16"]);
  const darwinResult = (await runChild("/bin/bash", [script, "/usr/bin/true"], {
    env: { ...darwin.env, MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_OS: "Darwin", MDPRO_HEAVY_LOCK_WAIT_SECS: "1" },
    encoding: "utf8", timeout: 5000,
  }));
  expect(darwinResult.status).toBe(75);
  const linuxResult = (await runChild("/bin/bash", [script, "/usr/bin/true"], {
    env: { ...linux.env, MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_OS: "Linux" },
    encoding: "utf8", timeout: 5000,
  }));
  expect(linuxResult.status).toBe(0);
  const notes = fs.readFileSync(path.join(linux.dir, "log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(notes.filter((line) => line.event === "note" && line.reason === "unreadable")).toHaveLength(1);
});

it("bounds Cargo test build jobs to cores minus two", async () => {
  const { dir, env } = fixture(["1 0 16"]);
  const cargo = path.join(dir, "cargo");
  fs.writeFileSync(cargo, "#!/bin/sh\necho ${CARGO_BUILD_JOBS:-unset}\n", { mode: 0o700 });
  const result = (await runChild("/bin/bash", [script, cargo, "test"], { env, encoding: "utf8", timeout: 5000 }));
  expect(result.status).toBe(0);
  expect(Number(result.stdout.trim())).toBeGreaterThan(0);
  expect(Number(result.stdout.trim())).toBeLessThanOrEqual(os.availableParallelism() - 2);
});

it("holds a Darwin job when the sampler returns no bytes", async () => {
  const { dir, env } = fixture([]);
  const marker = path.join(dir, "blank-started");
  const result = (await runChild("/bin/bash", [script, "/bin/bash", "-c", `touch "${marker}"`], {
    env: { ...env, MDPRO_HEAVY_LOCK_WAIT_SECS: "1" }, encoding: "utf8", timeout: 5000,
  }));
  expect(result.status).toBe(75);
  expect(fs.existsSync(marker)).toBe(false);
  expect(fs.existsSync(path.join(dir, "lock"))).toBe(false);
});
