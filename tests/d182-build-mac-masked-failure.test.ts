// @vitest-environment node
/**
 * D182 — scripts/build-mac.sh must fail when `pnpm tauri build` fails, and
 * must not accept a DMG left over from an earlier build as this run's output.
 *
 * Drives the real script (copied into a temp project, since it locates the
 * project root from its own path) with stub `pnpm` / `cargo` / `rustc` on
 * PATH. Nothing real is built. The project and stubs live in
 * tests/support/buildMacHarness.ts, shared with the D183 tests.
 */
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPAWN_TEST_TIMEOUT_MS } from './support/spawnTestTimeout';
import { type BuildMacProject, createBuildMacProject, VERSION } from './support/buildMacHarness';
import { skipUnlessMac } from './support/buildMacHarness';

let project: BuildMacProject;
const placeStaleBuild = () => project.placeStaleBuild();
const run = (env: Record<string, string>) => project.run(env);

beforeEach(() => {
  project = createBuildMacProject('d182-build-mac-');
});

afterEach(() => {
  project.cleanup();
});

// D193: build-mac.sh is a macOS-only script (BSD stat/find, .app/.dmg bundles).
skipUnlessMac();

describe('D182 build-mac.sh', () => {
  it('fails with a build-failed message when tauri build fails, even with an old DMG present', () => {
    const stale = placeStaleBuild();
    const { status, out } = run({ STUB_TAURI: 'fail', VERSION });
    expect(status).not.toBe(0);
    expect(out).toMatch(/tauri build failed/i);
    expect(out).not.toMatch(/Build complete/);
    // The earlier build's DMG is left alone, not deleted.
    expect(existsSync(stale)).toBe(true);
  }, SPAWN_TEST_TIMEOUT_MS);

  it('fails when tauri build succeeds but only a stale DMG for the version exists', () => {
    placeStaleBuild();
    const { status, out } = run({ STUB_TAURI: 'nodmg', VERSION });
    expect(status).not.toBe(0);
    expect(out).toMatch(/not produced by this build|stale/i);
    expect(out).not.toMatch(/Build complete/);
  }, SPAWN_TEST_TIMEOUT_MS);

  it('fails with a DMG-not-found message when no DMG exists at all', () => {
    const { status, out } = run({ STUB_TAURI: 'nodmg', VERSION });
    expect(status).not.toBe(0);
    expect(out).toMatch(/DMG not found|not produced by this build/i);
  }, SPAWN_TEST_TIMEOUT_MS);

  it('succeeds when the build writes a fresh DMG, replacing an old one', () => {
    placeStaleBuild();
    const { status, out } = run({ STUB_TAURI: 'dmg', VERSION });
    expect(status).toBe(0);
    expect(out).toMatch(/Build complete/);
    expect(out).toContain(`mdpro_${VERSION}_aarch64.dmg`);
  }, SPAWN_TEST_TIMEOUT_MS);

  it('succeeds when the build output has no lines left after filtering', () => {
    const { status, out } = run({ STUB_TAURI: 'dmg-quiet', VERSION });
    expect(status).toBe(0);
    expect(out).toMatch(/Build complete/);
  }, SPAWN_TEST_TIMEOUT_MS);

  it('stops before building when pnpm install fails (D181 guard)', () => {
    const stale = placeStaleBuild();
    const { status, out } = run({ STUB_INSTALL_FAIL: '1', STUB_TAURI: 'dmg', VERSION });
    expect(status).not.toBe(0);
    expect(out).not.toMatch(/Building mdpro\.app/);
    expect(out).not.toMatch(/Build complete/);
    expect(existsSync(stale)).toBe(true);
  }, SPAWN_TEST_TIMEOUT_MS);
});
