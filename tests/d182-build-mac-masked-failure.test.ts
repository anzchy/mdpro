// @vitest-environment node
/**
 * D182 — scripts/build-mac.sh must fail when `pnpm tauri build` fails, and
 * must not accept a DMG left over from an earlier build as this run's output.
 *
 * Drives the real script (copied into a temp project, since it locates the
 * project root from its own path) with stub `pnpm` / `cargo` / `rustc` on
 * PATH. Nothing real is built.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '..', 'scripts', 'build-mac.sh');
const VERSION = '9.8.7';

// Stub pnpm. Behaviour is chosen per test through env vars:
//   STUB_INSTALL_FAIL=1   → `pnpm install` exits 1 (e.g. the D181 guard)
//   STUB_TAURI=fail       → `pnpm tauri build` prints and exits 1
//   STUB_TAURI=nodmg      → exits 0 without writing a DMG
//   STUB_TAURI=dmg        → writes a fresh DMG + .app, output has kept lines
//   STUB_TAURI=dmg-quiet  → writes a fresh DMG + .app, output is only blank
//                           lines and warning[ lines (all filtered out)
const PNPM_STUB = `#!/bin/sh
case "$1" in
  --version) echo "10.26.1"; exit 0 ;;
  install)
    if [ "$STUB_INSTALL_FAIL" = "1" ]; then
      echo "D181 guard: prosemirror-tables is unpatched" >&2
      exit 1
    fi
    exit 0 ;;
  test:run) exit 0 ;;
  tauri)
    bundle="$PWD/src-tauri/target/release/bundle"
    write_out() {
      mkdir -p "$bundle/dmg" "$bundle/macos/mdpro.app"
      echo "fresh" > "$bundle/dmg/mdpro_${VERSION}_aarch64.dmg"
    }
    case "$STUB_TAURI" in
      fail) echo "error: failed to bundle project"; exit 1 ;;
      nodmg) echo "    Finished release"; exit 0 ;;
      dmg) echo "    Finished release"; write_out; exit 0 ;;
      dmg-quiet) echo ""; echo "warning[unused]: x" >&2; write_out; exit 0 ;;
    esac
    exit 99 ;;
esac
exit 0
`;

const OK_STUB = `#!/bin/sh
case "$1" in
  --version) echo "tool 1.0.0" ;;
esac
exit 0
`;

let root: string;
let stubBin: string;
let bundle: string;

function writeStub(name: string, body: string) {
  const p = join(stubBin, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
}

function placeStaleBuild() {
  mkdirSync(join(bundle, 'dmg'), { recursive: true });
  mkdirSync(join(bundle, 'macos', 'mdpro.app'), { recursive: true });
  const dmg = join(bundle, 'dmg', `mdpro_${VERSION}_aarch64.dmg`);
  writeFileSync(dmg, 'old');
  const anHourAgo = new Date(Date.now() - 3600_000);
  utimesSync(dmg, anHourAgo, anHourAgo);
  return dmg;
}

function run(env: Record<string, string>) {
  const res = spawnSync(join(root, 'scripts', 'build-mac.sh'), ['--skip-tests'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: [stubBin, dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
      HOME: root,
      TMPDIR: root,
      ...env,
    },
    timeout: 30_000,
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'd182-build-mac-'));
  stubBin = join(root, 'stub-bin');
  bundle = join(root, 'src-tauri', 'target', 'release', 'bundle');
  mkdirSync(stubBin);
  mkdirSync(join(root, 'scripts'));
  copyFileSync(SCRIPT, join(root, 'scripts', 'build-mac.sh'));
  chmodSync(join(root, 'scripts', 'build-mac.sh'), 0o755);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: VERSION }));
  writeStub('pnpm', PNPM_STUB);
  writeStub('cargo', OK_STUB);
  writeStub('rustc', OK_STUB);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('D182 build-mac.sh', () => {
  it('fails with a build-failed message when tauri build fails, even with an old DMG present', () => {
    const stale = placeStaleBuild();
    const { status, out } = run({ STUB_TAURI: 'fail', VERSION });
    expect(status).not.toBe(0);
    expect(out).toMatch(/tauri build failed/i);
    expect(out).not.toMatch(/Build complete/);
    // The earlier build's DMG is left alone, not deleted.
    expect(existsSync(stale)).toBe(true);
  });

  it('fails when tauri build succeeds but only a stale DMG for the version exists', () => {
    placeStaleBuild();
    const { status, out } = run({ STUB_TAURI: 'nodmg', VERSION });
    expect(status).not.toBe(0);
    expect(out).toMatch(/not produced by this build|stale/i);
    expect(out).not.toMatch(/Build complete/);
  });

  it('fails with a DMG-not-found message when no DMG exists at all', () => {
    const { status, out } = run({ STUB_TAURI: 'nodmg', VERSION });
    expect(status).not.toBe(0);
    expect(out).toMatch(/DMG not found|not produced by this build/i);
  });

  it('succeeds when the build writes a fresh DMG, replacing an old one', () => {
    placeStaleBuild();
    const { status, out } = run({ STUB_TAURI: 'dmg', VERSION });
    expect(status).toBe(0);
    expect(out).toMatch(/Build complete/);
    expect(out).toContain(`mdpro_${VERSION}_aarch64.dmg`);
  });

  it('succeeds when the build output has no lines left after filtering', () => {
    const { status, out } = run({ STUB_TAURI: 'dmg-quiet', VERSION });
    expect(status).toBe(0);
    expect(out).toMatch(/Build complete/);
  });

  it('stops before building when pnpm install fails (D181 guard)', () => {
    const stale = placeStaleBuild();
    const { status, out } = run({ STUB_INSTALL_FAIL: '1', STUB_TAURI: 'dmg', VERSION });
    expect(status).not.toBe(0);
    expect(out).not.toMatch(/Building mdpro\.app/);
    expect(out).not.toMatch(/Build complete/);
    expect(existsSync(stale)).toBe(true);
  });
});
