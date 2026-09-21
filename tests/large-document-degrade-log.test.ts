/**
 * The large-document guard's degrade is the one decision the app makes on the
 * user's behalf that the user never asked for: it takes WYSIWYG away and drops
 * them into Source. Until now it wrote NOTHING to `~/.mdpro/mdpro.log`. A
 * support question of the form "why did it open in Source mode?" had no
 * answer in the log at all, and after ADR-0019 there are three different
 * reasons it could have happened.
 *
 * The payload is built by a pure function so that WHAT gets logged is a
 * behavioural claim rather than a source-text one. `src/App.tsx` has no test
 * that renders it — every existing assertion about the guard's call site is
 * source-text (tests/large-document-guard-call-site.test.ts), which can pin
 * that a call is written but not what it carries. Everything worth asserting
 * about the log line lives here instead.
 *
 * NOT asserted here, and deliberately: that the call fires. That is the call
 * site's business and stays in the source-text file (C14).
 */
import { describe, it, expect } from "vitest";
import {
  LARGE_DOCUMENT_DEGRADE_EVENT,
  buildLargeDocumentDegradeLog,
} from "../src/utils/largeDocumentDegradeLog";
import {
  LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD,
  LARGE_DOCUMENT_STRUCTURE_THRESHOLD,
  decideLargeDocumentGuard,
  type LargeDocumentGuardDecision,
} from "../src/utils/largeDocumentGuard";

type DegradeDecision = Extract<
  LargeDocumentGuardDecision,
  { action: "degrade-to-source" }
>;

const degrade = (over: Partial<DegradeDecision> = {}): DegradeDecision => ({
  action: "degrade-to-source",
  message: "irrelevant to this module",
  elements: 425_316,
  longestLine: 63,
  trigger: "structure",
  ...over,
});

describe("large-document degrade log payload", () => {
  it("L1: reports the trigger verbatim, for each of the three values", () => {
    // The whole reason the payload exists. ADR-0019 made "the guard fired"
    // ambiguous between two independent predicates; a log line that does not
    // say which one fired cannot answer the question it was added to answer.
    const triggers: DegradeDecision["trigger"][] = [
      "structure",
      "line-length",
      "both",
    ];

    for (const trigger of triggers) {
      const payload = buildLargeDocumentDegradeLog(degrade({ trigger }), "a-1");
      expect(payload.context?.trigger).toBe(trigger);
    }
  });

  it("L2: carries both measured counts unmodified, including the 7.5M case", () => {
    // Round-trip law: the numbers that entered the decision are the numbers
    // that reach the log. No rounding to "about 7.5M", no clamping, no
    // unit conversion. 7,583,742 is the real measurement from
    // very-long-line.source.md (docs/test/20260921-d5-d6-real-device-measurement.md);
    // it is here because it is the value a reader will actually go looking for.
    const payload = buildLargeDocumentDegradeLog(
      degrade({ elements: 3, longestLine: 7_583_742, trigger: "line-length" }),
      "a-2",
    );

    expect(payload.context?.elements).toBe(3);
    expect(payload.context?.longestLine).toBe(7_583_742);
  });

  it("L3: zero is reported as zero, not dropped as falsy", () => {
    // An empty document cannot degrade, so these values are unreachable in
    // production today. The case is here because `elements: 0` is exactly the
    // shape a `value || undefined` or a truthiness-filtered context object
    // silently deletes, and a missing key reads in the log as "not measured"
    // rather than "measured zero". Boundary, not scenario.
    const payload = buildLargeDocumentDegradeLog(
      degrade({ elements: 0, longestLine: 0 }),
      "a-3",
    );

    expect(payload.context).toHaveProperty("elements", 0);
    expect(payload.context).toHaveProperty("longestLine", 0);
  });

  it("L4: reports the thresholds from their one home, not a second copy", () => {
    // A log line saying "elements: 30,000" is unreadable without knowing what
    // the limit was on THAT build. Recording the limit beside the measurement
    // makes the line self-explaining a year later.
    //
    // Compared against the imported constants rather than against literals, so
    // that changing a threshold cannot leave this module reporting the old one
    // — the C8b' "exactly one home" discipline, applied to the second consumer
    // of the constants. Writing 25_000 here instead would create precisely the
    // second copy that case exists to prevent.
    const payload = buildLargeDocumentDegradeLog(degrade(), "a-4");

    expect(payload.context?.structureThreshold).toBe(
      LARGE_DOCUMENT_STRUCTURE_THRESHOLD,
    );
    expect(payload.context?.lineLengthThreshold).toBe(
      LARGE_DOCUMENT_LINE_LENGTH_THRESHOLD,
    );
  });

  it("L5: never carries document content, at any document size", () => {
    // A degrade happens on documents up to the 10 MB cap. A payload that
    // embedded any slice of the document would write megabytes into
    // ~/.mdpro/mdpro.log per degrade and put the user's prose into a file the
    // logger has no redaction pass for.
    //
    // Driven through the real predicate rather than a handcrafted decision, so
    // the case also covers a future payload field that forwards something it
    // should not: whatever `decideLargeDocumentGuard` chooses to return, this
    // builder must not turn it into content.
    const SECRET = "alpha-secret-passphrase";
    const content = `${SECRET}\n`.repeat(30_000);
    const decision = decideLargeDocumentGuard({ viewMode: "wysiwyg", content });

    expect(decision.action).toBe("degrade-to-source");
    const payload = buildLargeDocumentDegradeLog(
      decision as DegradeDecision,
      "a-5",
    );

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(SECRET);
    // Bounded, not merely "smaller than the document": a payload that grew
    // with the input would still pass a relative check.
    expect(serialized.length).toBeLessThan(600);
  });

  it("L6: survives the IPC boundary unchanged", () => {
    // `logEventSync` hands the payload to `invoke("log_event")`, which
    // serializes it. A value that does not survive JSON — undefined, NaN,
    // Infinity, a BigInt — is silently altered or throws at the boundary,
    // far from here. Idempotence under serialization is the law.
    const payload = buildLargeDocumentDegradeLog(
      degrade({ trigger: "both", elements: 1_164_910, longestLine: 2_000_001 }),
      "a-6",
    );

    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it("L7: is a warn/fail event under the project's naming convention", () => {
    // Mirrors the shape already established for a refusal the user did not ask
    // for: src/utils/tableWriteGuard.ts:172-185 logs `level: "warn"`,
    // `status: "fail"`, and an `error:` string. A degrade is the same kind of
    // event — the app declining to do what was asked — and grepping the log
    // for one should find the other.
    const payload = buildLargeDocumentDegradeLog(
      degrade({ trigger: "line-length" }),
      "a-7",
    );

    expect(payload.level).toBe("warn");
    expect(payload.status).toBe("fail");
    expect(payload.event).toBe(LARGE_DOCUMENT_DEGRADE_EVENT);
    expect(payload.actionId).toBe("a-7");
    // The error string names the trigger too. `error` is the field a reader
    // sees without expanding `context`, so the one-line summary has to be
    // enough to tell the two predicates apart.
    expect(payload.error).toContain("line-length");
  });

  it("L8: the event name follows CLAUDE.md's dotted convention and is stable", () => {
    // Pinned as a literal on purpose: the event name is the grep key. Renaming
    // it is a breaking change for anyone with a saved query, so it should cost
    // a deliberate edit here rather than happening in passing.
    expect(LARGE_DOCUMENT_DEGRADE_EVENT).toBe("editor.large_document.degrade");
  });
});
