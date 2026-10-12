"""Purpose: the spool half of the dtrack hook receiver (D177-WI-1): validate the
spool_* fields of a POST body, dedupe on (source, epoch, seq), and keep the
per-source seq state that gaps.json is made from.

Pipeline: spool_fields(payload) -> None (legacy body) | SpoolFields | ValueError
  -> SeqState.apply(fields) -> "new" | "duplicate" | "stale"
  -> SeqState.save(state_path, gaps_path) (each a tmp file + os.replace).

Key decisions:
- A body with no key starting "spool_" is the legacy http-hook payload and is
  stored as before; any spool_* key makes the five SPOOL_KEYS required and
  valid. spool_orphans (D177-WI-4) is optional, so a WI-1..3 sender still
  works; when present it must be an integer >= 0.
- Per source the state is {epoch, max, missing, dead, orphans, retired}; dead
  and orphans are the highest spool_dead / spool_orphans seen in the epoch,
  duplicates included. gaps.json carries orphans only while it is > 0, so a
  sender that never orphaned anything keeps the WI-1..3 shape. A seq is "seen"
  when it is <= max and not in missing, so the state stays small however many
  events arrive. A new epoch retires the old one and restarts tracking.
- An epoch already retired is "stale": answered 200, not stored, and it never
  moves max, missing or dead.
- At most MAX_RETIRED_EPOCHS retired epochs are kept per source, oldest dropped
  first. Accepted limit: a replay from a dropped epoch is indistinguishable
  from a new epoch, so it restarts that source's tracking and is stored.
- At most MAX_MISSING missing seqs are kept per source (the highest ones). A
  lower one dropped from the list then reads as seen. Accepted limit: it only
  matters after a jump of more than MAX_MISSING seqs.
- A corrupt seq-state.json is moved aside and the state starts empty; the
  receiver keeps running.

stdlib only.
"""
import datetime
import json
import os
import re

SOURCE_RE = re.compile(r"[A-Za-z0-9._-]{1,64}")
EPOCH_RE = re.compile(r"[A-Za-z0-9_-]{8,64}")
MAX_RETIRED_EPOCHS = 64
MAX_MISSING = 10000
SPOOL_KEYS = ("spool_source", "spool_epoch", "spool_seq", "spool_ts", "spool_dead")
OPTIONAL_KEYS = ("spool_orphans",)


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def spool_fields(payload):
    """None for a legacy body, else the validated spool fields; ValueError names the bad one."""
    if not any(isinstance(k, str) and k.startswith("spool_") for k in payload):
        return None
    source = payload.get("spool_source")
    if not isinstance(source, str) or not SOURCE_RE.fullmatch(source):
        raise ValueError("spool_source")
    epoch = payload.get("spool_epoch")
    if not isinstance(epoch, str) or not EPOCH_RE.fullmatch(epoch):
        raise ValueError("spool_epoch")
    seq = payload.get("spool_seq")
    if not _is_int(seq) or seq < 1:
        raise ValueError("spool_seq")
    if not isinstance(payload.get("spool_ts"), str):
        raise ValueError("spool_ts")
    dead = payload.get("spool_dead")
    if not _is_int(dead) or dead < 0:
        raise ValueError("spool_dead")
    if "spool_orphans" in payload:
        orphans = payload["spool_orphans"]
        if not _is_int(orphans) or orphans < 0:
            raise ValueError("spool_orphans")
    return {k: payload[k] for k in SPOOL_KEYS + OPTIONAL_KEYS if k in payload}


def _fresh(epoch):
    return {"epoch": epoch, "max": 0, "missing": [], "dead": 0, "orphans": 0, "retired": []}


def _valid_entry(e):
    return (isinstance(e, dict) and isinstance(e.get("epoch"), str) and _is_int(e.get("max"))
            and isinstance(e.get("missing"), list) and all(_is_int(m) for m in e["missing"])
            and _is_int(e.get("dead")) and _is_int(e.get("orphans", 0))
            and isinstance(e.get("retired"), list)
            and all(isinstance(r, str) for r in e["retired"]))


def _write_atomic(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


class SeqState:
    def __init__(self, sources=None):
        self.sources = sources or {}

    @classmethod
    def load(cls, path, log):
        """Reads seq-state.json; a missing file is empty, a corrupt one is moved aside and logged."""
        if not os.path.exists(path):
            return cls()
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict) or not all(_valid_entry(v) for v in data.values()):
                raise ValueError("unexpected shape")
            return cls(data)
        except Exception as e:
            stamp = datetime.datetime.now().strftime("%Y%m%dT%H%M%S")
            aside = f"{path}.corrupt-{stamp}"
            try:
                os.replace(path, aside)
            except OSError:
                aside = "(not moved)"
            log(f"seq-state.json unreadable ({type(e).__name__}); moved to {os.path.basename(aside)}, starting empty")
            return cls()

    def apply(self, f):
        """Records one valid spooled event: "new" (store it), "duplicate" or "stale" (drop it)."""
        source, epoch, seq, dead = f["spool_source"], f["spool_epoch"], f["spool_seq"], f["spool_dead"]
        st = self.sources.get(source)
        if st is None:
            st = self.sources[source] = _fresh(epoch)
        elif st["epoch"] != epoch:
            if epoch in st["retired"]:
                return "stale"
            retired = (st["retired"] + [st["epoch"]])[-MAX_RETIRED_EPOCHS:]
            st = self.sources[source] = _fresh(epoch)
            st["retired"] = retired
        st["dead"] = max(st["dead"], dead)
        st["orphans"] = max(st.get("orphans", 0), f.get("spool_orphans", 0))
        if seq <= st["max"] and seq not in st["missing"]:
            return "duplicate"
        if seq > st["max"]:
            st["missing"].extend(range(st["max"] + 1, seq))
            st["missing"] = st["missing"][-MAX_MISSING:]
            st["max"] = seq
        else:
            st["missing"].remove(seq)
        return "new"

    def gaps(self):
        out = {}
        for s, e in self.sources.items():
            g = out[s] = {"epoch": e["epoch"], "max": e["max"], "missing": e["missing"], "dead": e["dead"]}
            if e.get("orphans", 0) > 0:
                g["orphans"] = e["orphans"]
        return out

    def save(self, state_path, gaps_path):
        _write_atomic(state_path, self.sources)
        _write_atomic(gaps_path, self.gaps())
