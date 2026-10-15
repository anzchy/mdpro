// @vitest-environment node
/**
 * D183 — scripts/build-mac.sh must not accept or misreport a product:
 *   (a) a missing rustc is named as a prerequisite failure;
 *   (b) of several fresh DMGs for the version, the newest is reported;
 *   (c) an mdpro.app this build did not write is rejected as stale;
 *   (d) a version that differs between package.json and the version Tauri
 *       bundles with is named before anything is installed or built.
 *
 * Same approach as D182: the real script runs in a throwaway project with stub
 * tools on PATH (tests/support/buildMacHarness.ts). Nothing real is built.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BuildMacProject, createBuildMacProject, VERSION } from '../support/buildMacHarness';
import { skipUnlessMac } from '../support/buildMacHarness';

let project: BuildMacProject;
let stubLog: string;

beforeEach(() => {
  project = createBuildMacProject('d183-build-mac-');
  stubLog = join(project.root, 'stub.log');
});

afterEach(() => {
  project.cleanup();
});

// D193: build-mac.sh is a macOS-only script (BSD stat/find, .app/.dmg bundles).
skipUnlessMac();

function run(env: Record<string, string>, path?: string) {
  return project.run({ VERSION, STUB_LOG: stubLog, ...env }, path);
}

/** Every stub invocation, one per line ("pnpm install --frozen-lockfile", …). */
function stubCalls(): string[] {
  return existsSync(stubLog) ? readFileSync(stubLog, 'utf8').split('\n').filter(Boolean) : [];
}

function installedOrBuilt(): string[] {
  return stubCalls().filter((c) => /^pnpm (install|tauri)/.test(c));
}

function dmgLine(out: string): string {
  return out.split('\n').find((l) => /DMG\S*\s+\//.test(l)) ?? '';
}

describe('D183 control: a consistent, fresh build', () => {
  it('succeeds and builds when versions agree and the DMG and .app are fresh', () => {
    project.placeStaleBuild();
    const { status, out } = run({ STUB_TAURI: 'dmg' });
    expect(status).toBe(0);
    expect(out).toMatch(/Build complete/);
    expect(dmgLine(out)).toContain(`mdpro_${VERSION}_aarch64.dmg`);
    expect(stubCalls()).toContain('pnpm tauri build');
  });
});

describe('D183 (a) rustc prerequisite', () => {
  it('fails naming rustc when pnpm, cargo and node exist but rustc does not', () => {
    // A PATH whose only tools are the stubs (minus rustc), node and the
    // system dirs; checked here so a real rustc there cannot hide the case.
    const noRust = join(project.root, 'no-rust-bin');
    mkdirSync(noRust);
    for (const name of readdirSync(project.stubBin).filter((n) => n !== 'rustc')) {
      symlinkSync(join(project.stubBin, name), join(noRust, name));
    }
    const path = [noRust, '/usr/bin', '/bin'].join(':');
    const probe = spawnSync('/bin/sh', ['-c', 'command -v rustc'], { env: { PATH: path } });
    expect(probe.status, 'precondition: no rustc on the test PATH').not.toBe(0);

    const { status, out } = run({ STUB_TAURI: 'dmg' }, path);
    expect(status).not.toBe(0);
    expect(out).toMatch(/rustc not found/);
    expect(out).not.toMatch(/Build complete/);
    expect(installedOrBuilt()).toEqual([]);
  });
});

describe('D183 (b) newest DMG wins', () => {
  // One name has a space, so the pick must survive word splitting.
  const A = `mdpro_${VERSION}_aarch64.dmg`;
  const B = `mdpro_${VERSION}_aarch64 rebuilt.dmg`;

  // The stub makes either the DMG `find` lists first or the one it lists
  // second the newer; the report must name the newer in both orders.
  it.each(['first', 'last'])('reports the newest DMG when it is the one find lists %s', (order) => {
    const newestFile = join(project.root, 'newest.txt');
    const { status, out } = run({
      STUB_TAURI: 'dmg-two',
      STUB_DMG_A: A,
      STUB_DMG_B: B,
      STUB_NEWER: order,
      STUB_NEWEST: newestFile,
    });
    const newest = readFileSync(newestFile, 'utf8').trim();
    const older = newest === A ? B : A;
    expect(status).toBe(0);
    expect(out).toMatch(/Build complete/);
    const line = dmgLine(out);
    expect(line.endsWith(join(project.bundle, 'dmg', newest))).toBe(true);
    expect(out).not.toContain(join(project.bundle, 'dmg', older));
  });
});

describe('D183 (c) the .app must come from this build', () => {
  it('fails as stale when the DMG is fresh but mdpro.app is left from an earlier build', () => {
    project.placeStaleBuild();
    const { status, out } = run({ STUB_TAURI: 'dmg-noapp' });
    expect(status).not.toBe(0);
    expect(out).toMatch(/mdpro\.app is stale/);
    expect(out).not.toMatch(/Build complete/);
  });

  it('still fails as not found when there is no mdpro.app at all', () => {
    const { status, out } = run({ STUB_TAURI: 'dmg-noapp' });
    expect(status).not.toBe(0);
    expect(out).toMatch(/mdpro\.app not found/);
  });

  it('accepts an app whose main binary this build rewrote, even if Info.plist is old', () => {
    project.placeStaleBuild();
    const { status, out } = run({ STUB_TAURI: 'dmg-binonly' });
    expect(status).toBe(0);
    expect(out).toMatch(/Build complete/);
  });
});

describe('D183 (d) one version, or a named mismatch', () => {
  it('fails before install or build, naming both values and both files', () => {
    project.writeProjectFile(
      'src-tauri/tauri.conf.json',
      JSON.stringify({ productName: 'mdpro', version: '9.8.8' }),
    );
    project.placeStaleBuild();
    const { status, out } = run({ STUB_TAURI: 'dmg' });
    expect(status).not.toBe(0);
    expect(out).toContain('9.8.7');
    expect(out).toContain('9.8.8');
    expect(out).toContain('package.json');
    expect(out).toContain('tauri.conf.json');
    expect(out).not.toMatch(/DMG not found/);
    expect(installedOrBuilt()).toEqual([]);
  });

  it('follows a tauri.conf.json version that is a path to a JSON file, and names a mismatch there', () => {
    project.writeProjectFile('src-tauri/version.json', JSON.stringify({ version: '9.8.9' }));
    project.writeProjectFile(
      'src-tauri/tauri.conf.json',
      JSON.stringify({ productName: 'mdpro', version: './version.json' }),
    );
    const { status, out } = run({ STUB_TAURI: 'dmg' });
    expect(status).not.toBe(0);
    expect(out).toContain('9.8.9');
    expect(out).toContain('9.8.7');
    expect(installedOrBuilt()).toEqual([]);
  });

  it('accepts a tauri.conf.json version that is a path to package.json', () => {
    project.writeProjectFile(
      'src-tauri/tauri.conf.json',
      JSON.stringify({ productName: 'mdpro', version: '../package.json' }),
    );
    const { status, out } = run({ STUB_TAURI: 'dmg' });
    expect(status).toBe(0);
    expect(out).toMatch(/Build complete/);
  });

  it('falls back to Cargo.toml when tauri.conf.json has no version, and names a mismatch there', () => {
    project.writeProjectFile('src-tauri/tauri.conf.json', JSON.stringify({ productName: 'mdpro' }));
    project.writeProjectFile(
      'src-tauri/Cargo.toml',
      '[package]\nname = "tauri-app"\nversion = "9.8.6"\nedition = "2021"\n',
    );
    const { status, out } = run({ STUB_TAURI: 'dmg' });
    expect(status).not.toBe(0);
    expect(out).toContain('9.8.6');
    expect(out).toContain('Cargo.toml');
    expect(installedOrBuilt()).toEqual([]);
  });

  it('accepts no tauri.conf.json version when Cargo.toml agrees with package.json', () => {
    project.writeProjectFile('src-tauri/tauri.conf.json', JSON.stringify({ productName: 'mdpro' }));
    const { status, out } = run({ STUB_TAURI: 'dmg' });
    expect(status).toBe(0);
    expect(out).toMatch(/Build complete/);
  });
});
