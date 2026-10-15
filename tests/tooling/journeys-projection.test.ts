// @vitest-environment node
/**
 * Purpose: E2E-WI-1 acceptance 4, the log projection (`projection.mjs`, plan
 * §4.4): normalisation (time, pids and undeclared fields dropped; window
 * labels → W2…, document ids → D1…, run paths → <RUN>), counts (exact or at
 * least), order only where declared, every unknown event reported, and every
 * fail / warn / error line reported unless the journey expects it. The two
 * ADR-0047 hard rules are the last two.
 *
 * @module tests/tooling/journeys-projection.test
 * @coordinates-with scripts/journeys/projection.mjs
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script, no .d.ts by design
import { compareProjection, normalize } from "../../scripts/journeys/projection.mjs";

interface Finding {
  rule: string;
  message: string;
}

const RUN = "/tmp/mdpro-run-1";
const line = (event: string, context: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  ts: "2026-10-15T10:00:00.000+08:00",
  level: "info",
  event,
  status: "success",
  actionId: "a1",
  context,
  durationMs: 12,
  error: null,
  ...extra,
});

const PROJECTION = {
  projectionVersion: 1,
  events: {
    "app.ready": { fields: [] },
    "window.open": { fields: ["windowLabel", "filePath"] },
    "file.open": { fields: ["filePath", "documentId"] },
    "tab.open": { fields: ["documentId"] },
    "draft.write": { fields: ["documentId"] },
  },
  ignore: ["window.focus"],
  order: [["app.ready", "file.open"]],
};

describe("normalize", () => {
  it("keeps only event, status and the declared fields, and drops time and pids", () => {
    const [p] = normalize([line("file.open", { filePath: `${RUN}/a.md`, documentId: "x", pid: 7 })], PROJECTION, {
      runDir: RUN,
    }).projected;
    expect(p).toEqual({ event: "file.open", status: "success", fields: { filePath: "<RUN>/a.md", documentId: "D1" } });
  });

  it("maps window labels in order of first appearance and keeps main", () => {
    const lines = [
      line("window.open", { windowLabel: "main" }),
      line("window.open", { windowLabel: "mdpro-6f1c" }),
      line("window.open", { windowLabel: "mdpro-0a2b" }),
      line("window.open", { windowLabel: "mdpro-6f1c" }),
    ];
    const labels = normalize(lines, PROJECTION, { runDir: RUN }).projected.map(
      (p: { fields: { windowLabel: string } }) => p.fields.windowLabel,
    );
    expect(labels).toEqual(["main", "W2", "W3", "W2"]);
  });

  it("maps document ids in order of first appearance", () => {
    const lines = [line("tab.open", { documentId: "zz" }), line("tab.open", { documentId: "aa" }), line("tab.open", { documentId: "zz" })];
    const ids = normalize(lines, PROJECTION, { runDir: RUN }).projected.map(
      (p: { fields: { documentId: string } }) => p.fields.documentId,
    );
    expect(ids).toEqual(["D1", "D2", "D1"]);
  });

  it("maps both the /tmp and /private/tmp spellings of the run directory", () => {
    const lines = [line("file.open", { filePath: `/private${RUN}/a.md` }), line("file.open", { filePath: `${RUN}/b.md` })];
    const paths = normalize(lines, PROJECTION, { runDir: RUN }).projected.map(
      (p: { fields: { filePath: string } }) => p.fields.filePath,
    );
    expect(paths).toEqual(["<RUN>/a.md", "<RUN>/b.md"]);
  });
});

const expected = (event: string, fields: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) => ({
  event,
  status: "success",
  fields,
  ...opts,
});
const EXPECTED = [expected("app.ready"), expected("file.open", { filePath: "<RUN>/a.md", documentId: "D1" })];
const GOOD = [line("app.ready"), line("file.open", { filePath: `${RUN}/a.md`, documentId: "q" })];
const rules = (lines: unknown[], exp = EXPECTED) =>
  (compareProjection(lines, PROJECTION, exp, { runDir: RUN }) as Finding[]).map((f) => f.rule);

describe("compareProjection: counts", () => {
  it("an exact match has no findings", () => {
    expect(compareProjection(GOOD, PROJECTION, EXPECTED, { runDir: RUN })).toEqual([]);
  });

  it("a missing expected line is a finding", () => {
    expect(rules([line("app.ready")])).toContain("projection-missing");
  });

  it("an extra line of a projected event is a finding when the count is exact", () => {
    expect(rules([...GOOD, line("file.open", { filePath: `${RUN}/a.md`, documentId: "q" })])).toContain(
      "projection-extra",
    );
  });

  it("a line whose declared field differs is missing one and extra one", () => {
    const r = rules([line("app.ready"), line("file.open", { filePath: `${RUN}/b.md`, documentId: "q" })]);
    expect(r).toEqual(expect.arrayContaining(["projection-missing", "projection-extra"]));
  });

  it("an at-least expectation accepts repeats", () => {
    const exp = [...EXPECTED, expected("draft.write", { documentId: "D1" }, { atLeast: 1 })];
    const lines = [...GOOD, line("draft.write", { documentId: "q" }), line("draft.write", { documentId: "q" })];
    expect(rules(lines, exp)).toEqual([]);
    expect(rules(GOOD, exp)).toContain("projection-missing");
  });
});

describe("compareProjection: order", () => {
  it("a declared order that is broken is a finding", () => {
    expect(rules([GOOD[1], GOOD[0]])).toContain("projection-order");
  });

  it("an undeclared order is free", () => {
    const exp = [...EXPECTED, expected("tab.open", { documentId: "D1" })];
    const lines = [line("app.ready"), line("tab.open", { documentId: "q" }), line("file.open", { filePath: `${RUN}/a.md`, documentId: "q" })];
    expect(rules(lines, exp)).toEqual([]);
  });
});

describe("compareProjection: the ADR-0047 hard rules", () => {
  it("an event in neither the projection nor its ignore list is reported", () => {
    expect(rules([...GOOD, line("mcp.sync")])).toContain("projection-unknown");
  });

  it("an ignored event is not reported", () => {
    expect(rules([...GOOD, line("window.focus")])).toEqual([]);
  });

  it("an ignore entry ending in .* covers the whole prefix, and only it", () => {
    const projection = { ...PROJECTION, ignore: ["mcp.*"] };
    const lines = [...GOOD, line("mcp.sync"), line("mcp.http_server.start")];
    expect(compareProjection(lines, projection, EXPECTED, { runDir: RUN })).toEqual([]);
    const near = compareProjection([...GOOD, line("mcpx.sync")], projection, EXPECTED, { runDir: RUN }) as Finding[];
    expect(near.map((f) => f.rule)).toContain("projection-unknown");
  });

  it.each([
    ["status fail", { status: "fail" }],
    ["level warn", { level: "warn" }],
    ["level error", { level: "error" }],
  ])("a %s line is reported even for an ignored event", (_name, extra) => {
    expect(rules([...GOOD, line("window.focus", {}, extra)])).toContain("projection-failure-line");
  });

  it("a failure line the journey expects is not a finding", () => {
    const exp = [...EXPECTED, { event: "tab.open", status: "fail", fields: { documentId: "D1" } }];
    expect(rules([...GOOD, line("tab.open", { documentId: "q" }, { status: "fail" })], exp)).toEqual([]);
  });

  it("an unparsable log line is reported, not skipped", () => {
    expect(rules([...GOOD, "{not json"])).toContain("projection-bad-line");
  });
});
