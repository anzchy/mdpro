/**
 * A fake Chrome DevTools endpoint for the Windows driver's `scripts/windows/cdp.mjs`: `/json/list`
 * over `node:http`, and a minimal WebSocket server (RFC 6455 handshake, unfragmented text frames,
 * masked from the client) for each page. No dependency: Node has a WebSocket client but no server.
 *
 * Each page answers `Runtime.evaluate` through its own `evaluate(expression)`; every other method
 * gets an empty result. `evaluated` records each page's expressions, so a test can tell which page
 * ran the user's eval.
 *
 * `connections` records each WebSocket the client opened and whether it sent a close frame before
 * the TCP connection ended (D248). The server answers a close frame with its own, as a real one
 * does, so the client's `close` event can fire. With `closeReplyDelayMs` it holds that reply, and
 * `openAtReply` says whether the client's TCP was still open when it went out: a client that
 * exits while its socket is still CLOSING has already gone (audit b171 H1).
 */
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";

export interface FakePage {
  id: string;
  url?: string;
  type?: string;
  /** The `Runtime.evaluate` response's `result`, e.g. `{ result: { value: 1 } }`. */
  evaluate?: (expression: string) => unknown;
  /**
   * A protocol-level error for this call instead of a result (audit b163 H1), e.g.
   * `{ code: -32000, message: "Execution context was destroyed." }`. Undefined → answer normally.
   */
  error?: (method: string, expression: string) => { code: number; message: string } | undefined;
  /** Never answer this call (D248: drives cdp.mjs into its CDP_TIMEOUT path). */
  hang?: (method: string, expression: string) => boolean;
}

/** One client WebSocket: its page, whether it sent a close frame, and whether TCP has ended. */
export interface FakeConnection {
  page: string;
  closeFrame: boolean;
  ended: boolean;
  /** The client's TCP was still open when the server's close reply went out. */
  openAtReply?: boolean;
}

export interface FakeCdpOptions {
  /** Hold the server's close reply this long after the client's close frame. */
  closeReplyDelayMs?: number;
}

export interface FakeCdp {
  port: number;
  evaluated: Map<string, string[]>;
  connections: FakeConnection[];
  /** Resolves once every connection's TCP has ended, or after `ms`. */
  settled(ms?: number): Promise<void>;
  close(): Promise<void>;
}

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** A server close frame, status 1000 (normal closure). */
const CLOSE_FRAME = Buffer.from([0x88, 0x02, 0x03, 0xe8]);

function frame(text: string): Buffer {
  const body = Buffer.from(text, "utf8");
  const len = body.length;
  const head = len < 126 ? Buffer.from([0x81, len]) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  if (len >= 126 && len < 65536) {
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else if (len >= 65536) {
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, body]);
}

/** Pull whole client frames off `buf`; returns the texts and the unread rest. */
function unframe(buf: Buffer): { texts: string[]; rest: Buffer; closed: boolean } {
  const texts: string[] = [];
  let closed = false;
  let off = 0;
  while (buf.length - off >= 2) {
    const op = buf[off] & 0x0f;
    let len = buf[off + 1] & 0x7f;
    let p = off + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    if (buf.length - p < 4 + len) break;
    const mask = buf.subarray(p, p + 4);
    const data = Buffer.from(buf.subarray(p + 4, p + 4 + len));
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    if (op === 0x1) texts.push(data.toString("utf8"));
    if (op === 0x8) closed = true;
    off = p + 4 + len;
  }
  return { texts, rest: buf.subarray(off), closed };
}

export async function startFakeCdp(pages: FakePage[], opts: FakeCdpOptions = {}): Promise<FakeCdp> {
  const evaluated = new Map<string, string[]>(pages.map((p) => [p.id, []]));
  const sockets = new Set<Socket>();
  const connections: FakeConnection[] = [];
  const server = http.createServer((req, res) => {
    const { port } = server.address() as AddressInfo;
    if (req.url === "/json/list") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          pages.map((p) => ({
            id: p.id,
            type: p.type ?? "page",
            url: p.url ?? "http://tauri.localhost/",
            webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${p.id}`,
          })),
        ),
      );
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  server.on("upgrade", (req, socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const page = pages.find((p) => req.url === `/devtools/page/${p.id}`);
    if (!page) return socket.destroy();
    const conn: FakeConnection = { page: page.id, closeFrame: false, ended: false };
    connections.push(conn);
    socket.on("end", () => (conn.ended = true));
    socket.on("close", () => (conn.ended = true));
    const accept = crypto
      .createHash("sha1")
      .update(String(req.headers["sec-websocket-key"]) + GUID)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      const r = unframe(Buffer.concat([buf, chunk]));
      buf = r.rest;
      for (const text of r.texts) {
        const msg = JSON.parse(text) as { id: number; method: string; params?: { expression?: string } };
        if (page.hang?.(msg.method, msg.params?.expression ?? "")) continue;
        const err = page.error?.(msg.method, msg.params?.expression ?? "");
        if (err) {
          socket.write(frame(JSON.stringify({ id: msg.id, error: err })));
          continue;
        }
        let result: unknown = {};
        if (msg.method === "Runtime.evaluate") {
          const expr = msg.params?.expression ?? "";
          evaluated.get(page.id)?.push(expr);
          result = page.evaluate?.(expr) ?? { result: {} };
        }
        socket.write(frame(JSON.stringify({ id: msg.id, result })));
      }
      if (r.closed) {
        conn.closeFrame = true;
        const reply = () => {
          conn.openAtReply = !conn.ended && !socket.destroyed;
          if (conn.openAtReply) socket.end(CLOSE_FRAME);
        };
        if (opts.closeReplyDelayMs) setTimeout(reply, opts.closeReplyDelayMs);
        else reply();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    evaluated,
    connections,
    settled: async (ms = 3000) => {
      const until = Date.now() + ms;
      while (connections.some((c) => !c.ended) && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
