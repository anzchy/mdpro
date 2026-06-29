//! Purpose: math + footnote + autolink post-processing for the canonical (Rust)
//! markdown render surface (WI-1.1, WI-1.3, WI-1.4 of the Typora-parity plan).
//!
//! pulldown-cmark 0.11 exposes `Options::ENABLE_MATH` and
//! `Options::ENABLE_FOOTNOTES`, but its default HTML writer:
//!   - emits `<span class="math math-inline">` for BOTH inline and display
//!     math (not the `<span class="math-inline">` / `<div class="math-display">`
//!     split mdpro's KaTeX pass keys off), and
//!   - does NOT emit a return ("back-link") anchor from a footnote definition
//!     back to its reference.
//!
//! Split into focused submodules (audit B-M1), each under ~300 lines:
//!   - [`math`] — [`render_inline_math`] / [`render_display_math`]: emit mdpro's
//!     wrapper classes carrying the *raw, HTML-escaped* TeX so the KaTeX pass
//!     (preview) or MathML-in-export can typeset it. Math inside a code fence
//!     never reaches here because pulldown-cmark does not emit math events
//!     inside code.
//!   - [`autolink`] — [`preprocess_autolink_and_emoji`]: a markdown-source
//!     transform that wraps bare `http(s)://` URLs in CommonMark autolink
//!     brackets and replaces known `:shortcode:` emoji with glyphs, skipping
//!     code fences / inline code / existing links.
//!   - [`footnotes`] — [`add_footnote_back_links`]: a post-render rewrite that
//!     gives every footnote reference a stable `id` and appends a `↩` back-link
//!     to each definition pointing at its (first) reference. In-doc anchors only
//!     — the sanitizer (`sanitize_html`) drops any non-`#` href regardless.
//!
//! @coordinates-with src-tauri/src/services/markdown.rs (render loop calls the
//!   math helpers; `render_markdown` calls `add_footnote_back_links`)
//! @coordinates-with src/components/Preview/mathRender.ts (KaTeX pass keys off
//!   `.math-inline` / `.math-display`)

mod autolink;
mod footnotes;
mod math;

pub use autolink::preprocess_autolink_and_emoji;
pub use footnotes::add_footnote_back_links;
pub use math::{render_display_math, render_inline_math};

/// Escape the five HTML-significant characters. Mirrors `markdown::html_escape`
/// (kept local so this module has no cross-call dependency on the parent).
/// Shared by the submodules (`pub(crate)` within the module tree).
pub(super) fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}
