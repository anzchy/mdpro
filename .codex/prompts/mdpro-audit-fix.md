---
description: Audit mdpro changes, fix all real findings, verify, and repeat until clean.
argument-hint: "[scope: empty=uncommitted | staged | commit -N | path]"
---

# mdpro Audit-Fix Loop

Parse the scope:

| Input | Scope |
| --- | --- |
| empty | Uncommitted changes |
| `staged` | Staged changes |
| `commit -1` | Last commit |
| `commit -N` | Last N commits |
| `path/to/file` | Specific file or directory |

If no changed files are found, report "Nothing to audit" and stop.

## Audit

Read every changed file and relevant surrounding code. Review for:

1. Correctness and logic
2. Edge cases: empty input, null/undefined, Unicode/CJK, rapid actions, concurrent access
3. Security: injection, XSS, path traversal, trust boundaries
4. Duplicate code
5. Dead code
6. Shortcuts and patches: TODOs, bypass flags, catch-and-ignore, symptom fixes
7. mdpro rules: Zustand selectors, structured logging, CSS variables, file size, Tauri `Result<T, String>`

Report real findings only:

```text
file:line | severity (Critical/High/Medium/Low) | issue | fix
```

## Fix

Fix every real finding. Keep the diff focused. Add or update regression tests for behavior changes.

## Verify

Re-read the changed files and updated diff. Confirm:

- each original finding is resolved
- no new findings were introduced
- tests cover bug fixes and changed behavior

Loop up to three times. If findings remain after three iterations, stop and report them.

If clean, run the relevant gates:

```bash
pnpm build
pnpm test:run
```

If Rust changed:

```bash
cd src-tauri && cargo check
```

