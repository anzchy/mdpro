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
    let trimmed = if little_endian && bytes.starts_with(&[0xFF, 0xFE]) {
        &bytes[2..]
    } else if !little_endian && bytes.starts_with(&[0xFE, 0xFF]) {
        &bytes[2..]
    } else {
        bytes
    };

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
        assert!(bytes.windows(2).any(|w| w == b"\r\n"), "CRLF must survive encode");
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
        assert!(result.is_err(), "unsupported encoding must error, not corrupt");
    }

    #[test]
    fn test_ascii_encodes_as_utf8_bytes() {
        assert_eq!(encode_bytes("abc", "ASCII").unwrap(), b"abc".to_vec());
    }
}
