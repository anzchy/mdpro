"""ADR-0047 WI-007 spike, candidate B: the journeys' `cli` steps, one step per call, plus the probe and the S2 Esc.

Usage: s3s5b.py <run-id> <step>     steps: see STEPS (the same names as candidate A's s3s5.py)
Prints "S3S5 <step> OK|ERR <detail>" and one "STATE <json>" line. Never prints the token.

Every step starts with `activate` (window key, app active; it sends no event into the page; user ruling
2026-10-17 「Allow activate, record it (Recommended)」), then sends native input through the control channel,
then reads the state back with `probe`. It judges nothing; the journeys doc does.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ctl  # noqa: E402

SETTLE_S = 0.3  # lets the page render after native input before the read-back
CM_LAST_LINE = {"using": "css", "value": ".cm-content > .cm-line", "index": -1}
PM_LAST_PARA = {"using": "xpath", "value": "//div[@id='milkdown-container']//p[normalize-space(.)='Last paragraph.']"}


class StepError(Exception):
    pass


class Run:
    def __init__(self, run_id, window="main"):
        self.sock, self.token = ctl.load(run_id=run_id)
        self.window = window
        self.n = 0
        self.step = "?"

    def call(self, cmd, args=None, window=None):
        self.n += 1
        rid = f"b-{self.step}-{self.n}-{os.getpid()}"
        rep = ctl.call(self.sock, self.token, cmd, args, window or self.window, rid)
        if not rep.get("ok"):
            err = rep.get("error", {})
            raise StepError(f"{cmd}: {err.get('code')} {err.get('message', '')}")
        return rep.get("value")

    def key(self, name, mods=(), repeat=1):
        return self.call("key", {"key": name, "mods": list(mods), "repeat": repeat})

    def probe(self, kind, window=None):
        time.sleep(SETTLE_S)
        return self.call("probe", {"kind": kind}, window)


def all_windows(r):
    return {"windows": {w: r.probe("tabs", w)["tabs"] for w in r.call("windows")}}


def css(sel):
    return {"using": "css", "value": sel}


def xpath(expr):
    return {"using": "xpath", "value": expr}


STEPS = {
    # J2, Source. 2.1 is setup: a native click at the end of the last (empty) line.
    "j2.1": lambda r: (r.call("click", dict(CM_LAST_LINE, at="end")), r.probe("cm"))[1],
    "j2.2": lambda r: (r.call("type", {"text": "alpha beta"}), r.probe("cm"))[1],
    "j2.3": lambda r: (r.key("ArrowLeft", repeat=5), r.key("ArrowLeft", ["shift"], 5), r.probe("cm"))[2],
    "j2.4": lambda r: (r.key("Backspace"), r.probe("cm"))[1],
    "j2.5": lambda r: (r.key("z", ["cmd"]), r.probe("cm"))[1],
    "j2.6": lambda r: (r.key("1", ["cmd"]), r.probe("cm"))[1],
    # J3, WYSIWYG. 3.1 is setup: a native click at the end of "Last paragraph.".
    "j3.1": lambda r: (r.call("click", dict(PM_LAST_PARA, at="end")), r.probe("pm"))[1],
    "j3.2": lambda r: (r.key("Enter"), r.call("type", {"text": "alpha beta"}), r.probe("pm"))[2],
    "j3.3": lambda r: (r.key("ArrowLeft", ["shift"], 4), r.probe("pm"))[1],
    "j3.4": lambda r: (r.key("b", ["cmd"]), r.probe("pm"))[1],
    "j3.5": lambda r: (r.key("ArrowLeft", repeat=2), r.key("ArrowLeft", ["shift"], 5), r.probe("pm"))[2],
    "j3.6": lambda r: (r.key("Backspace"), r.probe("pm"))[1],
    "j3.7": lambda r: (r.key("z", ["cmd"]), r.probe("pm"))[1],
    "j3.8": lambda r: (r.key("1", ["cmd"]), r.probe("pm"))[1],
    "j4a.1": lambda r: (r.call("click", css("button.bottom-tabs__add")), r.probe("tabs"))[1],
    "j4b.2": lambda r: (r.call("click", xpath("//button[contains(@class,'settings-category-btn') and contains(., 'Markdown')]")), r.probe("dialog"))[1],
    "j4b.3": lambda r: (r.call("click", css("#md-auto-pair")), r.probe("dialog"))[1],
    "j4b.4": lambda r: (r.call("click", xpath("//div[contains(@class,'settings-footer')]//button[normalize-space(.)='Close']")), r.probe("dialog"))[1],
    "j5.1": lambda r: (r.call("click", dict(CM_LAST_LINE, at="end")), r.call("type", {"text": "x"}), r.probe("cm"))[2],
    "j5.2": lambda r: (r.call("click", css(".bottom-tab--active .bottom-tab__close")), r.probe("dialog"))[1],
    "j5.ke": lambda r: (r.call("click", xpath("//div[contains(@class,'dialog-card')]//button[normalize-space(.)='Keep editing']")), r.probe("dialog"))[1],
    # S2.2 / S2.3: the driver's Esc after J5 step 2a; returns the focus read taken just before the key.
    "s2esc": lambda r: (lambda before: (r.key("Escape"), {"before": before, "after": r.probe("dialog")})[1])(r.probe("focus")),
    "probe": all_windows,
}

# Steps that only read: no activation first, so a read never changes which window is key.
READ_ONLY = {"probe"}


def main(argv):
    if len(argv) != 2 or argv[1] not in STEPS:
        print("usage: s3s5b.py <run-id> <" + "|".join(STEPS) + ">")
        return 2
    run_id, step = argv
    try:
        r = Run(run_id)
    except (FileNotFoundError, KeyError, json.JSONDecodeError) as e:
        print(f"S3S5 {step} ERR no control.json for run {run_id} ({type(e).__name__})")
        return 2
    r.step = step
    try:
        activated = None if step in READ_ONLY else r.call("activate")
        state = STEPS[step](r)
    except (StepError, OSError) as e:
        print(f"S3S5 {step} ERR {e}")
        return 1
    print(f"S3S5 {step} OK" + ("" if activated is None else f" activate={json.dumps(activated)}"))
    print("STATE " + json.dumps(state, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
