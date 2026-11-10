/**
 * Synchronous SHA-256 (FIPS 180-4) with no Node built-in, so the corpus checks run in Node and in a browser.
 * A string is hashed as its UTF-8 bytes (TextEncoder), the same bytes Node's crypto hash reads from a string,
 * including U+FFFD's encoding for a lone surrogate.
 */
const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const INITIAL_STATE = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const BLOCK_BYTES = 64;
const LENGTH_BYTES = 8;
const rotr = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

function pad(message: Uint8Array): Uint8Array {
  const total = Math.ceil((message.length + 1 + LENGTH_BYTES) / BLOCK_BYTES) * BLOCK_BYTES;
  const padded = new Uint8Array(total);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  // The message length in bits as a 64-bit big-endian integer, split so lengths past 2^32 bits stay exact.
  const bits = message.length * 8;
  view.setUint32(total - LENGTH_BYTES, Math.floor(bits / 0x1_0000_0000));
  view.setUint32(total - LENGTH_BYTES / 2, bits >>> 0);
  return padded;
}

export function sha256Hex(input: string | Uint8Array): string {
  const padded = pad(typeof input === 'string' ? new TextEncoder().encode(input) : input);
  const view = new DataView(padded.buffer);
  const state = [...INITIAL_STATE];
  const schedule = new Uint32Array(64);
  for (let block = 0; block < padded.length; block += BLOCK_BYTES) {
    for (let t = 0; t < 16; t++) schedule[t] = view.getUint32(block + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(schedule[t - 15], 7) ^ rotr(schedule[t - 15], 18) ^ (schedule[t - 15] >>> 3);
      const s1 = rotr(schedule[t - 2], 17) ^ rotr(schedule[t - 2], 19) ^ (schedule[t - 2] >>> 10);
      schedule[t] = (schedule[t - 16] + s0 + schedule[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + ROUND_CONSTANTS[t] + schedule[t]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => { state[index] = (state[index] + value) >>> 0; });
  }
  return state.map(word => word.toString(16).padStart(8, '0')).join('');
}
