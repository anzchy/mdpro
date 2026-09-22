# D5 — Runtime console check for CSP / IPC custom protocol (2026-09-22)

Question: does the packaged app's `connect-src 'self' ipc: http://ipc.localhost` hold at
**runtime**? That means 0 CSP refusals for `ipc:` / `ipc.localhost` and no "IPC custom
protocol failed … postMessage" fallback warning. The 2026-09-21 measurement
(`20260921-d5-d6-real-device-measurement.md` §1) answered it on a debug bundle.
This pass re-runs it at `44607d8`, and it keeps the release binary and the debug
binary **strictly separate**.

Both binaries were built from the same clean detached worktree at `44607d8`.

## 1. Release bundle — NOT VERIFIED

| Field | Value |
|---|---|
| Build | `pnpm tauri build` |
| Bundle | `src-tauri/target/release/bundle/macos/mdpro.app` (`com.mdpro.app`, v0.3.0) |
| `tauri-app` sha256 | `0440b48f9b2b5730ce20298ed8323dde79c26350ed731d615fc4e5d76108fb03` |
| CSP string in binary | `strings -a … \| grep -o "connect-src[^;\"]*"` → `connect-src 'self' ipc: http://ipc.localhost` |
| Web Inspector | **Unavailable.** ⌘⌥I does nothing, and the webview context menu has no "Inspect Element". `Cargo.toml` enables `tauri` with `features = ["protocol-asset"]` only. Without the `devtools` feature, the window-level `"devtools": true` in `tauri.conf.json` has no effect in a release build. |

**Verdict: NOT VERIFIED.** The runtime console of the shipping binary cannot be
observed without changing the build, and the handoff says not to enable devtools via
config for this test. The only release-side evidence is static: the CSP string
compiled into the binary.

## 2. Debug bundle — a different binary, not release evidence

| Field | Value |
|---|---|
| Build | `pnpm tauri build --debug --bundles app` |
| Bundle | `src-tauri/target/debug/bundle/macos/mdpro.app` (same bundle id) |
| `tauri-app` sha256 | `3ae2dd0a449992789dd554b6c5f9fe7f1cda777f1ed7382f566bc34039be9b04` |
| CSP string in binary | `connect-src 'self' ipc: http://ipc.localhost` (identical to release) |
| Page origin | `tauri://localhost`, the bundled frontend, not the Vite dev server |

Procedure: cold launch → ⌘⌥I → Console → `location.reload()` once, which prints
"Console cleared at 11:42:54" → then two live invokes from the console.

| Check | Result |
|---|---|
| CSP refusals mentioning `connect-src` / `ipc:` / `ipc.localhost`, after the reload | **0** |
| "IPC custom protocol failed, Tauri will now use the postMessage interface" warnings | **0** |
| Other console errors or warnings from the app | **0**. The only error line was a `ReferenceError` from a mistyped console expression of my own. |
| `invoke('get_app_version')` | resolved with `"0.3.0"` |
| `invoke('get_preferences')` | resolved with an `object` |

`performance.getEntriesByType('resource')` returned 0 entries, so it cannot be used to
count `ipc://` requests on this WebKit. The absence of the fallback warning, together
with the two resolved invokes, is the evidence that the custom-protocol IPC path works.

**Verdict for this binary: clean.** It carries the same CSP string as release. That
makes it strong circumstantial evidence for release, but it is not release evidence.

## Summary

| Binary | Status |
|---|---|
| Release `0440b48f…` | **NOT VERIFIED.** No Web Inspector. The CSP string is present statically. |
| Debug `3ae2dd0a…` | 0 CSP refusals, 0 IPC-fallback warnings, and both invokes resolve |

Closing the release gap needs one of these: a release build with the `devtools` Cargo
feature, which is a different binary again; or a non-console runtime signal, such as
logging from the frontend when `__TAURI_INTERNALS__` falls back to postMessage.
