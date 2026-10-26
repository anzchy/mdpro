// @vitest-environment node
import { spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeCdp, type FakeCdp, type FakePage } from "../support/fakeCdp";

const CDP = path.resolve(__dirname, "../../.agents/skills/remote-windows-device-test/scripts/windows/cdp.mjs");
const servers: FakeCdp[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); });

function identityPage(id: string, label: string, rect: number[], fail = false): FakePage {
  return {
    id,
    evaluate: (expression) => {
      if (!expression.includes("plugin:window|outer_position")) return undefined;
      if (fail) return { result: { type: "object" }, exceptionDetails: { text: "bounds denied" } };
      return { result: { type: "object", value: { label, rect } } };
    },
  };
}

function run(port: number, args: string[] = ["identity"]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CDP, ...args], { env: { ...process.env, MDPRO_CDP_PORT: String(port) } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
}

describe("B7DRV-WI-1 CDP physical identity acquisition", () => {
  it("binds only the requested page with a nonce title, then restores only that marker", async () => {
    const nonce = "a".repeat(32);
    const challenge = `mdpro [mdpro-b7:${nonce}]`;
    let title = "mdpro";
    const a: FakePage = {
      id: "p1",
      evaluate: (expression) => {
        if (expression.includes("IDENTITY_STALE_BEFORE_BIND")) {
          title = challenge;
          return { result: { type: "object", value: { label: "A", rect: [0, 0, 800, 600], challenge } } };
        }
        if (expression.includes("IDENTITY_UNBIND_MARKER_MISSING")) {
          if (title !== challenge) return { result: { type: "object" }, exceptionDetails: { text: "marker missing" } };
          title = "mdpro";
          return { result: { type: "object", value: { label: "A", restored: true } } };
        }
        return { result: { type: "string", value: "A" } };
      },
    };
    const b: FakePage = { id: "p2", evaluate: () => ({ result: { type: "string", value: "B" } }) };
    const server = await startFakeCdp([a, b]);
    servers.push(server);
    const bind = await run(server.port, ["--window", "A", "bind", Buffer.from(JSON.stringify({ rect: [0, 0, 800, 600], pageId: "p1", nonce })).toString("base64")]);
    expect(bind.status, bind.stderr).toBe(0);
    expect(JSON.parse(bind.stdout)).toMatchObject({ label: "A", challenge });
    expect(title).toBe(challenge);
    expect((server.evaluated.get("p2") ?? []).every((expression) => !expression.includes("set_title"))).toBe(true);
    const unbind = await run(server.port, ["--window", "A", "unbind", Buffer.from(JSON.stringify({ nonce })).toString("base64")]);
    expect(unbind.status, unbind.stderr).toBe(0);
    expect(title).toBe("mdpro");
    const repeated = await run(server.port, ["--window", "A", "unbind", Buffer.from(JSON.stringify({ nonce })).toString("base64")]);
    expect(repeated.status).not.toBe(0);
    expect(title).toBe("mdpro");
    const replaced = await run(server.port, ["--window", "A", "bind", Buffer.from(JSON.stringify({ rect: [0, 0, 800, 600], pageId: "closed-p1", nonce })).toString("base64")]);
    expect(replaced.status).not.toBe(0);
    expect(JSON.parse(replaced.stdout).error).toBe("IDENTITY_PAGE_REPLACED");
    expect(title).toBe("mdpro");
  });

  it("adds stable CDP page ids only to native identity records", async () => {
    const server = await startFakeCdp([identityPage("old-A", "A", [0, 0, 800, 600])]);
    servers.push(server);
    expect(JSON.parse((await run(server.port, ["identity-native"])).stdout)).toEqual([
      { label: "A", rect: [0, 0, 800, 600], pageId: "old-A" },
    ]);
  });

  it("returns every page label and Tauri physical outer bounds, with a fresh read on each invocation", async () => {
    const a = identityPage("p1", "A", [0, 0, 800, 600]);
    const b = identityPage("p2", "B", [900, 0, 1700, 600]);
    const server = await startFakeCdp([a, b]);
    servers.push(server);
    expect(JSON.parse((await run(server.port)).stdout)).toEqual([
      { label: "A", rect: [0, 0, 800, 600] },
      { label: "B", rect: [900, 0, 1700, 600] },
    ]);
    expect((server.evaluated.get("p1") ?? [])[0]).toContain("plugin:window|outer_position");
    expect((server.evaluated.get("p2") ?? [])[0]).toContain("plugin:window|outer_size");
    b.evaluate = identityPage("p2", "B", [901, 0, 1701, 600]).evaluate;
    expect(JSON.parse((await run(server.port)).stdout)[1].rect).toEqual([901, 0, 1701, 600]);
  });

  it("rejects duplicate labels and one page's failed bounds read instead of returning a partial set", async () => {
    for (const pages of [
      [identityPage("p1", "A", [0, 0, 800, 600]), identityPage("p2", "A", [900, 0, 1700, 600])],
      [identityPage("p1", "A", [0, 0, 800, 600]), identityPage("p2", "B", [900, 0, 1700, 600], true)],
    ]) {
      const server = await startFakeCdp(pages);
      servers.push(server);
      const result = await run(server.port);
      expect(result.status).not.toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ error: expect.stringMatching(/IDENTITY/) });
    }
  });
});
