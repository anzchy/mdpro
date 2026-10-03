# WI-0.4 surfaces fixture

One document that puts every Appendix B content surface on screen: headings,
inline marks, links, inline HTML, quotes, lists, code, a table and an image.

## Inline marks

This line has **bold**, *italic*, `inline code`, ~~strike~~ and ==highlight==.
A [named link](https://example.com) and an autolink <https://example.org>.
Inline HTML: <kbd>⌘</kbd> + <kbd>K</kbd> and <sub>sub</sub> text.

> A blockquote that runs long enough to wrap onto a second line at the default
> window width, so its left rule and padding are both visible.

## Lists

- Bullet one
- Bullet two
  - Nested bullet

1. Ordered one
2. Ordered two

- [ ] Open task
- [x] Done task

## Code and table

```ts
function greet(name: string): string {
  return `hello, ${name}`;
}
```

| Column A | Column B | Column C |
| --- | :---: | ---: |
| a1 | b1 | c1 |
| a2 | b2 | c2 |

## Collapsible parent

### Child heading one

Text under the first child.

### Child heading two

Text under the second child.

![image 1](img/i01.png)
