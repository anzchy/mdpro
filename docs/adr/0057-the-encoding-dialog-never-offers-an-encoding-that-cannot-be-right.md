# 0057. The encoding dialog never offers an encoding that cannot be right

**Status**: Accepted (2026-10-08, user decision). Proposed 2026-10-08. Supersedes the encoding half of
[ADR-0056](./0056-recovery-stays-a-forced-choice-and-encoding-opens-on-cancel.md)
(decision 2 and its premise); ADR-0056's RecoveryDialog half stays in force.

## Context

ADR-0056 chose Cancel as EncodingDialog's initial focus on the premise that
"decoding is strict, so a wrong choice corrupts nothing". That premise holds for
UTF-8 and ASCII only. It is false for UTF-16 (D52):

- The dialog opens only when `detect_encoding` returns "unknown", i.e. the bytes
  are not valid UTF-8 (`src-tauri/src/services/encoding.rs:1-15`). UTF-8 and
  ASCII are therefore certain to fail; they are dead buttons.
- `decode_utf16` ends in `String::from_utf16` (`encoding.rs:66`), which accepts
  almost any even-length byte string. A GBK file (`D6 D0 CE C4`, "中文") decodes
  "successfully" as Hangul.
- `open_file` then sets `document.encoding` to the chosen encoding
  (`src-tauri/src/commands/file.rs:194-216`), and `encode_for_save`
  (`file.rs:271`, `encode_bytes` at `encoding.rs:170`) writes UTF-16 with a BOM.
  One ⌘S replaces the user's GBK file with UTF-16 mojibake, with no warning.

So of the four buttons, two cannot succeed and two can succeed wrongly. The
files that actually reach this dialog are mostly legacy 8-bit/CJK encodings
(GBK/GB18030, Big5, Shift-JIS, Windows-1252), which mdpro cannot decode at all.

## Decision

1. **Cancel stays the initial focus, and Esc and a backdrop click still take
   Cancel.** The reason changes: Enter must not commit a choice that can silently
   rewrite the file on save, not merely "repeat a failing decode".
2. **The dialog never offers an encoding the detector has already ruled out.**
   When detection returned "unknown", UTF-8 and ASCII are not shown.
3. **UTF-16 is offered only when it is plausible**, behind a check (e.g. the
   decoded text has no unpaired surrogates and a sane share of printable
   characters) or a preview the user confirms. An implausible UTF-16 choice is
   refused, not opened.
4. **Legacy encodings are D52's fix, not this ADR's.** Adding `encoding_rs` +
   `chardetng` (or refusing such files with a clear message) is a dependency
   decision recorded as the candidate direction only; whoever fixes D52 decides
   it, in its own ADR if a dependency is added.

## Consequences

- No button in the dialog can silently corrupt a file on save; the dialog stops
  presenting choices that are certain to fail.
- Cost: WI-4.6b is no longer a pure shell change. Its encoding half now depends
  on D52's backend work (plausibility check or preview), and its tests change.
- Cost: a genuine BOM-less UTF-16 file that fails the plausibility check gets
  more friction (a preview or a refusal) than one click.
- Cost: with UTF-8 and ASCII removed and no legacy decoder yet, the dialog may
  offer only Cancel for most real files until D52 lands — honest, but a dead end.
- Cost: a likely new dependency (`encoding_rs`, `chardetng`), deferred, not
  avoided.
- ADR-0056 is now partly superseded. The status enum has no "in part" form, so
  ADR-0056's status line names the half that is superseded.
