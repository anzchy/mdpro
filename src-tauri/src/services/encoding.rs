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
    let mut u16s = Vec::with_capacity(bytes.len() / 2);
    let mut iter = bytes.iter();
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
