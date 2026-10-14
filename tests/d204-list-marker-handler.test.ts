// @vitest-environment node
/**
 * D204 — the remark `list` handler wrapper (ADR-0099). It sets `options.bullet` (or
 * `bulletOrdered`) to the list's own marker for that one call and restores the previous
 * options afterwards, including when the wrapped handler throws, so no marker leaks into
 * the next list. V1 pins the version coupling ADR-0099 depends on: the
 * `mdast-util-to-markdown` mdpro imports is the copy remark-stringify writes with.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withListMarker } from "../src/plugins/milkdown/listSpread/listMarker";

type Opts = { bullet?: string; bulletOther?: string; bulletOrdered?: string };

function fakeState(options: Opts) {
  return { options } as unknown as Parameters<ReturnType<typeof withListMarker>>[2];
}

/** A stand-in for the stock handler: records the options it saw. */
function recorder(seen: Opts[], fail = false) {
  return ((_node: unknown, _parent: unknown, state: { options: Opts }) => {
    seen.push({ ...state.options });
    if (fail) throw new Error("boom");
    return "out";
  }) as unknown as Parameters<typeof withListMarker>[0];
}

const list = (props: Record<string, unknown>) =>
  ({ type: "list", children: [], ...props }) as unknown as Parameters<ReturnType<typeof withListMarker>>[0];

describe("D204 — withListMarker", () => {
  it("H1 a bullet list's marker is the bullet for that call only, with no forced bulletOther", () => {
    const seen: Opts[] = [];
    const state = fakeState({ bullet: "-", bulletOther: "*" });
    const out = withListMarker(recorder(seen))(list({ ordered: false, mdproMarker: "+" }), undefined, state, {} as never);
    expect(out).toBe("out");
    expect(seen[0].bullet).toBe("+");
    expect(seen[0].bulletOther).toBeUndefined();
    expect(state.options).toEqual({ bullet: "-", bulletOther: "*" });
  });

  it("H2 an ordered list's delimiter is bulletOrdered for that call only", () => {
    const seen: Opts[] = [];
    const state = fakeState({ bulletOrdered: "." });
    withListMarker(recorder(seen))(list({ ordered: true, mdproMarker: ")" }), undefined, state, {} as never);
    expect(seen[0].bulletOrdered).toBe(")");
    expect(state.options).toEqual({ bulletOrdered: "." });
  });

  it("H3 options are restored when the wrapped handler throws", () => {
    const state = fakeState({ bullet: "-" });
    expect(() =>
      withListMarker(recorder([], true))(list({ ordered: false, mdproMarker: "*" }), undefined, state, {} as never),
    ).toThrow("boom");
    expect(state.options).toEqual({ bullet: "-" });
  });

  it("H4 no marker, or one that is not a valid marker for the list kind, leaves options alone", () => {
    for (const props of [
      { ordered: false },
      { ordered: false, mdproMarker: "x" },
      { ordered: false, mdproMarker: ")" },
      { ordered: true, mdproMarker: "-" },
    ]) {
      const seen: Opts[] = [];
      const state = fakeState({ bullet: "-", bulletOther: "*", bulletOrdered: "." });
      withListMarker(recorder(seen))(list(props), undefined, state, {} as never);
      expect(seen[0], JSON.stringify(props)).toEqual({ bullet: "-", bulletOther: "*", bulletOrdered: "." });
    }
  });
});

describe("D204 — version coupling (ADR-0099)", () => {
  it("V1 mdpro's mdast-util-to-markdown is the copy remark-stringify resolves", () => {
    const root = path.resolve(__dirname, "..");
    const direct = path.join(root, "node_modules/mdast-util-to-markdown");
    // An assertion rather than a throw: a missing direct dependency is the red this pins.
    expect(fs.existsSync(direct), "mdast-util-to-markdown is not a direct dependency").toBe(true);
    const ours = fs.realpathSync(direct);
    const kit = fs.realpathSync(path.join(root, "node_modules/@milkdown/kit"));
    const core = fs.realpathSync(path.join(kit, "../core"));
    const stringify = fs.realpathSync(path.join(core, "../../remark-stringify"));
    const theirs = fs.realpathSync(path.join(stringify, "../mdast-util-to-markdown"));
    expect(ours).toBe(theirs);
  });
});
