use std::io::{BufRead, Write};

pub const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

pub fn read_frame(reader: &mut impl BufRead) -> std::io::Result<Option<serde_json::Value>> {
    let mut buffer = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if buffer.is_empty() {
                Ok(None)
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "incomplete sidecar frame",
                ))
            };
        }
        let delimiter = available.iter().position(|byte| *byte == b'\n');
        let length = delimiter.map_or(available.len(), |index| index + 1);
        if buffer.len().saturating_add(length) > MAX_FRAME_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "sidecar frame exceeds limit",
            ));
        }
        buffer.extend_from_slice(&available[..length]);
        reader.consume(length);
        if delimiter.is_some() {
            return serde_json::from_slice(&buffer)
                .map(Some)
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error));
        }
    }
}

pub fn write_frame(writer: &mut impl Write, value: &serde_json::Value) -> std::io::Result<()> {
    let buffer = serde_json::to_vec(value)?;
    if buffer.len().saturating_add(1) > MAX_FRAME_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "sidecar frame exceeds limit",
        ));
    }
    writer.write_all(&buffer)?;
    writer.write_all(b"\n")?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufReader, Cursor};

    #[test]
    fn accepts_fragmented_frames_and_preserves_escaped_newlines() {
        let value = serde_json::json!({"message":"a\nb", "id":42});
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &value).unwrap();
        write_frame(&mut bytes, &serde_json::json!({"id":43})).unwrap();
        let mut reader = BufReader::with_capacity(3, Cursor::new(bytes));
        assert_eq!(read_frame(&mut reader).unwrap(), Some(value));
        assert_eq!(
            read_frame(&mut reader).unwrap(),
            Some(serde_json::json!({"id":43}))
        );
        assert_eq!(read_frame(&mut reader).unwrap(), None);
    }

    #[test]
    fn rejects_truncated_and_non_json_output() {
        assert_eq!(
            read_frame(&mut Cursor::new(b"{\"id\":1}"))
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::UnexpectedEof
        );
        assert_eq!(
            read_frame(&mut Cursor::new(b"debug output\n"))
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn rejects_oversized_unterminated_frames_before_parsing() {
        let mut reader = Cursor::new(vec![b' '; MAX_FRAME_BYTES + 1]);
        let error = read_frame(&mut reader).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert_eq!(error.to_string(), "sidecar frame exceeds limit");
    }
}
