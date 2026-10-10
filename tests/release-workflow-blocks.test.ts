// @vitest-environment node
/**
 * D76-WI-6 W0: the indentation-aware block extractor the release-workflow shape
 * test reads `.github/workflows/release.yml` with (plan D-2: no YAML dependency).
 * It understands only the YAML subset that file uses — block maps, indented
 * `- ` sequences, `|` block scalars, flow sequences of plain scalars, comments
 * and quoted keys — and must throw on anything else rather than misparse it.
 *
 * Law (S6, metamorphic): the extraction is invariant under indenting the whole
 * document by a constant and under inserting blank and comment lines between
 * entries. Everything else is specified by example and failure mode.
 */
import { describe, expect, it } from "vitest";
import {
  at,
  entry,
  items,
  job,
  jobIds,
  keys,
  list,
  parentKey,
  scalar,
  stepRun,
  steps,
  topLevel,
} from "./support/workflowBlocks";

const FIXTURE = [
  "name: X",
  "on:",
  "  workflow_dispatch:",
  "    inputs:",
  "      ref:",
  "        required: true",
  "      mode:",
  "        type: choice",
  "        options:",
  "          - build-only",
  "          - 'draft'",
  "jobs:",
  "  a:",
  "    runs-on: ubuntu-latest",
  "    needs: [x, y]",
  "    steps:",
  "      - name: one",
  "        run: echo hi",
  "      # a comment between steps",
  "      - uses: actions/checkout@v6",
  "        with:",
  "          ref: abc",
  "      - name: multi",
  "        run: |",
  "          set -e",
  "          # shell comment",
  '          echo "a: b"',
  "",
  "          echo done",
  "  'b':",
  "    needs:",
  "      - a",
  "    if: inputs.mode == 'draft' # trailing comment",
  '    env:',
  '      URL: "https://x/#frag"',
].join("\n");

const lineOf = (text: string, needle: string) => text.split("\n").findIndex((l) => l.includes(needle));

describe("W0 block extraction on a fixture", () => {
  it("lists base-level keys in order and reads an inline scalar", () => {
    expect(keys(FIXTURE)).toEqual(["name", "on", "jobs"]);
    expect(scalar(FIXTURE, "name")).toBe("X");
    expect(topLevel(FIXTURE, "missing")).toBeNull();
  });

  it("walks nested maps", () => {
    const inputs = at(FIXTURE, ["on", "workflow_dispatch", "inputs"]);
    expect(keys(inputs ?? "")).toEqual(["ref", "mode"]);
    expect(scalar(at(inputs, ["ref"]), "required")).toBe("true");
    expect(list(at(inputs, ["mode"]), "options")).toEqual(["build-only", "draft"]);
    expect(at(FIXTURE, ["on", "nope"])).toBeNull();
  });

  it("reads jobs, including a quoted job key", () => {
    expect(jobIds(FIXTURE)).toEqual(["a", "b"]);
    expect(job(FIXTURE, "zzz")).toBeNull();
    expect(scalar(job(FIXTURE, "a"), "runs-on")).toBe("ubuntu-latest");
  });

  it("reads flow and block sequences alike", () => {
    expect(list(job(FIXTURE, "a"), "needs")).toEqual(["x", "y"]);
    expect(list(job(FIXTURE, "b"), "needs")).toEqual(["a"]);
    expect(list(job(FIXTURE, "a"), "runs-on")).toEqual(["ubuntu-latest"]);
    expect(list(job(FIXTURE, "a"), "nope")).toBeNull();
  });

  it("strips a trailing comment but keeps quotes inside the value and # inside quotes", () => {
    expect(scalar(job(FIXTURE, "b"), "if")).toBe("inputs.mode == 'draft'");
    expect(scalar(at(job(FIXTURE, "b"), ["env"]), "URL")).toBe("https://x/#frag");
  });

  it("splits `- ` steps, skipping a comment line between them", () => {
    const s = steps(job(FIXTURE, "a"));
    expect(s).toHaveLength(3);
    expect(scalar(s[0], "name")).toBe("one");
    expect(scalar(s[1], "uses")).toBe("actions/checkout@v6");
    expect(scalar(at(s[1], ["with"]), "ref")).toBe("abc");
  });

  it("reads an inline run and a `run: |` block scalar exactly", () => {
    const s = steps(job(FIXTURE, "a"));
    expect(stepRun(s[0])).toBe("echo hi");
    expect(stepRun(s[1])).toBeNull();
    expect(stepRun(s[2])).toBe('set -e\n# shell comment\necho "a: b"\n\necho done');
    expect(entry(s[2], "run")).toEqual({ inline: null, body: 'set -e\n# shell comment\necho "a: b"\n\necho done' });
  });

  it("returns base-level sequence items dedented", () => {
    expect(items("- a\n- b: 1\n  c: 2")).toEqual(["a", "b: 1\nc: 2"]);
  });

  it("names the parent key of a line", () => {
    expect(parentKey(FIXTURE, lineOf(FIXTURE, "ref: abc"))).toBe("with");
    expect(parentKey(FIXTURE, lineOf(FIXTURE, 'echo "a: b"'))).toBe("run");
    expect(parentKey(FIXTURE, lineOf(FIXTURE, "required: true"))).toBe("ref");
    expect(parentKey(FIXTURE, lineOf(FIXTURE, "uses: actions"))).toBe("steps");
    expect(parentKey(FIXTURE, 0)).toBeNull();
  });
});

describe("W0 unknown constructs throw rather than misparse", () => {
  it.each([
    ["a flow map at job level", "jobs:\n  a: {runs-on: x}\n", (t: string) => job(t, "a")],
    ["a flow map as a step value", "steps:\n  - with: {ref: x}\n", (t: string) => entry(steps(t)[0], "with")],
    ["a compact sequence at the parent's indentation", "steps:\n- run: x\n", (t: string) => steps(t)],
    ["tab indentation", "jobs:\n\ta: 1\n", (t: string) => jobIds(t)],
    ["a duplicate key", "on: x\non: y\n", (t: string) => scalar(t, "on")],
    ["an anchor", "a: &x 1\n", (t: string) => scalar(t, "a")],
    ["an alias", "a: *x\n", (t: string) => scalar(t, "a")],
    ["a non-item line inside a sequence", "- a\nb: 1\n", (t: string) => items(t)],
  ])("%s", (_name, text, read) => {
    expect(() => read(text)).toThrow();
  });
});

describe("W0 law: extraction ignores constant indentation and inserted blank/comment lines", () => {
  const extract = (t: string) => {
    const a = job(t, "a");
    return {
      keys: keys(t),
      jobs: jobIds(t),
      needs: [list(a, "needs"), list(job(t, "b"), "needs")],
      runs: steps(a).map(stepRun),
      ifs: scalar(job(t, "b"), "if"),
      options: list(at(t, ["on", "workflow_dispatch", "inputs", "mode"]), "options"),
    };
  };
  const want = extract(FIXTURE);

  it("has a non-trivial baseline", () => {
    expect(want.runs).toHaveLength(3);
    expect(want.options).toEqual(["build-only", "draft"]);
  });

  it.each([1, 2, 4, 6])("indenting every line by %i spaces", (k) => {
    const shifted = FIXTURE.split("\n").map((l) => (l === "" ? l : " ".repeat(k) + l)).join("\n");
    expect(extract(shifted)).toEqual(want);
  });

  it.each(["", "# noise", "   # indented noise"])("inserting %j before every base-level key", (noise) => {
    const noisy = FIXTURE.split("\n").flatMap((l) => (/^\S/.test(l) ? [noise, l] : [l])).join("\n");
    expect(extract(noisy)).toEqual(want);
  });
});
