fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

/// Vendored KaTeX stylesheet (WI-1.1). Inlined into exported HTML when the
/// document contains pre-rendered math so the export renders fully offline with
/// zero JS. Font glyphs reference relative `fonts/` URLs that won't resolve in a
/// standalone file — KaTeX degrades to the system math font; the layout/markup
/// is correct and readable. (Base64 font embedding is a documented follow-up.)
const KATEX_CSS: &str = include_str!("../../assets/katex.min.css");

/// True when the rendered body carries pre-rendered KaTeX output (a `katex`
/// wrapper) OR an un-rendered math placeholder. Either way the KaTeX CSS is
/// needed to lay the math out.
fn needs_katex_css(content: &str) -> bool {
    content.contains("class=\"katex")
        || content.contains("class=\"math-inline\"")
        || content.contains("class=\"math-display\"")
}

pub fn build_html(content: &str, title: &str, theme: &str) -> String {
    let safe_title = html_escape(title);
    let safe_theme = if theme == "dark" { "dark" } else { "light" };
    let (bg, text, code_bg, border) = if safe_theme == "dark" {
        ("#0f1115", "#e5e7eb", "#1b2230", "#242a36")
    } else {
        ("#ffffff", "#1a1a1a", "#f4f4f4", "#e5e7eb")
    };

    let styles = format!(
        "body {{ background: {bg}; color: {text}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }}\n\
        .markdown-body {{ max-width: 860px; margin: 40px auto; padding: 0 24px; line-height: 1.7; }}\n\
        h1, h2, h3, h4 {{ margin: 24px 0 12px; }}\n\
        pre {{ background: {code_bg}; padding: 16px; border-radius: 8px; overflow: auto; }}\n\
        code {{ background: {code_bg}; padding: 2px 4px; border-radius: 4px; }}\n\
        table {{ width: 100%; border-collapse: collapse; margin: 16px 0; }}\n\
        th, td {{ border: 1px solid {border}; padding: 8px 10px; text-align: left; }}\n\
        th[align=\"center\"], td[align=\"center\"] {{ text-align: center; }}\n\
        th[align=\"right\"], td[align=\"right\"] {{ text-align: right; }}\n\
        blockquote {{ border-left: 3px solid {border}; padding-left: 12px; color: #6b7280; }}\n\
        img {{ max-width: 100%; border-radius: 6px; }}",
        bg = bg,
        text = text,
        code_bg = code_bg,
        border = border
    );

    // Inline KaTeX CSS only when the body actually contains math, so non-math
    // exports stay lean.
    let katex_block = if needs_katex_css(content) {
        format!("\n  <style>{}</style>", KATEX_CSS)
    } else {
        String::new()
    };

    format!(
        "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n  <title>{}</title>\n  <style>{}</style>{}\n</head>\n<body class=\"{}\">\n  <article class=\"markdown-body\">{}\n  </article>\n</body>\n</html>",
        safe_title, styles, katex_block, safe_theme, content
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_math_omits_katex_css() {
        let html = build_html("<p>plain</p>", "doc", "light");
        assert!(!html.contains("KaTeX"), "no KaTeX CSS when no math present");
    }

    #[test]
    fn pre_rendered_math_inlines_katex_css() {
        let html = build_html(
            "<span class=\"katex\"><span class=\"katex-html\">x</span></span>",
            "doc",
            "light",
        );
        // The vendored KaTeX stylesheet defines `.katex` — its presence proves
        // the CSS was inlined.
        assert!(
            html.contains(".katex"),
            "KaTeX CSS must be inlined for math export"
        );
    }

    #[test]
    fn math_placeholder_also_inlines_css() {
        let html = build_html("<div class=\"math-display\">x</div>", "doc", "dark");
        assert!(
            html.contains(".katex"),
            "placeholder must still pull in KaTeX CSS"
        );
    }

    #[test]
    fn title_is_html_escaped() {
        let html = build_html("<p>x</p>", "<script>", "light");
        assert!(!html.contains("<title><script>"), "title must be escaped");
        assert!(html.contains("&lt;script&gt;"), "escaped title expected");
    }

    // ------------------------------------------------------------------
    // Table-cell alignment in the exported stylesheet (stage 2.2).
    //
    // Migrated from tests/table-alignment-rendering.test.ts, which grepped
    // THIS FILE'S SOURCE for `[align=\"center\"]` — a pattern matching Rust's
    // lexical backslash escaping, an artifact of the language rather than
    // anything the product emits. These assert on the document `build_html`
    // returns instead, and run in the lane that owns the function.
    //
    // Evidence limit, stated so it does not read as an oversight: no CSS
    // engine evaluates these rules here. They prove the export SHIPS the
    // declaration — unshadowed, in a known order, targeting the attribute
    // form the renderer actually emits — not that a browser applies it. A
    // real check needs a headless browser against an exported file; that is
    // a known gap. Adding a CSS parser crate for one test is not worth the
    // supply-chain and build cost.

    use crate::services::markdown::{render_markdown, sanitize_html};

    /// Collapse all whitespace, so reformatting the `format!` block above
    /// cannot fail a working export.
    fn squeeze(s: &str) -> String {
        s.chars().filter(|c| !c.is_whitespace()).collect()
    }

    /// The theme `<style>` block — deliberately the FIRST one. `build_html`
    /// emits a second `<style>` carrying the vendored KaTeX CSS whenever the
    /// body contains math.
    fn theme_style_block(html: &str) -> &str {
        let start = html.find("<style>").expect("no <style> in export") + "<style>".len();
        let rest = &html[start..];
        let end = rest.find("</style>").expect("unterminated <style>");
        &rest[..end]
    }

    /// Flat `selector { body }` pairs. Assumes no `@media` or nesting — an
    /// assumption `theme_style_block_is_a_flat_rule_list` pins rather than
    /// leaves implicit.
    fn rules(css: &str) -> Vec<(String, String)> {
        css.split('}')
            .filter_map(|chunk| chunk.split_once('{'))
            .map(|(sel, body)| (sel.to_string(), body.to_string()))
            .collect()
    }

    /// The `text-align` a rule body actually applies — the **last** declaration,
    /// since a later duplicate inside the same block wins. Reading the first
    /// would report `center` for `{ text-align: center; text-align: left; }`,
    /// which is the same last-one-wins law the ordering test enforces across
    /// rules, so it must not be broken within one.
    fn declared_text_align(body: &str) -> Option<String> {
        let squeezed = squeeze(body);
        let at = squeezed.rfind("text-align:")?;
        let after = &squeezed[at + "text-align:".len()..];
        Some(after.split(';').next().unwrap_or("").to_string())
    }

    /// True when some rule whose selector list contains **exactly** `selector`
    /// applies `text-align: value`. Whole-selector comparison, not substring:
    /// a hypothetical `.no-align td[align="center"]` must not satisfy a query
    /// for `td[align="center"]`.
    fn resolves(css: &str, selector: &str, value: &str) -> bool {
        let want_sel = squeeze(selector);
        rules(css).iter().any(|(sel, body)| {
            sel.split(',').any(|s| squeeze(s) == want_sel)
                && declared_text_align(body).as_deref() == Some(value)
        })
    }

    #[test]
    fn theme_style_block_is_a_flat_rule_list() {
        // `rules()` splits on `}` and cannot see nesting. If a future edit
        // adds `@media print { th, td { … } }`, that split would silently
        // yield plausible-looking garbage pairs instead of failing loudly.
        let html = build_html("<p>x</p>", "doc", "light");
        assert!(
            !theme_style_block(&html).contains('@'),
            "theme block must stay a flat rule list — the helpers assume no @media/nesting"
        );
    }

    #[test]
    fn resolves_helper_can_return_false() {
        // The alignment assertions below all rest on `resolves`. A predicate
        // that over-returns true (say `||` where `&&` was meant) would satisfy
        // every one of them while proving nothing, so give it negative
        // controls — this is Unit B's substitute for a RED.
        let html = build_html("<p>x</p>", "doc", "light");
        let block = theme_style_block(&html);
        assert!(
            resolves(block, "td[align=\"center\"]", "center"),
            "positive control"
        );
        assert!(
            !resolves(block, "td[align=\"center\"]", "justify"),
            "a wrong value must not resolve"
        );
        assert!(
            !resolves(block, "zz[align=\"center\"]", "center"),
            "an unknown selector must not resolve"
        );
        assert!(
            !resolves(block, "align=\"center\"", "center"),
            "a partial selector must not resolve — comparison is whole-selector"
        );
    }

    #[test]
    fn export_stylesheet_declares_cell_alignment() {
        let html = build_html("<p>x</p>", "doc", "light");
        let block = theme_style_block(&html);
        for tag in ["th", "td"] {
            for dir in ["center", "right"] {
                let sel = format!("{tag}[align=\"{dir}\"]");
                assert!(
                    resolves(block, &sel, dir),
                    "export CSS must resolve {sel} to {dir}"
                );
            }
            assert!(
                resolves(block, tag, "left"),
                "{tag} must keep its left default, so alignment is an override"
            );
        }
        // No [align="left"] rule exists; left cells fall through to the
        // default above. Pinned so the rule set stays known.
        assert!(!resolves(block, "td[align=\"left\"]", "left"));
    }

    #[test]
    fn text_align_rules_are_ordered_and_unshadowed() {
        // Existence is not enough — a later rule of equal specificity wins.
        // Appending `.markdown-body th, .markdown-body td { text-align: left; }`
        // (`.markdown-body` is the wrapper class this very function emits, so
        // that selector ties at (0,1,1) and comes later) would leave every
        // other assertion here green while rendering every exported table
        // left-aligned in a real browser.
        //
        // Pin EVERY text-align rule in the block, with no filter on the
        // selector. An earlier version filtered for selectors starting with
        // `th`/`td`, which silently excluded the very mutation named above:
        // `squeeze` strips the descendant combinator, so `.markdown-body th`
        // becomes `.markdown-bodyth` and was filtered out. Matching on a
        // whitespace-squeezed selector cannot distinguish a descendant
        // selector from a single long class name, so do not reintroduce it.
        // The block is small and wholly emitted by this function: a new
        // text-align rule SHOULD force a deliberate review of this list.
        let html = build_html("<p>x</p>", "doc", "light");
        let block = theme_style_block(&html);
        let text_align_rules: Vec<String> = rules(block)
            .iter()
            .filter_map(|(sel, body)| {
                declared_text_align(body).map(|v| format!("{} => {}", squeeze(sel), v))
            })
            .collect();

        assert_eq!(
            text_align_rules,
            vec![
                "th,td => left".to_string(),
                "th[align=\"center\"],td[align=\"center\"] => center".to_string(),
                "th[align=\"right\"],td[align=\"right\"] => right".to_string(),
            ],
            "the ordered set of text-align rules changed — a later rule may now shadow an earlier one"
        );
    }

    #[test]
    fn katex_block_does_not_disturb_theme_block_extraction() {
        // `theme_style_block` takes the first <style>. Prove that choice is
        // stable when the second (KaTeX) block is present.
        let plain = build_html("<p>x</p>", "doc", "light");
        let mathy = build_html("<div class=\"math-display\">x</div>", "doc", "light");
        assert!(
            mathy.contains(".katex"),
            "fixture must actually trigger the KaTeX block"
        );
        assert_eq!(
            theme_style_block(&plain),
            theme_style_block(&mathy),
            "the KaTeX block must not change which stylesheet the helper extracts"
        );
    }

    #[test]
    fn exported_document_ships_cells_the_stylesheet_can_match() {
        // Cross-surface agreement over the ACTUAL export path: export_html
        // runs build_html(sanitize_html(render_markdown(md))). Asserting on
        // the raw render alone would miss a sanitizer policy change that drops
        // `align` from td/th — which orphans every rule above while leaving
        // the stylesheet assertions green. Asserting on the returned document
        // (not just the fragment) also kills a `build_html` that escapes or
        // ignores its content.
        //
        // Distinct from markdown.rs's alignment tests, which prove the renderer
        // emits the attribute and that ammonia keeps it. This proves the
        // renderer's attribute form and the TEMPLATE'S SELECTORS still agree in
        // the shipped document. Do not delete either as redundant.
        let md = "| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n";
        let html = build_html(&sanitize_html(&render_markdown(md)), "doc", "light");
        let block = theme_style_block(&html);

        for (tag, dir) in [
            ("th", "center"),
            ("td", "center"),
            ("th", "right"),
            ("td", "right"),
        ] {
            let cell = format!("<{tag} align=\"{dir}\">");
            assert!(
                html.contains(&cell),
                "exported document must ship {cell}, got: {html}"
            );
            assert!(
                resolves(block, &format!("{tag}[align=\"{dir}\"]"), dir),
                "stylesheet must target the attribute form the renderer emitted: {tag}/{dir}"
            );
        }
    }
}
