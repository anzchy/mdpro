"""Purpose: the spool half of the dtrack hook receiver (D177-WI-1): validate the
spool_* fields of a POST body, dedupe on (source, epoch, seq), and keep the
per-source seq state that gaps.json is made from.

Pipeline: spool_fields(payload) -> None (legacy body) | SpoolFields | ValueError
  -> SeqState.plan(fields) -> ("new" | "duplicate" | "stale", source, entry, late),
     nothing mutated -> the caller stores the event -> SeqState.commit(source,
     entry) -> SeqState.save(state_path, gaps_path) (each a tmp file +
     os.replace). SeqState.apply is plan + commit in one step.

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
- At most MAX_MISSING missing seqs are kept per source (the highest ones).
  Whatever the cap discards raises the source's `floor`, the lowest seq it can
  still judge (D177-H-4, audit b95 M2): after a trim, the lowest retained
  missing seq; after a capped jump, that jump's `low`. A seq below the floor
  is unknown, so it is accepted as "new" with late=True, never "duplicate":
  a retry that was dropped from `missing` would otherwise be lost. It leaves
  max, missing and floor alone. `floor` persists
  in seq-state.json (older state without it reads as 1), restarts at 1 with a
  new epoch, and shows in gaps.json only while > 1.
- Below the floor, `late_seen` (D177-H5-WI-1, audit b96 M1) remembers the late
  seqs already stored, oldest first, at most MAX_LATE_SEEN: a retry of one is
  "duplicate", so a sender stuck retrying an old seq cannot fill events.jsonl.
  It lives in seq-state.json only and resets with a new epoch. Accepted
  limit: once a late seq is evicted from the bounded set, a retry of it is
  stored again (marked spool_late by the receiver).
- On load, floor must be a safe integer >= 1 and late_seen a list of them
  (b96 L3); anything else is corrupt state, never clamped.
- Planning never mutates (D177-H-2, audit b92 finding 3): the receiver commits
  a seq only after the event is on disk, so a failed append leaves the seq
  unseen and the sender's retry is stored, not answered "duplicate".
- Every integer field must be a safe integer, <= MAX_SAFE_INT (2**53 - 1), the
  largest the JS sender can count to exactly (D177-H-3, finding 6). A jump to
  a large seq builds at most MAX_MISSING missing entries, never a list the
  size of the jump (finding 4): the cap applies before the list is built.
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
MAX_LATE_SEEN = 1024
MAX_SAFE_INT = 2**53 - 1
MAX_MISSING = 10000
SPOOL_KEYS = ("spool_source", "spool_epoch", "spool_seq", "spool_ts", "spool_dead")
OPTIONAL_KEYS = ("spool_orphans",)


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool) and -MAX_SAFE_INT <= v <= MAX_SAFE_INT


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
    return {"epoch": epoch, "max": 0, "missing": [], "dead": 0, "orphans": 0, "floor": 1, "late_seen": [],
            "retired": []}


def _is_seq(v):
    return _is_int(v) and v >= 1


def _valid_entry(e):
    return (isinstance(e, dict) and isinstance(e.get("epoch"), str) and _is_int(e.get("max"))
            and isinstance(e.get("missing"), list) and all(_is_int(m) for m in e["missing"])
            and _is_int(e.get("dead")) and _is_int(e.get("orphans", 0)) and _is_seq(e.get("floor", 1))
            and isinstance(e.get("late_seen", []), list) and all(_is_seq(s) for s in e.get("late_seen", []))
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

    def plan(self, f):
        """What one valid spooled event would do, without mutating anything.

        Returns (outcome, source, entry, late): outcome "new" (store the event,
        then commit), "duplicate" (commit only: dead/orphans may rise) or "stale"
        (drop; entry is None). late is True for a "new" seq below the floor.
        """
        source, epoch, seq, dead = f["spool_source"], f["spool_epoch"], f["spool_seq"], f["spool_dead"]
        cur = self.sources.get(source)
        if cur is None:
            st = _fresh(epoch)
        elif cur["epoch"] != epoch:
            if epoch in cur["retired"]:
                return "stale", source, None, False
            st = _fresh(epoch)
            st["retired"] = (cur["retired"] + [cur["epoch"]])[-MAX_RETIRED_EPOCHS:]
        else:
            st = dict(cur, missing=list(cur["missing"]), retired=list(cur["retired"]),
                      late_seen=list(cur.get("late_seen", [])))
        st["dead"] = max(st["dead"], dead)
        st["orphans"] = max(st.get("orphans", 0), f.get("spool_orphans", 0))
        floor = st.get("floor", 1)
        if seq < floor:
            # Unknown: the cap discarded what would say whether it arrived. Accept it
            # once rather than lose a retry; late_seen turns later retries into
            # duplicates until the seq is evicted from that bounded set.
            late_seen = st.get("late_seen", [])
            if seq in late_seen:
                return "duplicate", source, st, False
            st["late_seen"] = (late_seen + [seq])[-MAX_LATE_SEEN:]
            return "new", source, st, True
        if seq <= st["max"] and seq not in st["missing"]:
            return "duplicate", source, st, False
        if seq > st["max"]:
            low = max(st["max"] + 1, seq - MAX_MISSING)  # cap before building: a jump costs O(MAX_MISSING)
            built = st["missing"] + list(range(low, seq))
            kept = built[-MAX_MISSING:]
            if low > st["max"] + 1 or len(kept) < len(built):
                floor = max(floor, kept[0] if kept else low)
            st["missing"], st["max"], st["floor"] = kept, seq, floor
        else:
            st["missing"].remove(seq)
        return "new", source, st, False

    def commit(self, source, entry):
        if entry is not None:
            self.sources[source] = entry

    def apply(self, f):
        """plan + commit: records one valid spooled event and returns its outcome."""
        outcome, source, entry, _late = self.plan(f)
        self.commit(source, entry)
        return outcome

    def gaps(self):
        out = {}
        for s, e in self.sources.items():
            g = out[s] = {"epoch": e["epoch"], "max": e["max"], "missing": e["missing"], "dead": e["dead"]}
            if e.get("orphans", 0) > 0:
                g["orphans"] = e["orphans"]
            if e.get("floor", 1) > 1:
                g["floor"] = e["floor"]
        return out

    def save(self, state_path, gaps_path):
        _write_atomic(state_path, self.sources)
        _write_atomic(gaps_path, self.gaps())
