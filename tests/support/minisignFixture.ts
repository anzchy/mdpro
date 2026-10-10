/**
 * Minisign / Tauri-updater signature fixtures for the D76 release tests
 * (WI-3 asset sets, WI-4 verifier). Keys are generated in-process with
 * `crypto.generateKeyPairSync("ed25519")`; no real secret is involved.
 *
 * Formats (minisign, as the Tauri signer writes them, base64-wrapped once more):
 *   public key file:  "untrusted comment: minisign public key: <KEYID>\n"
 *                     + base64("Ed" ‖ keyId[8] ‖ ed25519 pk[32]) + "\n"
 *   signature file:   "untrusted comment: <text>\n"
 *                     + base64(alg[2] ‖ keyId[8] ‖ sig[64]) + "\n"
 *                     + "trusted comment: <tc>\n"
 *                     + base64(ed25519(sig[64] ‖ tc)) + "\n"
 *   alg "ED" signs blake2b-512(file); legacy "Ed" signs the file bytes.
 * Tauri stores both files base64-encoded once more (tauri.conf.json `pubkey`, `.sig`).
 * `<KEYID>` is the 8 key-id bytes read as a little-endian u64, in upper-case hex.
 */
import crypto from "node:crypto";

export type MinisignKey = {
  keyId: Buffer;
  privateKey: crypto.KeyObject;
  /** Raw 32-byte ed25519 public key. */
  rawPublic: Buffer;
  /** The tauri.conf.json `plugins.updater.pubkey` value. */
  tauriPubkey: string;
  /** The comment form of the key id, e.g. "08058EFE2F4419D7". */
  keyIdHex: string;
};

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64");

export function makeMinisignKey(keyIdBytes?: Buffer): MinisignKey {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  const rawPublic = Buffer.from(der.subarray(der.length - 32));
  const keyId = keyIdBytes ?? crypto.randomBytes(8);
  const keyIdHex = Buffer.from(keyId).reverse().toString("hex").toUpperCase();
  const file =
    `untrusted comment: minisign public key: ${keyIdHex}\n` +
    `${b64(Buffer.concat([Buffer.from("Ed"), keyId, rawPublic]))}\n`;
  return { keyId, privateKey, rawPublic, tauriPubkey: b64(file), keyIdHex };
}

export type SignOptions = {
  alg?: "ED" | "Ed";
  trustedComment?: string;
  /** Sign with this key's private key but stamp `keyId` (to fake a key-id match). */
  stampKeyId?: Buffer;
};

/** The parts of a minisign signature file, before the outer base64. */
export type SigParts = { untrusted: string; sigLine: string; trusted: string; globalLine: string };

export function signParts(key: MinisignKey, data: Buffer | string, opts: SignOptions = {}): SigParts {
  const alg = opts.alg ?? "ED";
  const bytes = Buffer.from(data);
  const message = alg === "ED" ? crypto.createHash("blake2b512").update(bytes).digest() : bytes;
  const sig = crypto.sign(null, message, key.privateKey);
  const tc = opts.trustedComment ?? "timestamp:1760054400\tfile:mdpro.app.tar.gz";
  const globalSig = crypto.sign(null, Buffer.concat([sig, Buffer.from(tc)]), key.privateKey);
  return {
    untrusted: "untrusted comment: signature from tauri secret key",
    sigLine: b64(Buffer.concat([Buffer.from(alg), opts.stampKeyId ?? key.keyId, sig])),
    trusted: `trusted comment: ${tc}`,
    globalLine: b64(globalSig),
  };
}

/** Join parts into the Tauri `.sig` text (base64 of the minisign file). */
export const joinSig = (p: SigParts): string => b64(`${p.untrusted}\n${p.sigLine}\n${p.trusted}\n${p.globalLine}\n`);

/** A valid Tauri `.sig` for `data`. */
export const signTauri = (key: MinisignKey, data: Buffer | string, opts: SignOptions = {}): string =>
  joinSig(signParts(key, data, opts));
