/**
 * WI-1 — `src/utils/openFailure.ts`: the open-failure helpers extracted from
 * `useDocument.ts` with no behaviour change.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261003-130127.md`, cases OF-1..OF-5.
 *
 * Law under test (OF-4): `parseEncodingError` is a pure, total classifier. It is
 * non-null iff the input is a non-null object with a truthy `EncodingError`
 * property, or a non-null object whose `message` contains "EncodingError".
 * Equal inputs give deep-equal outputs and the input is never mutated.
 *
 * Mock boundary: none — real implementation throughout.
 */
import { describe, expect, it } from "vitest";
import { OPEN_FAILED_MESSAGE, parseEncodingError } from "../src/utils/openFailure";
import { reportOpenFailure } from "../src/utils/openFailure";
import { useToastStore } from "../src/stores/toastStore";

const UNKNOWN = { path: "", detected: "unknown" };
const FTL = { FileTooLarge: { path: "/tmp/big.md", size: 10485761 } };

describe("parseEncodingError", () => {
  it("OF-1 object form returns the payload", () => {
    expect(parseEncodingError({ EncodingError: { path: "/a.md", detected: "GBK" } })).toEqual({
      path: "/a.md",
      detected: "GBK",
    });
  });

  it.each<[string, unknown]>([
    ["Error instance", new Error("EncodingError: x")],
    ["plain object with message", { message: "EncodingError" }],
    ["substring mid-message", new Error("IoError: wraps EncodingError later")],
  ])("OF-2 message form returns the unknown sentinel: %s", (_label, input) => {
    expect(parseEncodingError(input)).toEqual(UNKNOWN);
  });

  it.each<[string, unknown, unknown]>([
    ["empty payload is not defaulted", { EncodingError: { path: "", detected: "" } }, { path: "", detected: "" }],
    ["null EncodingError", { EncodingError: null }, null],
    ["null EncodingError falls through to message", { EncodingError: null, message: "EncodingError" }, UNKNOWN],
    ["bare string is not parsed", "EncodingError: x", null],
    ["empty Error message", new Error(""), null],
  ])("OF-3 edge shape: %s", (_label, input, expected) => {
    if (expected === null) expect(parseEncodingError(input)).toBeNull();
    else expect(parseEncodingError(input)).toEqual(expected);
  });

  it("OF-4 partition law over the enumerated FileError domain", () => {
    const variants: Array<[string, unknown]> = [
      ["FileNotFound", { FileNotFound: { path: "/p" } }],
      ["PermissionDenied", { PermissionDenied: { path: "/p" } }],
      ["FileTooLarge", FTL],
      ["InvalidPath", { InvalidPath: { path: "/p" } }],
      ["IoError", { IoError: { message: "boom" } }],
      ["DiskFull", "DiskFull"],
    ];
    const negatives: Array<[string, unknown]> = [];
    for (const [name, v] of variants) {
      negatives.push([`${name} raw`, v]);
      negatives.push([`${name} Error(JSON)`, new Error(JSON.stringify(v))]);
      negatives.push([`${name} Error(name)`, new Error(name)]);
    }
    negatives.push(
      ["null", null],
      ["undefined", undefined],
      ["empty string", ""],
      ["plain string", "plain"],
      ["zero", 0],
      ["42", 42],
      ["true", true],
      ["Error(ENOENT)", new Error("ENOENT")],
    );
    const positives: Array<[string, unknown]> = [
      ["OF-1 object form", { EncodingError: { path: "/a.md", detected: "GBK" } }],
      ["OF-2 Error instance", new Error("EncodingError: x")],
      ["OF-2 plain message object", { message: "EncodingError" }],
      ["OF-2 substring", new Error("IoError: wraps EncodingError later")],
    ];

    const snapshot = (x: unknown) =>
      x instanceof Error ? `Error:${x.message}` : JSON.stringify(x) ?? String(x);

    let cells = 0;
    for (const [label, input] of [...negatives, ...positives]) {
      const isPositive = positives.some(([, p]) => p === input);
      const before = snapshot(input);
      const first = parseEncodingError(input);
      const second = parseEncodingError(input);
      if (isPositive) expect(first, label).not.toBeNull();
      else expect(first, label).toBeNull();
      expect(second, `${label} deterministic`).toEqual(first);
      expect(snapshot(input), `${label} not mutated`).toBe(before);
      cells += 1;
    }
    expect(cells).toBe(30);
  });
});

describe("OPEN_FAILED_MESSAGE", () => {
  it("OF-5 copy contract: the ⌘O copy, with no path in it", () => {
    expect(OPEN_FAILED_MESSAGE).toBe("Failed to open file");
    expect(OPEN_FAILED_MESSAGE).not.toContain("/");
  });
});

// WI-2 (D46) — OF-6. Real toast store; no mocks.
describe("reportOpenFailure", () => {
  it("OF-6 one call, one emission, exact copy", () => {
    useToastStore.getState().clearToast();
    const emissions: string[] = [];
    const stop = useToastStore.subscribe((s) => {
      if (s.message !== null) emissions.push(s.message);
    });
    try {
      reportOpenFailure();
      expect(emissions).toEqual(["Failed to open file"]);
      expect(useToastStore.getState().message).toBe(OPEN_FAILED_MESSAGE);
    } finally {
      stop();
      useToastStore.getState().clearToast();
    }
  });
});

// D46-LOG — `reportOpenFailure(error, actionId?)` also logs one `file.open.report`
// fail whose context carries only the FileError variant name (rule 20), never
// the path, size or message. Real `loggingService` and real logging store; the
// only mock is `@tauri-apps/api/core#invoke` (the IPC boundary), whose
// `log_event` payloads are captured. Paired real path: the `log_event` command
// itself is exercised by the Rust logger tests (src-tauri), not mocked there.
import { beforeEach as beforeEachLog, vi } from "vitest";
import { useLoggingStore } from "../src/stores/loggingStore";

const { logInvoke } = vi.hoisted(() => ({
  logInvoke: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock({ isTauri: true }),
  invoke: (...args: unknown[]) => logInvoke(...args),
}));

type LogPayload = {
  level: string;
  event: string;
  status: string;
  actionId?: string;
  context?: Record<string, unknown>;
} & Record<string, unknown>;

function reportPayloads(): LogPayload[] {
  return logInvoke.mock.calls
    .filter(([cmd]) => cmd === "log_event")
    .map(([, args]) => (args as { payload: LogPayload }).payload)
    .filter((p) => p.event === "file.open.report");
}

describe("reportOpenFailure logging (D46-LOG)", () => {
  beforeEachLog(() => {
    logInvoke.mockReset();
    logInvoke.mockImplementation(async () => null);
    useLoggingStore.setState({ enabled: true, level: "debug" });
    useToastStore.getState().clearToast();
  });

  it.each<[string, unknown, string]>([
    ["FileTooLarge object", FTL, "FileTooLarge"],
    ["bare DiskFull string", "DiskFull", "DiskFull"],
    ["Error instance", new Error("x"), "unknown"],
    ["null", null, "unknown"],
  ])("OF-7 %s logs one fail with reason only, no path or size", (_label, error, reason) => {
    reportOpenFailure(error);

    const payloads = reportPayloads();
    expect(payloads).toHaveLength(1);
    const [p] = payloads;
    expect(p.level).toBe("error");
    expect(p.status).toBe("fail");
    expect(p.context).toEqual({ reason });
    expect(typeof p.actionId).toBe("string");
    expect((p.actionId ?? "").length).toBeGreaterThan(0);
    const json = JSON.stringify(p);
    expect(json).not.toContain("/");
    expect(json).not.toContain("big.md");
    expect(json).not.toContain("10485761");
    // The toast still shows, exactly as before.
    expect(useToastStore.getState().message).toBe(OPEN_FAILED_MESSAGE);
  });

  it("OF-8 a passed actionId is used verbatim", () => {
    reportOpenFailure(FTL, "act-123");
    const payloads = reportPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0].actionId).toBe("act-123");
  });

  it("OF-9 other payload-bearing variants log their name, never their payload", () => {
    const variants: Array<[unknown, string]> = [
      [{ FileNotFound: { path: "/secret/a.md" } }, "FileNotFound"],
      [{ PermissionDenied: { path: "/secret/a.md" } }, "PermissionDenied"],
      [{ InvalidPath: { path: "/secret/a.md" } }, "InvalidPath"],
      [{ IoError: { message: "boom at /secret/a.md" } }, "IoError"],
      [undefined, "unknown"],
      ["plain message", "unknown"],
      [{}, "unknown"],
      [{ A: 1, B: 2 }, "unknown"],
      [{ "/secret/key.md": 1 }, "unknown"],
      ["/secret/raw-path.md", "unknown"],
    ];
    for (const [error] of variants) reportOpenFailure(error);
    const payloads = reportPayloads();
    expect(payloads.map((p) => p.context)).toEqual(variants.map(([, reason]) => ({ reason })));
    const json = JSON.stringify(payloads);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("boom");
    expect(json).not.toContain("plain message");
  });
});
