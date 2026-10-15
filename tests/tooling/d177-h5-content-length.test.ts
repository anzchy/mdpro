// @vitest-environment node
/**
 * D177-H5-WI-1 (audit b96 L4): a crafted Content-Length never reaches the log raw.
 *
 * The 413 line logs the header through the same rule as other request values:
 * itself when it is at most 64 chars of [A-Za-z0-9._-], else `<str>` or
 * `<long str>`. fetch() cannot set Content-Length, so the request is written
 * on a raw socket, with the fixture's token so it gets past the 401 check.
 * The port comes from the receiver's own "listening on" log line.
 *
 * Boundary: a real receiver.py child on 127.0.0.1, a temp hook dir, a fake
 * token generated here.
 */
import net from "node:net";
import { describe, expect, it } from "vitest";
import { useReceiver } from "../support/d177ReceiverFixture";

const fx = useReceiver();

function rawPost(contentLength: string): Promise<string> {
  const port = Number(/listening on 127\.0\.0\.1:(\d+)/.exec(fx.log())?.[1]);
  expect(port, "receiver port in its log").toBeGreaterThan(0);
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    let reply = "";
    sock.on("data", (c) => (reply += c));
    sock.on("close", () => resolve(reply.split("\r\n")[0] ?? ""));
    sock.on("error", () => resolve(""));
    sock.setTimeout(5000, () => sock.destroy());
    sock.write(
      `POST /hook HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Mdpro-Token: ${fx.token}\r\n` +
        `Content-Type: application/json\r\nContent-Length: ${contentLength}\r\nConnection: close\r\n\r\n`,
    );
  });
}

async function logOf(contentLength: string): Promise<{ status: string; text: string }> {
  const before = fx.log().length;
  const status = await rawPost(contentLength);
  return { status, text: fx.log().slice(before) };
}

describe("D177-H5 Content-Length in the log", () => {
  it("c1: a 4000-digit Content-Length is 413 and logs as <long str>", async () => {
    const { status, text } = await logOf("9".repeat(4000));
    expect(status).toContain(" 413 ");
    expect(text).not.toContain("9".repeat(65));
    expect(text).toContain("length=<long str>");
  });

  it("c2: a Content-Length with odd characters is 413 and logs as <str>", async () => {
    const { status, text } = await logOf("12;x=y");
    expect(status).toContain(" 413 ");
    expect(text).toContain("length=<str>");
    expect(text).not.toContain("x=y");
  });

  it("c3: a plain too-large Content-Length still logs as itself", async () => {
    const { status, text } = await logOf("5000000");
    expect(status).toContain(" 413 ");
    expect(text).toContain("-> 413 length=5000000");
  });
});
