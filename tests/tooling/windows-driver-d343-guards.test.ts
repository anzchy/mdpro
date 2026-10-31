// @vitest-environment node
import { describe, expect, it } from "vitest";
import { check, decodedShapes, rawRow, type Row } from "./windows-driver-d343-harness";
const INVALID = "UI_STEPS_INVALID";
const operations = ['windows','focus','max','menuinfo','visible','showall','restore','layout','setLayout','chord','physicalChord','menus','shot','wait','filedialog','dialogReceipt','clickat','menuat','menuclick','open','run','tree'];
describe("D343 strict list structure and boundaries", () => {
  it("accepts empty lists and rejects scalar, nested, null and invalid fields", async () => {
    const invalid = ['{}','null','1','"max"','[[{"op":"max"}]]','[[]]',
      '[{"op":"max"},[{"op":"windows"}]]','[[{"op":"max"}],{"op":"windows"}]',
      '[null]','[{"op":"max"},null]','[1]','[true]','["max"]','[{}]',
      '[{"op":""}]','[{"op":1}]','[{"op":"MAX"}]','[{"op":"unknown"}]',
      '[{"op":"max","window":1}]','[{"op":"max","window":null}]','[{"op":"max","window":""}]'];
    await check([
      rawRow("empty", "[]"), rawRow("main", '[{"op":"max","window":"main"}]'),
      rawRow("CJK", '[{"op":"windows","window":"中文"}]'),
      ...invalid.map((raw, i) => rawRow("invalid" + i, raw, INVALID)),
    ]);
  });
  it("keeps malformed transport and JSON failures at the public error boundary", async () => {
    await check([
      { id: "base64", b64: "%%%", error: INVALID }, { id: "UTF8", b64: "/w==", error: INVALID },
      ...['','[','[{"op":"max"}','[not-json]','[ ],"steps":[{"op":"max"}]'].map((raw, i) => rawRow(String(i), raw, INVALID)),
    ]);
  });
  it("uses inclusive decoded UTF8 byte and element count limits", async () => {
    const rows: Row[] = [1000, 1001].map((count) => rawRow("count" + count, JSON.stringify(Array.from({ length: count }, () => ({ op: "windows" }))), count > 1000 ? INVALID : undefined));
    for (const raw of ['[{"op":"max"}]', '[{"op":"max","window":"中文"}]']) {
      for (const size of [65536, 65537]) {
        const padded = raw + " ".repeat(size - Buffer.byteLength(raw));
        expect(Buffer.byteLength(padded)).toBe(size);
        rows.push(rawRow(raw + size, padded, size > 65536 ? "UI_STEPS_TOO_LARGE" : undefined));
      }
    }
    rows.push(rawRow("oversized malformed", "[" + " ".repeat(65536), "UI_STEPS_TOO_LARGE"));
    await check(rows);
  });
  it("conserves enumerated bytes and preserves every decoded member shape", async () => {
    const tables: { id: string; value: unknown; count: number | null; shapes: string[]; error?: string }[] = [
      { id: "empty", value: [], count: 0, shapes: [] },
      { id: "one", value: [{ op: "max" }], count: 1, shapes: ["object"] },
      { id: "two", value: [{ op: "max" }, { op: "windows", window: "中文" }], count: 2, shapes: ["object", "object"] },
      { id: "many", value: operations.slice(0, 8).map((op, i) => ({ op, window: ["main", "中文", "😀", "a b"][i % 4] })), count: 8, shapes: Array(8).fill("object") },
      { id: "null", value: [{ op: "max" }, null], count: 2, shapes: ["object", "null"], error: INVALID },
      { id: "nested", value: [{ op: "max" }, [{ op: "windows" }]], count: 2, shapes: ["object", "array"], error: INVALID },
      { id: "inside", value: [{ op: "max", payload: { nested: [{ value: "中文" }] } }], count: 1, shapes: ["object"] },
      { id: "nonarray", value: { op: "max" }, count: null, shapes: [], error: INVALID },
    ];
    const rows: Row[] = operations.map((op) => rawRow(op, JSON.stringify([{ op }])));
    const shapeRows = tables.map((entry, i) => {
      const raw = JSON.stringify(entry.value, null, i % 2 ? "  " : undefined).replace(/\n/g, i % 4 === 3 ? "\r\n" : "\n");
      rows.push(rawRow(entry.id, raw, entry.error));
      return { id: entry.id, raw };
    });
    expect(await decodedShapes(shapeRows)).toEqual(tables.map((entry) => ({
      id: entry.id, count: entry.count, shapes: entry.shapes, value: entry.value,
    })));
    expect(await check(rows)).toEqual(await check(rows));
  });
});
