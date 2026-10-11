# 0080. Permission and ownership changes on an unchanged file do not prompt

**Status**: Accepted (2026-10-11; proposed and decided the same day). User
decided, relayed by mdpro-delegator: 「(b)+(c)：字节未变就不提示，并钉住 chmod 000
仍提示 (Recommended)」. Partially supersedes
[ADR-0068](0068-file-watcher-drops-metadata-and-content-events-when-the-file-is-unchanged.md)
decision 1: its list of filtered kinds gains the Ownership and Permissions
metadata subkinds. ADR-0068's other decisions stand.

## Context

On the 0.3.1 RC device run on `c8bd2b6`, part A
([record](../test/20261011-rc-c8bd2b6-a-device-check.md), item 8a, finding
F2 → [D164](../plans/20260912-frontend-backend-sequencing-order.md#d164)), a
permission-only `chmod 444` on an open file whose bytes were unchanged raised
the "modified externally" prompt. So did the `chmod 644` that put the mode
back. The log line was `file.watch.event`, kind `modify_metadata`, detail
`ownership`, outcome `emitted_modified`, `unchangedCheck` `not_checked`, size
and mtime unchanged. On macOS, FSEvents reports a `chmod` with its
change-owner flag, and notify 6.1.1 maps that flag to
`Modify(Metadata(Ownership))`.

ADR-0068 decision 1 limits the D32 unchanged check to three kinds:
`Metadata(Extended)`, `Metadata(Any)` and `Data(Content)`, the residual flags
of the FSEvents burst it was written for. Its Consequences say: "Permission,
ownership and timestamp subkinds still prompt, as today." Each of these
prompts offers Reload on bytes that did not change.

## Options considered

- **(a) Keep prompting.** Nothing new can go wrong. What we lose: a `chmod` by
  a backup tool, a sync client or `git checkout` is noise on an unchanged
  file, and every Ignore teaches the user to dismiss the prompt.
- **(b) Route Ownership and Permissions through the unchanged check**, the
  same path as the other filtered kinds: the self-write gate, then
  `is_unchanged_why` (unchanged → `IgnoredUnchanged`), then the per-kind
  debounce, then emit.
- **(c) (b), plus a pinned test that an unreadable result still prompts.** A
  `chmod 000` leaves the bytes the same but makes the file unreadable, which
  the user should hear about.

## Decision

(b) + (c). `is_filtered_kind` also accepts `Modify(Metadata(Ownership))` and
`Modify(Metadata(Permissions))`. `WriteTime`, `AccessTime` and `Other` stay
unfiltered. A `chmod 000` still emits, because the baseline read fails, the
check fails open (`read_failed`), and the event emits as `modified`.
`file_watcher_route_permission_tests.rs` pins this (D164-WI-1). No IPC,
outcome or log vocabulary changes.

## Consequences

- **Gained:** a `chmod` or `chown` that leaves the bytes alone no longer
  prompts. The log line says `ignored_unchanged` / `unchanged`.
- **Cost: a permission-only or owner-only change to an unchanged file is now
  silent**, even when the user might care, for example a file another tool
  made read-only. mdpro's next ⌘S does **not** fail on such a file:
  `atomic_write` copies the old mode onto its temp file and renames it over
  the target, so the save succeeds and the mode stays read-only (record item
  8a: `Saved`, mode `-r--r--r--`). A save fails, and goes through the existing
  save-failure path, only when the directory is not writable (item 8b). So
  the read-only flag is not enforced, and after this decision nothing tells
  the user about it.
- **Cost: the `chmod 000` prompt depends on the baseline read failing and
  failing open, not on the event kind.** If the process can still read the
  file (for example when run as root), a `chmod 000` on unchanged bytes is
  silent too. The test skips under root rather than pass vacuously.
- **Not changed:** `WriteTime`, `AccessTime` and `Other` metadata events still
  prompt, as do `Modify(Any)` and the other data subkinds.
- **Forecloses:** nothing structural. Undoing it means removing two subkinds
  from one `matches!`.
