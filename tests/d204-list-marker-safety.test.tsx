/**
 * D204, audit b131 — the marker a list is written with stays safe when the list's own marker
 * has to change, and a list with no source marker gets ADR-0099's default even inside a list
 * that has one.
 *
 * - A rows: the stock writer switches a list's marker when the list would merge with the list
 *   before it, or when an item's thematic break would make the line one big break. With the
 *   marker kept per list, the alternate it switched to could satisfy one rule and break the
 *   other, so two lists merged on reopen or a break left its list. Each row pins that the
 *   saved bytes reopen as the structure that was saved.
 * - N rows: an unmarked list nested in a `*`, `+` or `)` list inherited the parent's marker
 *   instead of the `-` / `.` default.
 *
 * Real `MilkdownEditor` through tests/support/d188EmptyParagraphRig. Mocked:
 * `@tauri-apps/api/{core,event,window}` and `loggingService` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: async () => {},
    generateActionId: () => "test-id",
  },
}));

import { createHeldInvoke } from "./helpers/heldInvoke";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { createRig, type Rig } from "./support/d188EmptyParagraphRig";

type S = Parameters<Parameters<Rig["replaceWith"]>[0]>[0];
const para = (s: S, t: string) => s.nodes.paragraph.create(null, t ? s.text(t) : undefined);
const item = (s: S, ...kids: ReturnType<S["nodes"]["paragraph"]["create"]>[]) => s.nodes.list_item.create(null, kids);

describe("D204 b131 — a switched marker satisfies both stock safety rules", () => {
  it("A1 a `*` list of a thematic break after a `-` list stays a second list", async () => {
    await rig.open("- a\n\n* ---\n* b\n");
    const opened = rig.shape();
    expect(opened).toBe("ul[li[p(a)]] ul[li[∅ hr[]] li[p(b)]]");
    rig.typeAtEndOf("a", "!");
    await rig.settle();
    const bytes = rig.doc().content;
    expect(bytes).toBe("- a!\n\n+ ***\n+ b\n");
    await rig.open(bytes);
    expect(rig.shape()).toBe("ul[li[p(a!)]] ul[li[∅ hr[]] li[p(b)]]");
  });

  it("A2 two editor-built lists, the second starting with a thematic break, keep the break inside it", async () => {
    await rig.open("x\n");
    rig.replaceWith((s) => [
      s.nodes.bullet_list.create(null, [item(s, para(s, "a"))]),
      s.nodes.bullet_list.create(null, [item(s, para(s, ""), s.nodes.hr.create()), item(s, para(s, "b"))]),
    ]);
    await rig.settle();
    const built = rig.shape();
    const bytes = rig.doc().content;
    expect(bytes).toBe("- a\n\n+ ***\n+ b\n");
    await rig.open(bytes);
    expect(rig.shape()).toBe(built);
  });

  it("A3 guard: a `*` list of a thematic break with nothing before it still switches to `-`", async () => {
    await rig.open("* ---\n* a\n");
    rig.typeAtEndOf("a", "!");
    await rig.settle();
    expect(rig.doc().content).toBe("- ***\n- a!\n");
  });
});

describe("D204 b131 — an unmarked nested list gets the default, not its parent's marker", () => {
  it("N4 an unmarked bullet list inside a `*` list is written with `-`", async () => {
    await rig.open("x\n");
    rig.replaceWith((s) => [
      s.nodes.bullet_list.create({ marker: "*" }, [
        item(s, para(s, "a"), s.nodes.bullet_list.create(null, [item(s, para(s, "x"))])),
      ]),
    ]);
    await rig.settle();
    expect(rig.doc().content).toBe("* a\n\n  - x\n");
  });

  it("N5 an unmarked bullet list inside a `+` list is written with `-`", async () => {
    await rig.open("x\n");
    rig.replaceWith((s) => [
      s.nodes.bullet_list.create({ marker: "+" }, [
        item(s, para(s, "a"), s.nodes.bullet_list.create(null, [item(s, para(s, "x"))])),
      ]),
    ]);
    await rig.settle();
    expect(rig.doc().content).toBe("+ a\n\n  - x\n");
  });

  it("N6 an unmarked ordered list inside a `)` list is written with `.`", async () => {
    await rig.open("x\n");
    rig.replaceWith((s) => [
      s.nodes.ordered_list.create({ delimiter: ")" }, [
        item(s, para(s, "a"), s.nodes.ordered_list.create(null, [item(s, para(s, "x"))])),
      ]),
    ]);
    await rig.settle();
    expect(rig.doc().content).toBe("1) a\n\n   1. x\n");
  });
});

let rig: Rig;

beforeEach(() => {
  installIntersectionObserverDouble();
  invokeMock.mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
  rig = createRig(createHeldInvoke(invokeMock));
});

afterEach(async () => {
  await rig.close();
});
