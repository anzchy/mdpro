# D44 device check

Copy this file to the scratchpad and open the copy. Do this in **source mode
(⌃2)**: WYSIWYG drops the extra cells when it loads the file, so ⌘S from ⌃4
cannot keep them (ADR-0052).

Steps: ⌘, → Markdown, tick auto-reformat tables on save. Open the copy, press
⌃2, type a space at the end of this line and delete it, then press ⌘S.

Expected: every cell below survives the save. Each table widens to its own
widest row: the header gets empty cells, the delimiter gets `---` for each new
column, and shorter rows are padded. Table 1 becomes 3 columns, with `Z` in the
third column of the `g` row. Table 2 becomes 4 columns. The log has one
`editor.table.format-widened` line per table, with `fromColCount` and
`toColCount` and no cell text. The fenced block at the end is not touched.

## 1. Repro (2 → 3)

| a | b |
| - | - |
| e | f |
| g | h |Z

## 2. A different width (1 → 4)

| x |
| - |
| 3 | Q | R | S |

## 3. Alignment (3 → 4; the new column is `---`, the others keep their colons)

| a | b | c |
| :- | :-: | -: |
| 1 | 2 | 3 | Z |

## 4. Escaped pipe (2 → 3; `a \| b` stays one cell)

| a | b |
| - | - |
| 1 | 2 | a \| b |

## 5. CJK (2 → 3; `中文字Z` is kept byte for byte)

| 名前 | 值 |
| - | - |
| a | b | 中文字Z |

## 6. Blank first cell (2 → 3; `x` stays in column 2, `Z` lands in column 3)

| a | b |
| - | - |
| | x | Z |

## Expected bytes on disk

```
| a   | b   |     |
| --- | --- | --- |
| e   | f   |     |
| g   | h   | Z   |

| x   |     |     |     |
| --- | --- | --- | --- |
| 3   | Q   | R   | S   |

| a   | b   | c   |     |
| :-- | :-: | --: | --- |
| 1   | 2   | 3   | Z   |

| a   | b   |        |
| --- | --- | ------ |
| 1   | 2   | a \| b |

| 名前  | 值   |      |
| --- | --- | ---- |
| a   | b   | 中文字Z |

| a   | b   |     |
| --- | --- | --- |
|     | x   | Z   |
```

Widths are counted in UTF-16 units, so the CJK table does not line up on
screen. That was already true before D44 and is not part of this check.
