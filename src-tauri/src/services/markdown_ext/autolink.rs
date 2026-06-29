//! WI-1.4 — Auto-link bare URLs + emoji shortcodes.
//!
//! pulldown-cmark 0.11 has no bare-URL autolink option (ENABLE_GFM only covers
//! blockquote alert tags). We preprocess the markdown source: a bare
//! `http(s)://…` URL is wrapped in CommonMark autolink angle brackets so the
//! parser linkifies it, and known `:shortcode:` emoji are replaced with their
//! glyph. Both transforms skip fenced/indented code blocks and inline code
//! spans (a URL or `:smile:` inside code stays literal), and the URL pass also
//! skips URLs already inside a markdown link target `](…)` or already wrapped
//! in `<…>`.

/// Curated emoji shortcode → glyph map. Conservative on purpose: an unknown
/// `:shortcode:` is left literal (never destructive). Covers the common set a
/// technical writer reaches for; extend as needed.
fn emoji_glyph(name: &str) -> Option<&'static str> {
    Some(match name {
        "smile" => "😄",
        "grin" => "😁",
        "joy" => "😂",
        "wink" => "😉",
        "heart" => "❤️",
        "thumbsup" | "+1" => "👍",
        "thumbsdown" | "-1" => "👎",
        "tada" => "🎉",
        "rocket" => "🚀",
        "fire" => "🔥",
        "star" => "⭐",
        "warning" => "⚠️",
        "check" | "white_check_mark" => "✅",
        "x" => "❌",
        "bulb" => "💡",
        "eyes" => "👀",
        "sparkles" => "✨",
        "100" => "💯",
        "pray" => "🙏",
        "ok_hand" => "👌",
        _ => return None,
    })
}

/// Apply the WI-1.4 source transforms (emoji + bare-URL autolink) to a markdown
/// document, skipping code fences/indented-code and inline code spans.
pub fn preprocess_autolink_and_emoji(markdown: &str) -> String {
    let normalized = markdown.replace("\r\n", "\n");
    let mut out = String::with_capacity(normalized.len() + 32);
    let mut in_fence = false;
    let mut fence_char = ' ';
    let mut fence_len = 0usize;
    let lines: Vec<&str> = normalized.split('\n').collect();
    let line_count = lines.len();

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if in_fence {
            let close_len = trimmed.chars().take_while(|&c| c == fence_char).count();
            if close_len >= fence_len && trimmed[close_len..].trim().is_empty() {
                in_fence = false;
            }
            out.push_str(line);
        } else if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let fc = trimmed.chars().next().unwrap_or('`');
            let fl = trimmed.chars().take_while(|&c| c == fc).count();
            if trimmed[fl..].trim().find(fc).is_none() {
                in_fence = true;
                fence_char = fc;
                fence_len = fl;
            }
            out.push_str(line);
        } else {
            let indent_len = line.len() - trimmed.len();
            if line.starts_with('\t') || indent_len >= 4 {
                // Indented code block: leave untouched.
                out.push_str(line);
            } else {
                out.push_str(&transform_line(line));
            }
        }
        if idx + 1 < line_count {
            out.push('\n');
        }
    }
    if normalized.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// Transform a single non-code line: emoji then bare-URL autolink, skipping
/// inline code spans.
fn transform_line(line: &str) -> String {
    let bytes = line.as_bytes();
    let n = bytes.len();
    let mut out = String::with_capacity(n);
    let mut i = 0;
    while i < n {
        // Copy inline code spans verbatim.
        if bytes[i] == b'`' {
            let start = i;
            while i < n && bytes[i] == b'`' {
                i += 1;
            }
            let tick_len = i - start;
            let close: Vec<u8> = vec![b'`'; tick_len];
            if let Some(rel) = line[i..]
                .as_bytes()
                .windows(tick_len)
                .position(|w| w == close)
            {
                let end = i + rel + tick_len;
                out.push_str(&line[start..end]);
                i = end;
            } else {
                out.push_str(&line[start..i]);
            }
            continue;
        }
        // Copy an existing markdown link target `](…)` verbatim so a URL inside
        // it is not double-wrapped.
        if bytes[i] == b']' && i + 1 < n && bytes[i + 1] == b'(' {
            let start = i;
            i += 2;
            let mut depth = 1i32;
            while i < n {
                match bytes[i] {
                    b'(' => {
                        depth += 1;
                        i += 1;
                    }
                    b')' => {
                        depth -= 1;
                        i += 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    _ => i += 1,
                }
            }
            out.push_str(&line[start..i]);
            continue;
        }
        // Copy an existing `<…>` autolink verbatim.
        if bytes[i] == b'<' {
            if let Some(rel) = line[i..].find('>') {
                let end = i + rel + 1;
                out.push_str(&line[i..end]);
                i = end;
                continue;
            }
        }
        // Emoji shortcode `:name:`.
        if bytes[i] == b':' {
            if let Some((glyph, consumed)) = try_emoji(&line[i..]) {
                out.push_str(glyph);
                i += consumed;
                continue;
            }
        }
        // Bare URL `http://` / `https://`.
        if let Some(url_len) = try_bare_url(&line[i..]) {
            // Don't autolink a URL immediately preceded by `(` (likely a link
            // target the `](` guard missed) or by `@`/`/` (already in a path).
            let prev = if i == 0 { b' ' } else { bytes[i - 1] };
            if prev == b'(' || prev == b'<' {
                out.push_str(&line[i..i + url_len]);
            } else {
                out.push('<');
                out.push_str(&line[i..i + url_len]);
                out.push('>');
            }
            i += url_len;
            continue;
        }
        // UTF-8-safe advance.
        let ch = line[i..].chars().next().unwrap_or('\0');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// If `s` starts with `:name:` whose name is a known emoji, return the glyph
/// and the byte length consumed (including both colons).
fn try_emoji(s: &str) -> Option<(&'static str, usize)> {
    debug_assert!(s.starts_with(':'));
    let rest = &s[1..];
    let close = rest.find(':')?;
    let name = &rest[..close];
    // Shortcodes are short, alphanumeric + `_`/`+`/`-`. Reject empty / spaced.
    if name.is_empty()
        || name.len() > 32
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'+' || b == b'-')
    {
        return None;
    }
    let glyph = emoji_glyph(name)?;
    Some((glyph, 1 + close + 1))
}

/// If `s` starts with a bare `http://`/`https://` URL, return its byte length.
/// The URL ends at the first whitespace or a trailing-punctuation char that is
/// unlikely to belong to the URL (`)`, `]`, `<`, `>`, `"`, `'`, and a sentence
/// `.`/`,`/`!`/`?` immediately followed by end-of-string or whitespace).
fn try_bare_url(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    // Fixed-head scheme check WITHOUT lowercasing the whole remaining slice.
    // `try_bare_url` is called once per byte position in `transform_line`, so a
    // `s.to_ascii_lowercase()` here is O(N) per call → O(N²) per line (a single
    // 800K-char line froze ~9.75s). Compare only the first 7/8 bytes,
    // case-insensitively, with zero allocation.
    let is_https = bytes
        .get(..8)
        .is_some_and(|h| h.eq_ignore_ascii_case(b"https://"));
    let is_http = bytes
        .get(..7)
        .is_some_and(|h| h.eq_ignore_ascii_case(b"http://"));
    if !is_https && !is_http {
        return None;
    }
    let mut end = 0;
    while end < bytes.len() {
        let c = bytes[end];
        if c.is_ascii_whitespace() || matches!(c, b'<' | b'>' | b'"' | b'\'' | b'`' | b'|') {
            break;
        }
        end += 1;
    }
    // Trim trailing sentence punctuation and an unbalanced closing paren/bracket.
    while end > 0 {
        let last = bytes[end - 1];
        if matches!(last, b'.' | b',' | b'!' | b'?' | b';' | b':') {
            end -= 1;
        } else if last == b')' {
            // Keep a `)` only if there's a matching `(` inside the URL.
            let opens = s[..end].matches('(').count();
            let closes = s[..end].matches(')').count();
            if closes > opens {
                end -= 1;
            } else {
                break;
            }
        } else {
            break;
        }
    }
    // Must have more than just the scheme.
    let scheme_len = if is_https { 8 } else { 7 };
    if end <= scheme_len {
        return None;
    }
    Some(end)
}

#[cfg(test)]
#[path = "autolink_tests.rs"]
mod tests;
