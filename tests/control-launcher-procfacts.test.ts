// @vitest-environment node
/**
 * ADR-0047 WI-003 WI-4: liveness facts (`scripts/control/procFacts.mjs`).
 * Pure parsers over captured `ps` / `lsof` text, the socket-error
 * classifier, and the real-boundary wrappers (a real unix socket, real
 * `ps` / `lsof` against this test process).
 * Matrix: `.claude/tdd-guardian/tests-20261008-144444.md`, WI-4, F-01..F-09.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifySocketError,
  parseLsofTxt,
  parseLstart,
  parseVerifyScan,
  probeSocket,
  readExe,
  readStartTime,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/control/procFacts.mjs";
import { makeStaleSocket } from "./support/launcherFakes";

const dirs: string[] = [];
const servers: net.Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((res) => s.close(() => res()))),
  );
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function shortDir(): string {
  const d = fs.mkdtempSync("/tmp/sk-");
  dirs.push(d);
  return d;
}

describe("procFacts#parseLstart", () => {
  it("F-01 accepts the C-locale format and returns it raw", () => {
    expect(parseLstart("Thu Oct  8 14:44:44 2026\n")).toBe("Thu Oct  8 14:44:44 2026");
    expect(parseLstart("Wed Oct 14 09:05:01 2026\n")).toBe("Wed Oct 14 09:05:01 2026");
    expect(parseLstart("  Thu Oct  8 14:44:44 2026  \n")).toBe("Thu Oct  8 14:44:44 2026");
  });

  it("F-02 empty, garbage, localized and multi-line output read as unknown", () => {
    for (const text of [
      "",
      "   \n",
      "ps: illegal option",
      "jeu.  8 oct 14:44:44 2026",
      "Thu Oct  8 14:44:44 2026\nFri Oct  9 01:00:00 2026\n",
      "Thu Oct 8 14:44",
    ]) {
      expect(parseLstart(text)).toBe("unknown");
    }
  });
});

describe("procFacts#parseLsofTxt", () => {
  it("F-03 takes the first txt entry, with or without field lines", () => {
    const exe = "/V/mdpro-verify.app/Contents/MacOS/tauri-app";
    expect(parseLsofTxt(`p4242\nftxt\nn${exe}\nftxt\nn/usr/lib/dyld\n`)).toBe(exe);
    expect(parseLsofTxt(`p4242\nn${exe}\nn/usr/lib/dyld\n`)).toBe(exe);
  });

  it("F-04 truncated, empty or relative output reads as unknown", () => {
    for (const text of ["p4242\nftxt\n", "", "p4242\nn\n", "p4242\nnrelative/tauri-app\n"]) {
      expect(parseLsofTxt(text)).toBe("unknown");
    }
  });
});

const SCAN = [
  "  101 /Applications/mdpro.app/Contents/MacOS/tauri-app",
  " 4242 /r/src-tauri/target/verify/release/bundle/macos/mdpro-verify.app/Contents/MacOS/tauri-app --x",
  "   77 /usr/bin/login",
].join("\n");

describe("procFacts#parseVerifyScan", () => {
  it("F-05 picks verify main binaries only", () => {
    expect(parseVerifyScan(`${SCAN}\n`)).toEqual([4242]);
    expect(parseVerifyScan("")).toEqual([]);
  });

  it("F-06 one unparsable line makes the whole scan unknown", () => {
    expect(parseVerifyScan(`${SCAN}\nabc def\n`)).toBe("unknown");
    expect(parseVerifyScan(`${SCAN}\n4242\n`)).toBe("unknown");
  });
});

describe("procFacts#classifySocketError + probeSocket", () => {
  it("F-07 classifies refused as stale, missing as absent, everything else unknown", () => {
    expect(classifySocketError({ code: "ECONNREFUSED" })).toBe("stale");
    expect(classifySocketError({ code: "ENOENT" })).toBe("absent");
    for (const code of ["ENOTSOCK", "EACCES", "EPERM", "ETIMEDOUT", undefined]) {
      expect(classifySocketError({ code })).toBe("unknown");
    }
    expect(classifySocketError("timeout")).toBe("unknown");
  });

  it("F-08 real socket: listener is live, killed listener is stale, missing is absent", async () => {
    const dir = shortDir();
    const sock = path.join(dir, "s.sock");
    const sock2 = path.join(dir, "t.sock");
    expect(Buffer.byteLength(sock)).toBeLessThan(104);

    const server = net.createServer();
    servers.push(server);
    await new Promise<void>((res) => server.listen(sock, () => res()));
    expect(await probeSocket(sock)).toBe("live");

    await makeStaleSocket(sock2);
    expect(fs.existsSync(sock2)).toBe(true);
    expect(await probeSocket(sock2)).toBe("stale");
    expect(fs.existsSync(sock2)).toBe(true);

    expect(await probeSocket(path.join(dir, "missing.sock"))).toBe("absent");
  }, 15_000);
});

describe("procFacts real ps / lsof", () => {
  // lsof's `-F` output and the bundle layout are the macOS contract; Linux
  // CI images often lack lsof, so the real-boundary pairing runs on darwin.
  it.skipIf(process.platform !== "darwin")(
    "F-09 reads this process's start time and exe; a dead pid is unknown",
    async () => {
      expect(() => process.kill(999999, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
      expect(await readStartTime(process.pid)).toMatch(
        /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d\d:\d\d:\d\d \d{4}$/,
      );
      expect(await readExe(process.pid)).toBe(fs.realpathSync(process.execPath));
      expect(await readStartTime(999999)).toBe("unknown");
    },
    15_000,
  );
});
