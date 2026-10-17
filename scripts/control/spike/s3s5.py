"""ADR-0047 WI-006 spike, S3-S5: the driver's `cli` steps of the journeys, one step per call.

Usage (through s3s5.sh, which supplies S3S5_PORT and S3S5_TOKEN from the run's control.json):
    s3s5.py <step>            e.g. j2.3, j4b.3, probe
    s3s5.py --dry-run <step>  print the requests a step would send, without a server
Prints "S3S5 <step> OK|ERR <detail>" and one "STATE <json>" line. Never prints the token.

Only fixed W3C commands are used (eval stays off): find, click, send keys, actions, text, rect,
selected, window handles. Each call opens a fresh session on the named window (capability
wdio:tauriServiceOptions.windowLabel); sessions are never deleted, as in s1a/s1b/s2esc.
A step's expected state is in docs/test/20261002-adr0047-journeys.md; this script reports what it
reads and judges nothing. Known from source: special keys (arrows, Backspace, Enter) are sent
without modifier flags (executor.rs dispatch_key_event), so Shift+Arrow may not extend a selection.
"""
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request

EL = "element-6066-11e4-a52e-4f735466cecf"
SHIFT, META, CTRL = "", "", ""
LEFT, BACKSPACE, ENTER = "", "", ""
FIND_TRIES, FIND_WAIT_S = 10, 0.5

DRY = False


class WdError(Exception):
    pass


def request(method, path, body=None):
    rid = f"s3s5-{random.getrandbits(48):012x}"
    if DRY:
        print(f"DRY {method} {path} {json.dumps(body) if body is not None else ''}".rstrip())
        if path.endswith("/elements"):
            return {"value": [{EL: "E"}]}
        if path.endswith("/window/handles"):
            return {"value": ["main"]}
        if path.endswith(("/text", "/name", "/attribute/class")):
            return {"value": "t"}
        return {"value": {"sessionId": "S", EL: "E", "x": 0, "y": 0, "width": 100, "height": 20}}
    port, token = os.environ["S3S5_PORT"], os.environ["S3S5_TOKEN"]
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Request-Id", rid)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()[:300].decode("utf-8", "replace")
        raise WdError(f"{method} {path.split('/')[-1]} -> {e.code} {raw}") from None
    except (urllib.error.URLError, TimeoutError) as e:
        raise WdError(f"{method} {path.split('/')[-1]} -> no response ({e})") from None


class Session:
    def __init__(self, window="main"):
        caps = {"capabilities": {"alwaysMatch": {"wdio:tauriServiceOptions": {"windowLabel": window}}}}
        self.g = "/session/" + request("POST", "/session", caps)["value"]["sessionId"]

    def find_all(self, using, value):
        return [e[EL] for e in request("POST", f"{self.g}/elements", {"using": using, "value": value})["value"]]

    def find(self, using, value, tries=FIND_TRIES):
        for i in range(tries):
            found = self.find_all(using, value)
            if found:
                return found[0]
            if i + 1 < tries and not DRY:
                time.sleep(FIND_WAIT_S)
        raise WdError(f"not found: {value}")

    def text(self, el):
        return request("GET", f"{self.g}/element/{el}/text")["value"]

    def rect(self, el):
        return request("GET", f"{self.g}/element/{el}/rect")["value"]

    def selected(self, el):
        return request("GET", f"{self.g}/element/{el}/selected")["value"]

    def attr(self, el, name):
        return request("GET", f"{self.g}/element/{el}/attribute/{name}")["value"]

    def click(self, el):
        request("POST", f"{self.g}/element/{el}/click", {})

    def send_keys(self, el, text):
        request("POST", f"{self.g}/element/{el}/value", {"text": text})

    def handles(self):
        return request("GET", f"{self.g}/window/handles")["value"]

    def keys(self, seq):
        """seq: list of ("down"|"up", key). One key source, one performActions."""
        acts = [{"type": "keyDown" if d == "down" else "keyUp", "value": k} for d, k in seq]
        request("POST", f"{self.g}/actions", {"actions": [{"type": "key", "id": "k", "actions": acts}]})

    def pointer_click(self, x, y):
        acts = [{"type": "pointerMove", "x": int(x), "y": int(y)},
                {"type": "pointerDown", "button": 0}, {"type": "pointerUp", "button": 0}]
        request("POST", f"{self.g}/actions",
                {"actions": [{"type": "pointer", "id": "p", "parameters": {"pointerType": "mouse"}, "actions": acts}]})


def press(key, n=1, mods=()):
    seq = [("down", m) for m in mods]
    for _ in range(n):
        seq += [("down", key), ("up", key)]
    return seq + [("up", m) for m in reversed(mods)]


CM_LINES = "//div[contains(@class,'cm-content')]/div[contains(@class,'cm-line')]"
PM = "#milkdown-container .ProseMirror"
PM_BLOCKS = "//div[@id='milkdown-container']//div[contains(@class,'ProseMirror')]/*"


def tabs(s):
    out = []
    for t in s.find_all("css selector", ".bottom-tab"):
        cls = s.attr(t, "class") or ""
        name = request("POST", f"{s.g}/element/{t}/elements", {"using": "css selector", "value": ".bottom-tab__name"})["value"]
        dirty = request("POST", f"{s.g}/element/{t}/elements", {"using": "css selector", "value": ".bottom-tab__modified"})["value"]
        out.append({"name": s.text(name[0][EL]) if name else None, "active": "bottom-tab--active" in cls, "dirty": bool(dirty)})
    return out


def cm_state(s):
    lines = s.find_all("xpath", CM_LINES)
    return {"lastLine": s.text(lines[-1]) if lines else None, "lines": len(lines),
            "selectionLayers": len(s.find_all("css selector", ".cm-selectionBackground")), "tabs": tabs(s)}


def pm_state(s):
    blocks = s.find_all("xpath", PM_BLOCKS)
    last = blocks[-1] if blocks else None
    strong = []
    if last:
        strong = [s.text(e[EL]) for e in request("POST", f"{s.g}/element/{last}/elements", {"using": "css selector", "value": "strong"})["value"]]
    return {"lastBlock": s.text(last) if last else None,
            "lastTag": request("GET", f"{s.g}/element/{last}/name")["value"] if last else None,
            "lastStrong": strong, "tabs": tabs(s)}


def j2_1(s):
    # Setup, not judged: a pointer click at the right end of the last CodeMirror line (the empty line after the final newline).
    last = s.find("xpath", f"({CM_LINES})[last()]")
    r = s.rect(last)
    s.pointer_click(r["x"] + r["width"] - 4, r["y"] + r["height"] / 2)
    return cm_state(s)


def cm_el(s):
    return s.find("css selector", ".cm-content")


def pm_el(s):
    return s.find("css selector", PM)


def settings_close(s):
    return s.find("xpath", "//div[contains(@class,'settings-footer')]//button[normalize-space(.)='Close']")


def checkbox_state(s):
    found = s.find_all("css selector", "#md-auto-pair")
    return {"checkbox": s.selected(found[0]) if found else None,
            "dialog": len(s.find_all("css selector", "[role=dialog]"))}


def all_windows(s):
    out = {}
    for label in s.handles():
        out[label] = tabs(Session(label))
    return {"windows": out}


STEPS = {
    "j2.1": j2_1,
    "j2.2": lambda s: (s.send_keys(cm_el(s), "alpha beta"), cm_state(s))[1],
    "j2.3": lambda s: (s.keys(press(LEFT, 5) + press(LEFT, 5, (SHIFT,))), cm_state(s))[1],
    "j2.4": lambda s: (s.keys(press(BACKSPACE)), cm_state(s))[1],
    "j2.5": lambda s: (s.keys(press("z", 1, (META,))), cm_state(s))[1],
    "j2.6": lambda s: (s.keys(press("1", 1, (META,))), cm_state(s))[1],
    # J3 setup: a pointer click at the right end of "Last paragraph.", then Ctrl+E (selectTextblockEnd) as a fallback.
    "j3.1": lambda s: (j3_1(s), pm_state(s))[1],
    "j3.2": lambda s: (s.keys(press(ENTER)), s.send_keys(pm_el(s), "alpha beta"), pm_state(s))[2],
    "j3.3": lambda s: (s.keys(press(LEFT, 4, (SHIFT,))), pm_state(s))[1],
    "j3.4": lambda s: (s.keys(press("b", 1, (META,))), pm_state(s))[1],
    "j3.5": lambda s: (s.keys(press(LEFT, 2) + press(LEFT, 5, (SHIFT,))), pm_state(s))[1],
    "j3.6": lambda s: (s.keys(press(BACKSPACE)), pm_state(s))[1],
    "j3.7": lambda s: (s.keys(press("z", 1, (META,))), pm_state(s))[1],
    "j3.8": lambda s: (s.keys(press("1", 1, (META,))), pm_state(s))[1],
    "j4a.1": lambda s: (s.click(s.find("css selector", "button.bottom-tabs__add")), {"tabs": tabs(s)})[1],
    "j4b.2": lambda s: (s.click(s.find("xpath", "//button[contains(@class,'settings-category-btn') and contains(., 'Markdown')]")), checkbox_state(s))[1],
    "j4b.3": lambda s: (s.click(s.find("css selector", "#md-auto-pair")), checkbox_state(s))[1],
    "j4b.4": lambda s: (s.click(settings_close(s)), checkbox_state(s))[1],
    # J6 steps 2-4 and the reads after J7a/J7b: one session per window label, read only.
    "probe": all_windows,
}


def j3_1(s):
    para = s.find("xpath", "//div[@id='milkdown-container']//p[normalize-space(.)='Last paragraph.']")
    r = s.rect(para)
    s.pointer_click(r["x"] + r["width"] - 4, r["y"] + r["height"] / 2)
    s.keys(press("e", 1, (CTRL,)))


def main(argv):
    global DRY
    if argv[:1] == ["--dry-run"]:
        DRY, argv = True, argv[1:]
    if len(argv) != 1 or argv[0] not in STEPS:
        print("usage: s3s5.py [--dry-run] <" + "|".join(STEPS) + ">")
        return 2
    step = argv[0]
    try:
        state = STEPS[step](Session())
    except WdError as e:
        print(f"S3S5 {step} ERR {e}")
        return 1
    print(f"S3S5 {step} OK")
    print("STATE " + json.dumps(state, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
