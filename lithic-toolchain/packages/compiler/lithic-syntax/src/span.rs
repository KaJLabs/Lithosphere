//! Source position helpers.

/// Convert a byte offset into a 1-based (line, column) pair.
pub fn line_col(src: &str, byte_off: usize) -> (usize, usize) {
    let off = byte_off.min(src.len());
    let mut line = 1usize;
    let mut col = 1usize;
    for (i, ch) in src.char_indices() {
        if i >= off {
            break;
        }
        if ch == '\n' {
            line += 1;
            col = 1;
        } else {
            col += 1;
        }
    }
    (line, col)
}
