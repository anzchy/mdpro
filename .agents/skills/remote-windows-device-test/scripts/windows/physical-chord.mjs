// Fixed PC Set 1 scan codes describe physical locations, independent of the active layout.
// The Windows driver separately verifies the target window thread's HKL before every SendInput.
import { fileURLToPath } from "node:url";

const keys = {};
for (const [index, letter] of [..."QWERTYUIOP"].entries()) keys[`Key${letter}`] = { scan: 0x10 + index };
Object.assign(keys, {
  KeyA: { scan: 0x1e }, KeyS: { scan: 0x1f }, KeyD: { scan: 0x20 }, KeyF: { scan: 0x21 },
  KeyG: { scan: 0x22 }, KeyH: { scan: 0x23 }, KeyJ: { scan: 0x24 }, KeyK: { scan: 0x25 }, KeyL: { scan: 0x26 },
  KeyZ: { scan: 0x2c }, KeyX: { scan: 0x2d }, KeyC: { scan: 0x2e }, KeyV: { scan: 0x2f },
  KeyB: { scan: 0x30 }, KeyN: { scan: 0x31 }, KeyM: { scan: 0x32 },
  BracketLeft: { scan: 0x1a }, BracketRight: { scan: 0x1b },
  Backquote: { scan: 0x29 }, Minus: { scan: 0x0c }, Equal: { scan: 0x0d },
  Semicolon: { scan: 0x27 }, Quote: { scan: 0x28 }, Backslash: { scan: 0x2b },
  Comma: { scan: 0x33 }, Period: { scan: 0x34 }, Slash: { scan: 0x35 },
  ControlLeft: { scan: 0x1d, modifier: true }, ControlRight: { scan: 0x1d, extended: true, modifier: true },
  ShiftLeft: { scan: 0x2a, modifier: true }, ShiftRight: { scan: 0x36, modifier: true },
  AltLeft: { scan: 0x38, modifier: true }, AltRight: { scan: 0x38, extended: true, modifier: true },
  MetaLeft: { scan: 0x5b, extended: true, modifier: true }, MetaRight: { scan: 0x5c, extended: true, modifier: true },
});
for (let digit = 1; digit <= 9; digit++) keys[`Digit${digit}`] = { scan: digit + 1 };
keys.Digit0 = { scan: 0x0b };

const error = (code) => { throw new Error(code); };
export function planPhysicalChord({ keys: names, expectedHkl, actualHkl, targetHwnd, foregroundHwnd }) {
  if (!Array.isArray(names) || names.length < 1 || names.length > 5) error("PHYSICAL_KEY_INVALID");
  const seen = new Set();
  let mainKeyCount = 0;
  for (const [index, name] of names.entries()) {
    if (typeof name !== "string" || !Object.hasOwn(keys, name)) error("PHYSICAL_KEY_UNKNOWN");
    if (seen.has(name)) error("PHYSICAL_KEY_INVALID");
    seen.add(name);
    if (!keys[name].modifier) { mainKeyCount += 1; if (index !== names.length - 1) error("PHYSICAL_KEY_INVALID"); }
  }
  if (mainKeyCount !== 1) error("PHYSICAL_KEY_INVALID");
  if (typeof expectedHkl !== "string" || !/^[0-9a-fA-F]{16}$/.test(expectedHkl)) error("PHYSICAL_HKL_REQUIRED");
  if (typeof actualHkl !== "string" || actualHkl.toUpperCase() !== expectedHkl.toUpperCase()) error("PHYSICAL_HKL_MISMATCH");
  if (!targetHwnd || String(foregroundHwnd) !== String(targetHwnd)) error("PHYSICAL_FOCUS_MISMATCH");
  const down = names.map((name) => ({ name, scan: keys[name].scan, extended: !!keys[name].extended, up: false }));
  return [...down, ...down.toReversed().map((event) => ({ ...event, up: true }))];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const input = JSON.parse(Buffer.from(process.argv[2] ?? "", "base64").toString("utf8"));
    process.stdout.write(JSON.stringify({ events: planPhysicalChord(input) }));
  } catch (cause) {
    process.stdout.write(JSON.stringify({ error: cause.message }));
    process.exitCode = 1;
  }
}
