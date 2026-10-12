/**
 * A real `.app.tar.gz` for the release fixtures (D175): gzip over a ustar
 * archive laid out the way Tauri's macOS updater archive is
 * (`mdpro.app/`, `Contents/Info.plist`, `Contents/MacOS/mdpro_mcp`,
 * `Contents/MacOS/tauri-app`). The release-id check gunzips and walks the
 * archive, so a fixture must be one it can actually read.
 */
import zlib from "node:zlib";

export type TarEntry = { name: string; data?: Buffer | string; dir?: boolean };

const BLOCK = 512;

const octal = (n: number, width: number): string => `${n.toString(8).padStart(width - 1, "0")}\0`;

/**
 * One header block, checksum filled in. POSIX `ustar\000` magic by default;
 * `gnu` writes `ustar  \0`, which is what Tauri's archive actually carries.
 */
function header(name: string, size: number, dir: boolean, gnu: boolean): Buffer {
  if (Buffer.byteLength(name) > 100) throw new Error(`fixture: tar name over 100 bytes: ${name}`);
  const h = Buffer.alloc(BLOCK, 0);
  h.write(name, 0, "utf8");
  h.write(octal(dir ? 0o755 : 0o644, 8), 100, "latin1");
  h.write(octal(501, 8), 108, "latin1");
  h.write(octal(20, 8), 116, "latin1");
  h.write(octal(size, 12), 124, "latin1");
  h.write(octal(0, 12), 136, "latin1");
  h.write("        ", 148, "latin1");
  h.write(dir ? "5" : "0", 156, "latin1");
  h.write(gnu ? "ustar  \u0000" : "ustar\u000000", 257, "latin1");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
  return h;
}

/** A ustar archive of `entries` (uncompressed), ended by two zero blocks. */
export function tar(entries: TarEntry[], gnu = false): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = e.dir ? Buffer.alloc(0) : Buffer.from(e.data ?? "");
    parts.push(header(e.name, data.length, e.dir === true, gnu), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(parts);
}

/**
 * The macOS updater archive for `arch`. `releaseId` (if any) is embedded in
 * the main binary `tauri-app`; `sidecar` is the content of `mdpro_mcp`.
 */
export function appTarball(arch: string, opts: { releaseId?: string; sidecar?: string } = {}): Buffer {
  const binary = `Ïúíþ fake ${arch} tauri-app ${opts.releaseId ?? ""} rest of rodata`;
  return zlib.gzipSync(
    tar([
      { name: "mdpro.app/", dir: true },
      { name: "mdpro.app/Contents/", dir: true },
      { name: "mdpro.app/Contents/Info.plist", data: `<plist>${arch}</plist>` },
      { name: "mdpro.app/Contents/MacOS/", dir: true },
      { name: "mdpro.app/Contents/MacOS/mdpro_mcp", data: opts.sidecar ?? `fake ${arch} sidecar` },
      { name: "mdpro.app/Contents/MacOS/tauri-app", data: binary },
    ]),
  );
}
