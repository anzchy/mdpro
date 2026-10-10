pub fn detect_encoding(bytes: &[u8]) -> String {
    if std::str::from_utf8(bytes).is_ok() {
        return "UTF-8".to_string();
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return "UTF-16LE".to_string();
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return "UTF-16BE".to_string();
    }
    if bytes.iter().all(|b| *b < 0x80) {
        return "ASCII".to_string();
    }
    "unknown".to_string()
}

pub fn decode_bytes(bytes: &[u8], encoding: &str) -> Result<String, String> {
    match encoding.to_uppercase().as_str() {
        "UTF-8" => std::str::from_utf8(bytes)
            .map(|s| s.to_string())
            .map_err(|err| err.to_string()),
        "ASCII" => {
            if bytes.iter().all(|b| *b < 0x80) {
                Ok(bytes.iter().map(|b| *b as char).collect())
            } else {
                Err("Invalid ASCII content".to_string())
            }
        }
        "UTF-16LE" => decode_utf16(bytes, true),
        "UTF-16BE" => decode_utf16(bytes, false),
        _ => Err("Unsupported encoding".to_string()),
    }
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> Result<String, String> {
    if bytes.len() < 2 {
        return Ok(String::new());
    }
    // Strip a BOM only when it matches the endianness we were asked to decode;
    // anything else is passed through untouched.
    let has_bom = (little_endian && bytes.starts_with(&[0xFF, 0xFE]))
        || (!little_endian && bytes.starts_with(&[0xFE, 0xFF]));
    let trimmed = if has_bom { &bytes[2..] } else { bytes };

    // Reject an odd-length payload loudly. The pair-iterator would otherwise
    // silently drop the lone trailing byte, corrupting the content (and on
    // save, persisting the corruption). A real UTF-16 file always has an even
    // number of bytes after the BOM.
    if trimmed.len() % 2 != 0 {
        return Err(format!(
            "invalid UTF-16: payload has an odd byte length ({})",
            trimmed.len()
        ));
    }

    let mut u16s = Vec::with_capacity(trimmed.len() / 2);
    let mut iter = trimmed.iter();
    while let (Some(lo), Some(hi)) = (iter.next(), iter.next()) {
        let value = if little_endian {
            u16::from_le_bytes([*lo, *hi])
        } else {
            u16::from_be_bytes([*lo, *hi])
        };
        u16s.push(value);
    }
    String::from_utf16(&u16s).map_err(|err| err.to_string())
}

/// Why a hinted UTF-16 decode was refused (D52, ADR-0057 decision 3). The
/// `as_str` form is the `reason` in the `file.open.encoding_refused` log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HintRefusal {
    /// The decoded text has a U+0000 code unit: binary data or a misread.
    NulCodeUnit,
    /// The decoded text has no ASCII-range code unit (U+0001..=U+007F).
    NoAsciiCodeUnit,
}

impl HintRefusal {
    pub fn as_str(self) -> &'static str {
        match self {
            HintRefusal::NulCodeUnit => "nul-code-unit",
            HintRefusal::NoAsciiCodeUnit => "no-ascii-code-unit",
        }
    }
}

/// The plausibility rule for a UTF-16 decode the user picked in the encoding
/// dialog (D52, ADR-0057 decision 3), applied after `decode_bytes` succeeded
/// (so the payload was even-length with no unpaired surrogate).
///
/// A BOM-less UTF-16LE/BE decode is plausible iff the text contains at least
/// one code unit in U+0001..=U+007F and no U+0000:
/// - Legacy 8-bit/CJK data (GBK, Big5, Shift-JIS, Windows-1252) has no 0x00
///   byte, so every unit it yields is >= 0x0100. Real Markdown has newlines,
///   spaces or `#`.
/// - A wrong-endian read of real UTF-16 turns `0A 00` into U+0A00 and `61 00`
///   into U+6100, which are not ASCII-range either.
/// - U+0000 never occurs in a text document. It means binary data or a misread.
///
/// Returns `None` (plausible, or not a UTF-16 hint) or the reason to refuse.
/// UTF-8 and ASCII decodes are strict already and are never refused here. A
/// payload that starts with the hint's own BOM is accepted: the BOM is the
/// evidence.
///
/// Known limits: genuine BOM-less UTF-16 text with no ASCII-range character
/// at all (one line of pure CJK, no newline) is refused. A wrong-endian read
/// can pass when the text has a code point of the form U+XX00 whose swap is
/// ASCII-range (e.g. 一 U+4E00 read swapped is `N`).
pub fn hinted_decode_refusal(bytes: &[u8], encoding: &str, decoded: &str) -> Option<HintRefusal> {
    let bom: &[u8] = match encoding.to_uppercase().as_str() {
        "UTF-16LE" => &[0xFF, 0xFE],
        "UTF-16BE" => &[0xFE, 0xFF],
        _ => return None,
    };
    if bytes.starts_with(bom) {
        return None;
    }
    if decoded.contains('\0') {
        return Some(HintRefusal::NulCodeUnit);
    }
    if !decoded.chars().any(|c| c.is_ascii()) {
        return Some(HintRefusal::NoAsciiCodeUnit);
    }
    None
}

/// Confidence of an encoding detection. Used to decide whether to trust the
/// detected encoding for a lossless save round-trip (WI-0.3). We deliberately
/// do NOT add a blind Latin-1 decode — a low-confidence non-UTF-8/-16 file is
/// surfaced as an error rather than silently mangled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetectionConfidence {
    /// A BOM was present, or the bytes are unambiguously valid in the encoding.
    High,
    /// Heuristic match (e.g. all-ASCII could be many encodings).
    Medium,
    /// Could not confidently decode (non-UTF-8 with no BOM).
    Low,
}

/// Detect the encoding together with a confidence level.
///
/// Order matters: a UTF-16 BOM is checked before the UTF-8 validity probe so a
/// BOM-prefixed file is never mis-reported as UTF-8. (The plain
/// `detect_encoding` keeps its legacy order for backward compatibility; new
/// callers that need a safe save round-trip should use this function.)
pub fn detect_encoding_with_confidence(bytes: &[u8]) -> (String, DetectionConfidence) {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return ("UTF-16LE".to_string(), DetectionConfidence::High);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return ("UTF-16BE".to_string(), DetectionConfidence::High);
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return ("UTF-8".to_string(), DetectionConfidence::High);
    }
    if bytes.is_empty() {
        return ("UTF-8".to_string(), DetectionConfidence::High);
    }
    // BOM-less UTF-16 heuristic (SHOULD-FIX): a UTF-16 file with ASCII-range
    // text has a NUL in every other byte (LE: NUL in odd positions; BE: even).
    // Such bytes are *also* valid UTF-8 (NUL is a valid code point), so without
    // this check they'd be mis-detected as UTF-8 and decoded into a string full
    // of NULs. We only act on a STRONG signal — an even-length payload where
    // (near) every other byte is NUL and the NULs are confined to one parity —
    // to avoid misrouting a legitimate UTF-8 file that merely contains a stray
    // NUL. Confidence is Medium (heuristic, no BOM), never High.
    if let Some(enc) = detect_bomless_utf16(bytes) {
        return (enc.to_string(), DetectionConfidence::Medium);
    }

    if std::str::from_utf8(bytes).is_ok() {
        // Valid UTF-8. All-ASCII is ambiguous (Medium); any multi-byte
        // sequence is a strong UTF-8 signal (High).
        if bytes.iter().all(|b| *b < 0x80) {
            return ("UTF-8".to_string(), DetectionConfidence::Medium);
        }
        return ("UTF-8".to_string(), DetectionConfidence::High);
    }
    // Not valid UTF-8 and no recognised BOM. We refuse to guess (no blind
    // Latin-1) — the caller must surface this rather than corrupt the content.
    ("unknown".to_string(), DetectionConfidence::Low)
}

/// Detect BOM-less UTF-16 from a strong alternating-NUL pattern.
///
/// Returns `Some("UTF-16LE")` / `Some("UTF-16BE")` only when the payload is
/// even-length, non-trivial, and (near) every byte in exactly one parity is
/// NUL while the other parity has essentially none. This deliberately ignores
/// weak signals (a lone NUL in a UTF-8 file) so it won't misroute legitimate
/// UTF-8.
fn detect_bomless_utf16(bytes: &[u8]) -> Option<&'static str> {
    // Need a few code units to be confident; ignore tiny/odd payloads.
    if bytes.len() < 8 || !bytes.len().is_multiple_of(2) {
        return None;
    }
    let mut even_nul = 0usize; // NUL at positions 0,2,4,… (BE high byte)
    let mut odd_nul = 0usize; // NUL at positions 1,3,5,… (LE high byte)
    let pairs = bytes.len() / 2;
    for (i, b) in bytes.iter().enumerate() {
        if *b == 0 {
            if i % 2 == 0 {
                even_nul += 1;
            } else {
                odd_nul += 1;
            }
        }
    }
    // Require ~all of one parity to be NUL and ~none of the other. Allow a tiny
    // slack for the occasional non-ASCII unit.
    let strong = pairs - pairs / 8; // 87.5% threshold
    let weak = pairs / 8;
    if odd_nul >= strong && even_nul <= weak {
        Some("UTF-16LE")
    } else if even_nul >= strong && odd_nul <= weak {
        Some("UTF-16BE")
    } else {
        None
    }
}

/// Encode a string back into bytes in the given encoding, preserving the BOM
/// for UTF-16 so the saved file round-trips byte-for-byte with the original
/// (WI-0.3 — save back in the original encoding, no silent conversion).
///
/// Returns an error for encodings we cannot safely round-trip, so the caller
/// surfaces a save failure instead of writing corrupt bytes.
pub fn encode_bytes(content: &str, encoding: &str) -> Result<Vec<u8>, String> {
    match encoding.to_uppercase().as_str() {
        "UTF-8" | "ASCII" => Ok(content.as_bytes().to_vec()),
        "UTF-16LE" => Ok(encode_utf16(content, true)),
        "UTF-16BE" => Ok(encode_utf16(content, false)),
        other => Err(format!(
            "cannot re-encode to {other}; refusing to corrupt content"
        )),
    }
}

fn encode_utf16(content: &str, little_endian: bool) -> Vec<u8> {
    // Emit the BOM so the file is self-describing and round-trips with
    // decode_bytes (which strips a leading BOM).
    let mut out = Vec::with_capacity(content.len() * 2 + 2);
    if little_endian {
        out.extend_from_slice(&[0xFF, 0xFE]);
    } else {
        out.extend_from_slice(&[0xFE, 0xFF]);
    }
    for unit in content.encode_utf16() {
        let pair = if little_endian {
            unit.to_le_bytes()
        } else {
            unit.to_be_bytes()
        };
        out.extend_from_slice(&pair);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- detect_encoding (legacy) ---

    #[test]
    fn test_detect_utf8_for_ascii_valid_utf8() {
        assert_eq!(detect_encoding(b"hello"), "UTF-8");
    }

    #[test]
    fn test_detect_utf16le_bom() {
        // BOM-only input is not valid UTF-8 (0xFF is not), so the legacy
        // detector reaches the BOM check.
        let bytes = [0xFF, 0xFE, b'h', 0x00];
        assert_eq!(detect_encoding(&bytes), "UTF-16LE");
    }

    // --- detect_encoding_with_confidence ---

    #[test]
    fn test_confidence_utf16le_bom_is_high() {
        let bytes = [0xFF, 0xFE, b'h', 0x00];
        let (enc, conf) = detect_encoding_with_confidence(&bytes);
        assert_eq!(enc, "UTF-16LE");
        assert_eq!(conf, DetectionConfidence::High);
    }

    #[test]
    fn test_confidence_utf16be_bom_is_high() {
        let bytes = [0xFE, 0xFF, 0x00, b'h'];
        let (enc, conf) = detect_encoding_with_confidence(&bytes);
        assert_eq!(enc, "UTF-16BE");
        assert_eq!(conf, DetectionConfidence::High);
    }

    #[test]
    fn test_confidence_multibyte_utf8_is_high() {
        let (enc, conf) = detect_encoding_with_confidence("héllo café ☕".as_bytes());
        assert_eq!(enc, "UTF-8");
        assert_eq!(conf, DetectionConfidence::High);
    }

    #[test]
    fn test_confidence_pure_ascii_is_medium() {
        let (enc, conf) = detect_encoding_with_confidence(b"plain ascii");
        assert_eq!(enc, "UTF-8");
        assert_eq!(conf, DetectionConfidence::Medium);
    }

    #[test]
    fn test_confidence_non_utf8_no_bom_is_low_and_unknown() {
        // A lone 0xFF in the middle (no BOM) — invalid UTF-8, no recognised
        // encoding. We must NOT guess Latin-1; surface Low/unknown.
        let bytes = [b'a', 0xFF, b'b'];
        let (enc, conf) = detect_encoding_with_confidence(&bytes);
        assert_eq!(enc, "unknown");
        assert_eq!(conf, DetectionConfidence::Low);
    }

    // --- SHOULD-FIX: BOM-less UTF-16 heuristic (act on the confidence) ---

    #[test]
    fn test_bomless_utf16le_detected_and_decodes() {
        // "hello world" as UTF-16LE, no BOM. Without the heuristic this is
        // valid UTF-8 (NUL-interspersed ASCII) and would decode to a
        // NUL-riddled string.
        let mut bytes = Vec::new();
        for u in "hello world".encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        let (enc, conf) = detect_encoding_with_confidence(&bytes);
        assert_eq!(enc, "UTF-16LE", "BOM-less UTF-16LE must be detected");
        assert_eq!(conf, DetectionConfidence::Medium);
        assert_eq!(decode_bytes(&bytes, &enc).unwrap(), "hello world");
    }

    #[test]
    fn test_bomless_utf16be_detected() {
        let mut bytes = Vec::new();
        for u in "greetings".encode_utf16() {
            bytes.extend_from_slice(&u.to_be_bytes());
        }
        let (enc, _) = detect_encoding_with_confidence(&bytes);
        assert_eq!(enc, "UTF-16BE", "BOM-less UTF-16BE must be detected");
    }

    #[test]
    fn test_utf8_with_a_stray_nul_is_not_misrouted_to_utf16() {
        // A legitimate UTF-8 document with a single embedded NUL must NOT be
        // treated as UTF-16 (the weak-signal guard).
        let mut bytes = b"this is a normal ascii markdown document".to_vec();
        bytes.push(0);
        bytes.extend_from_slice(b"and it continues here too");
        let (enc, _) = detect_encoding_with_confidence(&bytes);
        assert_eq!(
            enc, "UTF-8",
            "a stray NUL must not trigger UTF-16 detection"
        );
    }

    #[test]
    fn test_pure_ascii_is_not_misrouted_to_utf16() {
        let (enc, _) = detect_encoding_with_confidence(b"plain ascii content here");
        assert_eq!(enc, "UTF-8");
    }

    // --- Fix 3: odd-length UTF-16 must be rejected, not silently truncated ---

    #[test]
    fn test_decode_utf16le_rejects_odd_length_payload() {
        // BOM + 3 trailing bytes = odd UTF-16 payload (1.5 code units). The old
        // pair-iterator silently dropped the lone byte, corrupting the content.
        let bytes = [0xFF, 0xFE, b'h', 0x00, b'i'];
        let result = decode_bytes(&bytes, "UTF-16LE");
        assert!(
            result.is_err(),
            "odd-length UTF-16LE must be rejected, got: {result:?}"
        );
    }

    #[test]
    fn test_decode_utf16be_rejects_odd_length_payload() {
        let bytes = [0xFE, 0xFF, 0x00, b'h', 0x00];
        let result = decode_bytes(&bytes, "UTF-16BE");
        assert!(
            result.is_err(),
            "odd-length UTF-16BE must be rejected, got: {result:?}"
        );
    }

    #[test]
    fn test_decode_utf16_accepts_even_length_payload() {
        // Sanity: a well-formed even payload still decodes.
        let bytes = [0xFF, 0xFE, b'h', 0x00, b'i', 0x00];
        assert_eq!(decode_bytes(&bytes, "UTF-16LE").unwrap(), "hi");
    }

    #[test]
    fn test_no_blind_latin1_decode_for_low_confidence() {
        // decode_bytes must reject the unknown encoding rather than silently
        // succeeding (the Latin-1 trap: every byte "decodes").
        let bytes = [b'a', 0xFF, b'b'];
        let (enc, _) = detect_encoding_with_confidence(&bytes);
        assert!(decode_bytes(&bytes, &enc).is_err());
    }

    // --- save round-trip: decode → encode is lossless ---

    #[test]
    fn test_utf16le_decode_encode_round_trip_is_byte_identical() {
        // Build a real UTF-16LE-with-BOM file, decode it, re-encode it, and
        // assert the bytes match — i.e. saving a UTF-16 file keeps it UTF-16,
        // no silent UTF-8 conversion.
        let original = encode_utf16("Hello, 世界!\nLine 2", true);
        let decoded = decode_bytes(&original, "UTF-16LE").expect("decode");
        let re_encoded = encode_bytes(&decoded, "UTF-16LE").expect("encode");
        assert_eq!(re_encoded, original, "UTF-16LE round-trip must be lossless");
    }

    #[test]
    fn test_utf16be_decode_encode_round_trip_is_byte_identical() {
        let original = encode_utf16("Ωmega ✓", false);
        let decoded = decode_bytes(&original, "UTF-16BE").expect("decode");
        let re_encoded = encode_bytes(&decoded, "UTF-16BE").expect("encode");
        assert_eq!(re_encoded, original, "UTF-16BE round-trip must be lossless");
    }

    #[test]
    fn test_utf8_round_trip_preserves_crlf() {
        // A CRLF document re-encoded as UTF-8 must keep its CRLFs. (Line-ending
        // normalization is a separate, explicit step in file.rs — the encoder
        // itself must never touch them.)
        let content = "line one\r\nline two\r\n";
        let bytes = encode_bytes(content, "UTF-8").expect("encode");
        assert_eq!(bytes, content.as_bytes());
        assert!(
            bytes.windows(2).any(|w| w == b"\r\n"),
            "CRLF must survive encode"
        );
    }

    #[test]
    fn test_utf16_round_trip_preserves_crlf() {
        let content = "a\r\nb\r\nc";
        let bytes = encode_bytes(content, "UTF-16LE").expect("encode");
        let decoded = decode_bytes(&bytes, "UTF-16LE").expect("decode");
        assert_eq!(decoded, content, "CRLF must survive UTF-16 round-trip");
    }

    #[test]
    fn test_encode_rejects_unsupported_encoding() {
        // Refuse to silently mangle — e.g. a GBK document must not be written
        // out as UTF-8 bytes pretending to be GBK.
        let result = encode_bytes("内容", "GBK");
        assert!(
            result.is_err(),
            "unsupported encoding must error, not corrupt"
        );
    }

    #[test]
    fn test_ascii_encodes_as_utf8_bytes() {
        assert_eq!(encode_bytes("abc", "ASCII").unwrap(), b"abc".to_vec());
    }
}
