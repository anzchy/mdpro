// Shared fixtures for the D338 layout cases: HKL values, a two-window layout scene, and readers
// for the fake's own per-thread state (the independent observation a test asserts on).
import type { NativeOptions, NativeScenario } from "./windows-driver-native-harness";
import type { LayoutScenario } from "./windows-driver-native-layout-fake";
import { identity, runDialog } from "./windows-driver-native-dialog-harness";

export const DE = 0x04070407;
export const CN = 0x08040804;
export const US = 0x04090409;
/** Another German layout with the same language low word as DE (a variant, not DE itself). */
export const DE_VARIANT = 0xf0220407;
export const hex = (hkl: number) => hkl.toString(16).toUpperCase().padStart(16, "0");
export { identity };

type Layout = NonNullable<LayoutScenario["layout"]>;

/** A starts on CN (input thread 9), B on US (thread 19); outer threads and the driver's are US. */
export function layoutScene(extra: Partial<Layout> = {}): Layout {
  return {
    threads: { 7: US, 8: US, 9: CN, 19: US, 99: US },
    load: { "00000407": DE, "00000804": CN, "00000409": US },
    list: [CN, US, DE],
    ...extra,
  };
}

/** A layout transaction is small: it runs under a 15 s transaction budget, not the 30 s default. */
export const LAYOUT_DEADLINE_MS = 15_000;

/** `pageB` lets label B bind in-run too (its own fake page and title), for two-context batches. */
export async function runLayout(steps: unknown[], layout: Layout, scenario: NativeScenario = {},
  options: Pick<NativeOptions, "phaseMs"> & { pageB?: boolean } = {}) {
  return runDialog(steps, { ...scenario, layout } as NativeScenario, { deadlineMs: LAYOUT_DEADLINE_MS, ...options });
}

/** The fake's HKL for `thread` after the run: its last traced change, else its starting value. */
export function finalHkl(trace: string[], layout: Layout, thread: number) {
  const last = trace.filter((line) => line.startsWith(`layout-state:${thread}:`)).at(-1);
  return last ? Number(last.split(":")[2]) : layout.threads[thread];
}

/** Every input-language request the driver posted, as `<hwnd>:<hkl>`. */
export const requests = (trace: string[]) =>
  trace.filter((line) => line.startsWith("layout-request:")).map((line) => {
    const [, hwnd, , hkl] = line.split(":");
    return `${hwnd}:${hkl}`;
  });

export const scans = (trace: string[]) => trace.filter((line) => line.startsWith("scan:"));
