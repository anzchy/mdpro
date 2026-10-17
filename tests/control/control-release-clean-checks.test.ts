// @vitest-environment node
/**
 * ADR-0047 WI-009 WI 5: the four layers of the release clean check, as pure
 * judgements over what each layer reads (plan WI-009 item 10; ADR-0034
 * decision 4 plus ADR-0047 decision 6's runtime activation). Each returns
 * null when its layer is clean, or the reason it is not; unreadable input is
 * never clean.
 */
import { describe, expect, it } from "vitest";
import {
  binaryFinding,
  distFinding,
  featureGraphFinding,
  homeFinding,
  listenerFinding,
  SI_SOCK_RELEASE,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../../scripts/control/releaseCleanChecks.mjs";

describe("layer 1: the default feature graph", () => {
  const tree = (...features: string[]) =>
    ["tauri-app v0.3.5 (/repo/src-tauri)", ...features.map((f) => `tauri-app feature "${f}"`)].join("\n");

  it("is clean when tauri-app enables neither channel feature", () => {
    expect(featureGraphFinding(tree("default"))).toBeNull();
  });

  it.each(["control-channel", "verify-run"])("names %s when the default build enables it", (f) => {
    expect(featureGraphFinding(tree("default", f))).toBe(`layer 1: the default build enables ${f}`);
  });

  it("is not clean when the output does not mention tauri-app", () => {
    expect(featureGraphFinding("")).toBe("layer 1: cargo tree printed no tauri-app");
  });
});

describe("layer 2: the release dist", () => {
  it("is clean when no file carries a channel marker", () => {
    expect(distFinding([{ path: "assets/index.js", text: "console.log(1)" }])).toBeNull();
  });

  it.each(["__mdproCtl", "control-optin.json", "mdpro-control"])("names the file that carries %s", (m) => {
    const files = [
      { path: "index.html", text: "<html>" },
      { path: "assets/a.js", text: `x=${m}` },
    ];
    expect(distFinding(files)).toBe(`layer 2: assets/a.js contains ${m}`);
  });

  it("is not clean when dist is empty", () => {
    expect(distFinding([])).toBe("layer 2: dist has no files");
  });
});

describe("layer 3: the release binary", () => {
  it("is clean when the binary carries no channel string", () => {
    expect(binaryFinding(Buffer.from("mcp.http_server.start app.launch"))).toBeNull();
  });

  it.each(["control.listen", "control-optin.json", "mdpro-control"])("names %s when the binary carries it", (m) => {
    expect(binaryFinding(Buffer.from(`abc\0${m}\0def`))).toBe(`layer 3: the binary contains ${m}`);
  });

  it("is not clean when the binary is empty", () => {
    expect(binaryFinding(Buffer.alloc(0))).toBe("layer 3: the binary is empty");
  });
});

describe("layer 4: what the release app listens on with the opt-in present", () => {
  const tcp = (...names: string[]) => ["p501", "f12", ...names.map((n) => `n${n}`)].join("\n");
  const unix = (...names: string[]) => ["p501", ...names.flatMap((n, i) => [`f${20 + i}`, `n${n}`])].join("\n");

  it("is clean with the MCP loopback listener and the single-instance socket only", () => {
    expect(listenerFinding(tcp("127.0.0.1:51234"), unix(SI_SOCK_RELEASE, "->0x1234abcd"))).toBeNull();
  });

  it("names the control socket when it is listening", () => {
    expect(listenerFinding(tcp("127.0.0.1:51234"), unix(SI_SOCK_RELEASE, "/x/ctl.sock"))).toBe(
      "layer 4: unexpected socket /x/ctl.sock",
    );
  });

  it("names a TCP listener off loopback", () => {
    expect(listenerFinding(tcp("*:8080"), unix(SI_SOCK_RELEASE))).toBe("layer 4: TCP listener *:8080 is not on loopback");
  });

  it("names a second TCP listener", () => {
    expect(listenerFinding(tcp("127.0.0.1:1", "127.0.0.1:2"), unix())).toBe(
      "layer 4: 2 TCP listeners, expected at most 1 (MCP)",
    );
  });

  it("is not clean when lsof printed nothing for the process", () => {
    expect(listenerFinding("", "")).toBe("layer 4: lsof printed nothing for the process");
  });

  it("is clean on the home when no handoff exists", () => {
    expect(homeFinding(["Library/Application Support/mdpro/server.port", "control-optin.json"])).toBeNull();
  });

  it.each(["control.json", "ctl.sock", "sub/ctl.sock"])("names %s left in the home", (p) => {
    expect(homeFinding(["control-optin.json", p])).toBe(`layer 4: the app wrote ${p}`);
  });
});
