// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

type Key = { defaults: { v1: string | null; v2: string | null } };
type Row = { id: string; key: { macos: Key; windows: Key } };

it("enumerates every changed v1 → v2 default for both editor modes in the device input", () => {
  const root = path.resolve(__dirname, "..");
  const layout = JSON.parse(readFileSync(path.join(root, "src-tauri/src/menu_layout.json"), "utf8")) as { rows: Row[] };
  const markdown = readFileSync(path.join(root, "docs/test/20261023-m1b-device-chords.md"), "utf8");
  const expected = layout.rows.flatMap((row) => (["macos", "windows"] as const).flatMap((platform) => {
    const { v1, v2 } = row.key[platform].defaults;
    return v1 === v2 ? [] : (["W", "S"] as const).map((mode) => `${platform}/${mode}/${row.id}`);
  }));
  const actual = [...markdown.matchAll(/^\| (macos|windows) \| (W|S) \| ([\w.]+) \|/gm)]
    .map(([, platform, mode, id]) => `${platform}/${mode}/${id}`);
  expect(actual).toHaveLength(74);
  expect(new Set(actual).size).toBe(actual.length);
  expect(actual.sort()).toEqual(expected.sort());
});

it("keeps sentinel values out of physical old chords and names the off-Mac inline-code owner", () => {
  const markdown = readFileSync(path.resolve(__dirname, "../docs/test/20261023-m1b-device-chords.md"), "utf8");
  for (const mode of ["W", "S"]) {
    expect(markdown).toContain(`| windows | ${mode} | format.image | no physical chord | Cmd+Shift+I |`);
    expect(markdown).toContain(`| windows | ${mode} | format.strike | Ctrl+Shift+\` | Cmd+Shift+X | format.strike once | format.code |`);
  }
});
