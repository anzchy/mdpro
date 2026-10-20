# Step 4: implement one WI

Ported from tdd-guardian's `implementer` and `implement`, plus rules 10 and 71. Do one WI at a
time, in plan order. Don't start the next WI until this one is green and verified.

## The receipt CLI

Pick the CLI once, at the start of Step 4:

- **Frontend unit RED, if `scripts/tdd/red-receipt.mjs` exists on your branch** (ADR-0125, once
  landed): use it, with the syntax given in its `--help` and in rule 10's receipt bullet. It runs
  only the named test file, unlocked, with at most 2 workers, and refuses anything that isn't a
  counted assertion failure.
- **Otherwise**, and for Rust: the plugin CLI, under the lock. Resolve the newest installed version:

  ```sh
  R="$(ls -d ~/.claude/plugins/cache/xiaolai/tdd-guardian/*/ | sort -V | tail -1)scripts/tdd-guardian/receipt.js"
  test -f "$R" || echo "receipt CLI missing"
  scripts/heavy-lock.sh node "$R" record --id <ITEM>-WI-n --lane <unit|rust> --files <test files> --cwd .
  scripts/heavy-lock.sh node "$R" verify --id <ITEM>-WI-n --cwd .
  ```

  Always pass `--id` to verify. An unscoped verify settles other items' receipts.

If no CLI works, say so in the handoff and carry on. An unrecorded RED is honest. A receipt
recorded after the code is already green is false, and worse than none.

## Per WI

1. **Re-read** the WI's plan block and its matrix cases, including the adversary's added cases.
2. **Write the tests first**, in the files the matrix names. Run them focused:
   `VITEST_MAX_WORKERS=2 pnpm exec vitest run <files>`. They must fail **on an assertion**. The
   failure output should show a counted test failure with a `passed` count where possible, not a
   collection error.
   - A missing module, a syntax error, a zero-test run, or a failure that comes before any test
     body is an **environment RED**. Fix the test file or the runner, never production code, and
     run again.
   - For Rust: `cargo fmt`, then run the test and see it fail.
3. **Record the RED** with the CLI above, before touching production code. A non-zero exit means
   the RED proved nothing: fix the cause and record again.
   Then check the recorded kind. If the old full-lane CLI records `opaque-failure`:
   - keep the receipt;
   - keep the focused run's counted assertion output as the evidence;
   - name `weak-red` in the handoff;
   - mark any brief AC that requires `assertion-failure` as unmet.

   Never re-record to replace an opaque receipt once production code exists.
4. **Write the minimal production change** that makes the cases pass. Follow the path rules in
   `AGENTS.md` step 3 (logging, UI, tokens, shortcuts) and rule 50:
   - files under 300 lines;
   - `error instanceof Error ? error.message : String(error)`;
   - `useXStore.getState()` in callbacks;
   - Rust commands return `Result`.
5. **Go green**, focused run first. If it fails, fix the implementation, not the tests.
6. **Refactor** while green. Remove duplication, name the constants, update rule 22 headers
   (`Purpose:`, `@coordinates-with`) and the TSDoc of every function whose behaviour changed. Re-run
   the focused tests.
7. **Verify the receipt** with the CLI above:
   - `SEPARATION-HELD`: report it.
   - `SEPARATION-BROKEN`: name each file and the reason. Never re-record to clear it.
   - `PENDING`: the lane isn't green, or a recorded file is unreadable. Fix it and verify again.
8. **Name any receipt finding** (`implementation-already-present`, `weak-red`, `opaque-failure`)
   in the WI block. The handoff carries it.

## Never

- Edit or delete an assertion that existed at RED, to make code pass.
- Record a RED after the production change.
- Run the full coverage lane per WI. Rule 10 says once per commit, in Step 7.
- Commit, push, or touch another item's files.

## WI block (append to `<item>-implement.md`)

```markdown
### <ITEM>-WI-n: <title> — DONE | BLOCKED
- Tests: <file>: <n> cases (matrix cases <list>)
- RED: `<command>` → `<decisive failing line>`; receipt kind <assertion-failure|…>
- Source: <file>: <one line>
- GREEN: `<command>` → `<decisive line>`
- Verify: <SEPARATION-HELD | SEPARATION-BROKEN: files + reason | PENDING>
- Receipt findings: <none | list>
```
