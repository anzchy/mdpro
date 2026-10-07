# D43 device check

Copy this file to the scratchpad four times, as a.md, b.md, c.md and d.md,
and open the copies. Each copy is one Open Recent entry.

Steps: open b, c, d with `open -a`; back up `~/.mdpro/config.json`, then
overwrite it with invalid JSON; open a.md with `open -a`.

Expected: File → Open Recent lists a.md first, then this session's entries,
in every window, including after focusing the d.md window. The log has a
Rust `menu.recent_files.sync` warn with `outcome: "hydration_failed"`.
The corrupt `config.json` bytes are unchanged. Restore the backup after.
