"""Purpose: read a brief's Markdown for brief-rules-check.py (GH592 fix 1), refusing what it cannot read.

`Brief(text)` splits lines at \\n, \\r\\n and \\r only. It blanks fenced blocks, pairs code spans across the lines of a
paragraph, and hides HTML comments that stand on lines of their own and link reference definition lines. Anywhere
outside fences and code spans it refuses, naming the 1-based line: a comment inside a line, a real HTML entity, an
HTML tag, a default-ignorable character and a line-separator character. `plain` has code spans blanked, `visible` keeps
them; both keep every column, so a position found in one holds in the other.

On top of that it finds labels that read as May edit or May create (escapes dropped, NFKC, Cyrillic and Greek
lookalikes folded), a scope paragraph's extent (to the next heading, field label or stop line), what in scope
refuses (a fence, an escape, a footnote, a defined reference link), the field as rendered (struck text and link titles
removed), and the views a reader sees for prose paths and phrases. Every doubt refuses.

@coordinates-with brief-rules-check.py, which loads this file from its own directory only.
"""
import html
import re
import unicodedata

SEPARATORS = "\u2028\u2029\u0085\v\f\x1c\x1d\x1e"
# Default_Ignorable code points that are not category Cf.
IGNORABLE_RANGES = ((0x034F, 0x034F), (0x115F, 0x1160), (0x17B4, 0x17B5), (0x180B, 0x180F), (0x3164, 0x3164),
                    (0xFE00, 0xFE0F), (0xFFA0, 0xFFA0), (0xE0000, 0xE0FFF))
ENTITY = re.compile(r"&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{0,31});")
TAG = re.compile(r"</?(?:b|i|u|s|em|strong|span|del|ins|strike|mark|small|big|font|sup|sub|code|kbd|a|br|div|p|details"
                 r"|summary)(?:\s[^<>]*)?/?>", re.I)
ESCAPE = re.compile(r"\\([!-/:-@\[-`{-~])")
SLASHES = dict.fromkeys(map(ord, "\u2215\u2044\u29f8\u2571\uff0f"), "/")
REF_DEF = re.compile(r"^ {0,3}\[([^\]]+)\]:")
REF_USE = re.compile(r"\[([^\]]+)\](?:\[([^\]]*)\])?(?!\()")
STRUCK = re.compile(r"~~.*?~~|~[^~]*?~", re.S)
# Ruling 6 Q1: Cyrillic and Greek lookalikes fold to Latin for label detection only; CJK is never folded.
FOLD = str.maketrans("МмаеорсухіткнвԁАЕОРСХТКНВΜαεορτκνΑΕΟΡΤΚΝ", "MmaeopcyxitkhbdAEOPCXTKHBMaeoptkvAEOPTKN")
# An opening emphasis run (left-flanking: not after a word or another marker, and not followed by a space).
EMPHASISED_MAY = re.compile(r"(?<![\w*_])[*_]{1,3}(may)\b(?=\s+[^\W\d_]|\s*[:*_]|\s*$)", re.I)
EMPHASIS_RUN = re.compile(r"(\*{1,3}|_{1,3})(?=\S)(.+?)(?<=\S)\1")
MAY_LABEL = re.compile(r"may\W{0,3}(?:edit|create)\b", re.I)
BLOCK_PREFIX = re.compile(r"\s*(?:(?:[-*+]|\d{1,9}[.)]|>|\|)\s+|\[[ xX]\]\s*|#{1,6}\s*|\[)*")
CAPITAL_MAY = re.compile(r"May\b(?=\s+[^\W\d_]|[:*])")
HEADING = re.compile(r"^ {0,3}#{1,6}(?:\s|$)")
BULLET = re.compile(r"^\s*(?:[-*+]|\d{1,9}[.)])\s")
FIELD_LABEL = re.compile(r"^\s*(?:(?:[-*+]|\d{1,9}[.)])\s+)?(?:\*\*[^*]+:\*\*|\*\*[^*]+\*\*:|[A-Z][A-Za-z]*(?: [A-Za-z]+){0,3}:)")
LINK_TITLE = re.compile(r"\]\([^\s()]*(\s+(?:\"[^\"]*\"|'[^']*'|\([^()]*\)))\s*\)", re.S)


class Refusal(Exception):
    pass


def ignorable(char):
    code = ord(char)
    return unicodedata.category(char) == "Cf" or any(low <= code <= high for low, high in IGNORABLE_RANGES)


def label_key(label):
    return " ".join(label.split()).lower()


def rendered_prose(text):
    """Scope text as a reader sees it, for the not-backticked check: NFKC, slash lookalikes and `a\\b` become `/`."""
    text = unicodedata.normalize("NFKC", text).translate(SLASHES)
    return re.sub(r"(?<=\w)\\(?=\w)", "/", text)


def label_view(line):
    """A line as a label reader sees it: escapes dropped, NFKC, lookalikes folded."""
    return unicodedata.normalize("NFKC", ESCAPE.sub(r"\1", line)).translate(FOLD)


def label_name(rest):
    colon = rest.find(":")
    end = colon if colon >= 0 else (rest.find("**") if "**" in rest else len(rest))
    return " ".join(rest[:end].replace("*", "").split())


def phrase_view(text):
    """Text as a reader sees a phrase in it: NFKC, emphasis and strike markers removed, whitespace collapsed."""
    return " ".join(re.sub(r"[*_~]", "", unicodedata.normalize("NFKC", text)).split())


def indent_of(line):
    return len(line) - len(line.lstrip())


def blank(chars, start, end):
    for k in range(start, end):
        if chars[k] != "\n":
            chars[k] = " "


class Brief:
    def __init__(self, text):
        self.raw = re.split(r"\r\n|\r|\n", text)
        self.fences = set()
        plain, visible, self.spans = self._scan("\n".join(self._unfence(self.raw)))
        self.plain, self.visible = plain.split("\n"), visible.split("\n")
        self.refs, definitions = set(), set()
        for i, line in enumerate(self.plain):
            self._refuse_anywhere(i, line)
            defined = REF_DEF.match(line)
            if defined:
                self.refs.add(label_key(defined.group(1)))
                definitions.add(i)
                self.plain[i] = self.visible[i] = " " * len(line)
        self.spans = [span for span in self.spans if span[0] not in definitions]

    def _unfence(self, lines):
        """Blank fenced code blocks (``` or ~~~, closed by a fence of the same character at least as long)."""
        fence, live = None, []
        for i, line in enumerate(lines):
            marker = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
            if fence:
                if marker and marker.group(1)[0] == fence[0] and len(marker.group(1)) >= fence[1] and not line[marker.end(1):].strip():
                    fence = None
            elif marker:
                fence = (marker.group(1)[0], len(marker.group(1)))
            else:
                live.append(line)
                continue
            self.fences.add(i)
            live.append("")
        return live

    def _scan(self, text):
        """Left to right: a code span (closed by the next run of its length before a blank line) or a comment."""
        plain, visible, spans, i = list(text), list(text), [], 0
        while i < len(text):
            if text[i] == "`":
                n = len(re.match(r"`+", text[i:]).group(0))
                stop = re.compile(r"\n[ \t]*\n").search(text, i)
                close = re.compile(r"(?<!`)`{%d}(?!`)" % n).search(text, i + n, stop.start() if stop else len(text))
                if not close:
                    i += n
                    continue
                spans.append(self._at(text, i) + (" ".join(text[i + n:close.start()].split("\n")).strip(),))
                blank(plain, i, close.end())
                i = close.end()
                continue
            if text.startswith("<!--", i):
                close = text.find("-->", i + 4)
                end = len(text) if close < 0 else close + 3
                after = text.find("\n", end)
                if text[text.rfind("\n", 0, i) + 1:i].strip() or text[end:len(text) if after < 0 else after].strip():
                    raise Refusal("HTML comment inside a line (line %d); put a comment on lines of its own"
                                  % (self._at(text, i)[0] + 1))
                blank(plain, i, end)
                blank(visible, i, end)
                i = end
                continue
            i += 1
        return "".join(plain), "".join(visible), spans

    @staticmethod
    def _at(text, offset):
        line = text.count("\n", 0, offset)
        return line, offset - (text.rfind("\n", 0, offset) + 1)

    def _refuse_anywhere(self, i, line):
        for char in line:
            if char in SEPARATORS:
                raise Refusal("line-separator character U+%04X (line %d); end lines with a newline only" % (ord(char), i + 1))
            if ignorable(char):
                raise Refusal("invisible character U+%04X (line %d); remove it" % (ord(char), i + 1))
        for hit in ENTITY.finditer(line):
            if html.unescape(hit.group(0)) != hit.group(0):
                raise Refusal("escape or entity (line %d): '%s'; write the character itself" % (i + 1, hit.group(0)))
        tag = TAG.search(line)
        if tag:
            raise Refusal("HTML tag (line %d): '%s'; write Markdown instead" % (i + 1, tag.group(0)))

    def unknown_labels(self, exact):
        """Fix 1 S5: `(name, line)` for each label that reads as May edit or May create but is not one of `exact`.

        A candidate is an emphasised `may` before a word, a colon, emphasis or the line end; a `may edit` / `may
        create` inside an emphasis run with a colon after it, in the run or right after it; or, after any block prefix, `may edit` /
        `may create` or a capitalised `May <word> …:`.
        """
        found = []
        for i, line in enumerate(self.plain):
            for label in exact:
                line = line.replace(label, " " * len(label))
            view = label_view(line)
            starts = [hit.start(1) for hit in EMPHASISED_MAY.finditer(view)]
            for run in EMPHASIS_RUN.finditer(view):
                inner = MAY_LABEL.search(run.group(2))
                if inner and (":" in run.group(2)[inner.end():] or view[run.end():run.end() + 1] == ":"):
                    starts.append(run.start(2) + inner.start())
            lead = BLOCK_PREFIX.match(view).end()
            if MAY_LABEL.match(view, lead) or (CAPITAL_MAY.match(view, lead) and ":" in view[lead:]):
                starts.append(lead)
            found.extend((label_name(view[start:]), i + 1) for start in sorted(set(starts)))
        return found

    def scope_extent(self, start, column, stops):
        """Fix 1 S4: `(start, column, end)` of a scope paragraph. It runs, blank lines included, until a heading, a
        line holding one of `stops` (the exact labels and the field), a field-label bullet at or above the marker's
        indent, or a column-0 field-label line after a blank line; a lazy continuation stays in."""
        lines, indent, end = self.plain, indent_of(self.plain[start]), start + 1
        while end < len(lines):
            line = lines[end]
            if HEADING.match(line) or any(stop in line for stop in stops):
                break
            if FIELD_LABEL.match(line):
                if BULLET.match(line) and indent_of(line) <= indent:
                    break
                if not BULLET.match(line) and not indent_of(line) and not lines[end - 1].strip():
                    break
            end += 1
        return start, column, end

    def paragraphs(self):
        """Each run of non-blank lines, joined, as `plain` text."""
        return [block for block in re.split(r"\n[ \t]*\n", "\n".join(self.plain)) if block.strip()]

    def spans_in(self, start, column, end):
        """Code-span contents opening at or after `column` of line `start`, through line `end - 1`."""
        return [content for line, col, content in self.spans if (line == start and col >= column) or start < line < end]

    def text(self, lines, start, column, end):
        return "\n".join([lines[start][column:]] + lines[start + 1:end])

    def refuse_in_scope(self, start, column, end):
        """Inside a scope paragraph, outside code spans: a fence, an escape, a footnote or a defined reference link refuses."""
        for i in range(start, end):
            if i in self.fences:
                raise Refusal("fenced block in scope (line %d); end the scope before the fence" % (i + 1))
            line = self.plain[i][column:] if i == start else self.plain[i]
            escape = ESCAPE.search(line)
            if escape:
                raise Refusal("escape or entity (line %d): '%s'; write the character itself" % (i + 1, escape.group(0)))
            if "[^" in line:
                raise Refusal("footnote in scope (line %d); write the path in the scope line" % (i + 1))
            for use in REF_USE.finditer(line):
                if label_key(use.group(2) or use.group(1)) in self.refs:
                    raise Refusal("reference link in scope (line %d): '%s'; write the path in the scope line"
                                  % (i + 1, use.group(0)))

    def field_text(self, start, column, end):
        """The field paragraph as rendered: struck text and link titles removed (found outside code spans)."""
        plain, visible = list(self.text(self.plain, start, column, end)), list(self.text(self.visible, start, column, end))
        source = "".join(plain)
        for hit in STRUCK.finditer(source):
            blank(visible, hit.start(), hit.end())
        for hit in LINK_TITLE.finditer(source):
            blank(visible, hit.start(1), hit.end(1))
        return "".join(visible)
