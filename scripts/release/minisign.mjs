/**
 * Purpose: Verify a Tauri updater signature (D76-WI-4) with node:crypto only:
 * the `.sig` must be a minisign signature by the key embedded in
 * tauri.conf.json, over these exact bytes, with an intact trusted comment.
 * Pure; never throws.
 *
 * Formats (each base64-wrapped once more by Tauri):
 *   public key: "untrusted comment: …\n" + base64("Ed" ‖ keyId[8] ‖ ed25519 pk[32])
 *   signature:  "untrusted comment: …\n" + base64(alg[2] ‖ keyId[8] ‖ sig[64]) + "\n"
 *               + "trusted comment: <tc>\n" + base64(ed25519(sig ‖ tc)[64])
 *   alg "ED" signs blake2b-512(file) (what the Tauri signer writes); legacy "Ed"
 *   signs the file bytes.
 *
 * Pipeline: verifyFile(bytes, sig, pub) → parsePublicKey → parseSignature →
 *   key id equal (key-id-mismatch) → ed25519 over the (pre)hash (bad-signature)
 *   → ed25519 over sig ‖ trusted comment (bad-global-signature) → { ok: true }.
 *
 * Key decisions:
 * - Five typed reasons, a closed set (REASONS). Any structural fault — not
 *   base64, wrong line count, wrong decoded length, missing
 *   "trusted comment: " prefix — is `bad-base64`: the input is not a minisign
 *   file at all, which is a different failure from a well-formed signature
 *   that does not verify.
 * - Base64 is checked strictly (alphabet, padding, round trip); Node's lenient
 *   decoder alone would turn garbage into bytes.
 * - The key id is compared before any signature math, so a wrong-key release
 *   reports `key-id-mismatch` rather than a generic failure.
 *
 * @module scripts/release/minisign
 * @coordinates-with scripts/release/verify-assets.mjs (verifies every signed asset)
 * @coordinates-with src-tauri/tauri.conf.json (plugins.updater.pubkey)
 */
import crypto from "node:crypto";

export const REASONS = Object.freeze([
  "bad-base64",
  "bad-algorithm",
  "key-id-mismatch",
  "bad-signature",
  "bad-global-signature",
]);

const KEY_ID_LEN = 8;
const PK_LEN = 32;
const SIG_LEN = 64;
const ALG_LEN = 2;
const TRUSTED_PREFIX = "trusted comment: ";
const UNTRUSTED_PREFIX = "untrusted comment: ";
/** DER SPKI header for a raw 32-byte ed25519 public key (RFC 8410). */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** @param {string} reason */
const fail = (reason) => ({ ok: /** @type {const} */ (false), reason });

/**
 * Strict base64 → Buffer, or null.
 * @param {unknown} text
 */
function strictBase64(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (t === "" || !B64.test(t)) return null;
  return Buffer.from(t, "base64");
}

/**
 * Lines of a minisign file wrapped in one more base64 layer.
 * @param {unknown} outer
 * @param {number} count expected number of lines
 */
function minisignLines(outer, count) {
  const inner = strictBase64(outer);
  if (!inner) return null;
  const lines = inner.toString("utf8").replace(/\r?\n$/, "").split(/\r?\n/);
  if (lines.length !== count || !lines[0].startsWith(UNTRUSTED_PREFIX)) return null;
  return lines;
}

/**
 * @param {unknown} tauriPubkey the tauri.conf.json `plugins.updater.pubkey` value
 * @returns {{ ok: true, algorithm: string, keyId: Buffer, keyIdHex: string, publicKey: Buffer }
 *         | { ok: false, reason: string }}
 */
export function parsePublicKey(tauriPubkey) {
  const lines = minisignLines(tauriPubkey, 2);
  const raw = lines && strictBase64(lines[1]);
  if (!raw || raw.length !== ALG_LEN + KEY_ID_LEN + PK_LEN) return fail("bad-base64");
  const algorithm = raw.subarray(0, ALG_LEN).toString("latin1");
  if (algorithm !== "Ed") return fail("bad-algorithm");
  const keyId = Buffer.from(raw.subarray(ALG_LEN, ALG_LEN + KEY_ID_LEN));
  return {
    ok: true,
    algorithm,
    keyId,
    keyIdHex: Buffer.from(keyId).reverse().toString("hex").toUpperCase(),
    publicKey: Buffer.from(raw.subarray(ALG_LEN + KEY_ID_LEN)),
  };
}

/**
 * @param {unknown} tauriSig the `.sig` file's text
 * @returns {{ ok: true, algorithm: string, keyId: Buffer, signature: Buffer, trustedComment: string,
 *             globalSignature: Buffer } | { ok: false, reason: string }}
 */
export function parseSignature(tauriSig) {
  const lines = minisignLines(tauriSig, 4);
  if (!lines) return fail("bad-base64");
  const raw = strictBase64(lines[1]);
  const globalSignature = strictBase64(lines[3]);
  if (!raw || raw.length !== ALG_LEN + KEY_ID_LEN + SIG_LEN) return fail("bad-base64");
  if (!globalSignature || globalSignature.length !== SIG_LEN) return fail("bad-base64");
  if (!lines[2].startsWith(TRUSTED_PREFIX)) return fail("bad-base64");
  const algorithm = raw.subarray(0, ALG_LEN).toString("latin1");
  if (algorithm !== "ED" && algorithm !== "Ed") return fail("bad-algorithm");
  return {
    ok: true,
    algorithm,
    keyId: Buffer.from(raw.subarray(ALG_LEN, ALG_LEN + KEY_ID_LEN)),
    signature: Buffer.from(raw.subarray(ALG_LEN + KEY_ID_LEN)),
    trustedComment: lines[2].slice(TRUSTED_PREFIX.length),
    globalSignature,
  };
}

/** @param {Buffer} message @param {Buffer} signature @param {Buffer} rawPublic */
function ed25519Verify(message, signature, rawPublic) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublic]), format: "der", type: "spki" });
    return crypto.verify(null, message, key, signature);
  } catch {
    return false;
  }
}

/**
 * @param {unknown} bytes the signed file's bytes
 * @param {unknown} tauriSig the `.sig` file's text
 * @param {unknown} tauriPubkey the tauri.conf.json pubkey
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyFile(bytes, tauriSig, tauriPubkey) {
  const pub = parsePublicKey(tauriPubkey);
  if (!pub.ok) return fail(pub.reason);
  const sig = parseSignature(tauriSig);
  if (!sig.ok) return fail(sig.reason);
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) return fail("bad-signature");
  if (!sig.keyId.equals(pub.keyId)) return fail("key-id-mismatch");
  const data = Buffer.from(/** @type {Uint8Array} */ (bytes));
  const message = sig.algorithm === "ED" ? crypto.createHash("blake2b512").update(data).digest() : data;
  if (!ed25519Verify(message, sig.signature, pub.publicKey)) return fail("bad-signature");
  const global = Buffer.concat([sig.signature, Buffer.from(sig.trustedComment, "utf8")]);
  if (!ed25519Verify(global, sig.globalSignature, pub.publicKey)) return fail("bad-global-signature");
  return { ok: true };
}
