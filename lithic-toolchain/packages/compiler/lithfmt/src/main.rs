//! `lithfmt` — the Lithic formatter.
//!
//! v0 performs *safe* whitespace normalisation only — it never rewrites code
//! structure, so it cannot corrupt a contract:
//!   * tabs outside string/byte-string literals are expanded to four spaces,
//!   * trailing whitespace outside literals is stripped from every line,
//!   * the file is terminated by exactly one newline.
//!
//! The input is parsed first; a file with parse errors is left untouched.
//! Full AST-driven formatting (canonical indentation, alignment) is a later
//! phase.

use std::process::exit;

fn print_help() {
    eprintln!(
        "lithfmt {} — Lithic formatter (v0: whitespace normalisation)\n\
\n\
USAGE:\n\
    lithfmt [OPTIONS] <FILE.lithic>\n\
\n\
OPTIONS:\n\
    --check     Do not write; exit 1 if the file is not already formatted\n\
    -h, --help  Print this help",
        env!("CARGO_PKG_VERSION")
    );
}

fn format_source(src: &str) -> String {
    // Preserve the input's line-ending convention so `--check` behaves the
    // same on Windows and Unix checkouts. Mixed endings are normalized to the
    // convention used by the first newline.
    let newline = match src.find('\n') {
        Some(index) if index > 0 && src.as_bytes()[index - 1] == b'\r' => "\r\n",
        _ => "\n",
    };
    let protected: Vec<(usize, usize)> = lithic_syntax::lexer::lex(src)
        .into_iter()
        .filter_map(|token| match token.kind {
            lithic_syntax::token::TokenKind::Str | lithic_syntax::token::TokenKind::ByteStr => {
                Some((token.lo, token.hi))
            }
            _ => None,
        })
        .collect();
    let is_protected = |position: usize| {
        let index = protected.partition_point(|(_, hi)| *hi <= position);
        matches!(protected.get(index), Some((lo, hi)) if position >= *lo && position < *hi)
    };

    let mut out = String::with_capacity(src.len());
    let mut line_start = 0usize;
    for segment in src.split_inclusive('\n') {
        let line = segment
            .strip_suffix("\r\n")
            .or_else(|| segment.strip_suffix('\n'))
            .unwrap_or(segment);
        let mut content_end = line.len();
        while content_end > 0 {
            let character = line[..content_end]
                .chars()
                .next_back()
                .expect("non-empty line prefix");
            let character_start = content_end - character.len_utf8();
            if is_protected(line_start + character_start) || !matches!(character, ' ' | '\t' | '\r')
            {
                break;
            }
            content_end = character_start;
        }

        for (offset, character) in line[..content_end].char_indices() {
            if character == '\t' && !is_protected(line_start + offset) {
                out.push_str("    ");
            } else {
                out.push(character);
            }
        }
        out.push_str(newline);
        line_start += segment.len();
    }
    // Collapse to exactly one trailing newline (handles empty input too).
    let doubled_newline = format!("{newline}{newline}");
    while out.ends_with(&doubled_newline) {
        out.truncate(out.len() - newline.len());
    }
    if out.is_empty() {
        out.push_str(newline);
    }
    out
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut path: Option<String> = None;
    let mut check = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--check" => check = true,
            "-h" | "--help" => {
                print_help();
                return;
            }
            s if !s.starts_with('-') => path = Some(s.to_string()),
            other => {
                eprintln!("lithfmt: error: unknown option '{}'", other);
                exit(2);
            }
        }
        i += 1;
    }

    let path = match path {
        Some(p) => p,
        None => {
            eprintln!("lithfmt: error: no input file given\n");
            print_help();
            exit(2);
        }
    };

    let src = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("lithfmt: error: cannot read {}: {}", path, e);
            exit(2);
        }
    };

    // Refuse to format invalid source.
    let res = lithic_syntax::parse(&src);
    if res.error_count() > 0 {
        for d in &res.diagnostics {
            eprintln!("{}", d.render(&src, &path));
        }
        eprintln!(
            "lithfmt: error: not formatting {} due to parse errors",
            path
        );
        exit(1);
    }

    let formatted = format_source(&src);

    if check {
        if formatted != src {
            eprintln!("lithfmt: {} is not formatted", path);
            exit(1);
        }
        return;
    }

    if formatted != src {
        if let Err(e) = std::fs::write(&path, formatted) {
            eprintln!("lithfmt: error: cannot write {}: {}", path, e);
            exit(2);
        }
        eprintln!("lithfmt: formatted {}", path);
    }
}

#[cfg(test)]
mod tests {
    use super::format_source;

    #[test]
    fn normalizes_only_non_literal_whitespace() {
        let source = "contract C {\n\tconst S: string = \"a\tb  \";   \n\tconst B: bytes = b\"x\ty  \";\t\n}\n\n";
        let expected = "contract C {\n    const S: string = \"a\tb  \";\n    const B: bytes = b\"x\ty  \";\n}\n";
        assert_eq!(format_source(source), expected);
    }

    #[test]
    fn preserves_multiline_literal_content() {
        let source = "contract C {\n const S: string = \"first  \n\tsecond\";  \n}\n";
        let expected = "contract C {\n const S: string = \"first  \n\tsecond\";\n}\n";
        assert_eq!(format_source(source), expected);
    }

    #[test]
    fn formatting_is_idempotent() {
        let source = "contract C {\n    fn f() {}\n}\n";
        let once = format_source(source);
        assert_eq!(format_source(&once), once);
    }

    #[test]
    fn preserves_windows_line_endings() {
        let source = "contract C {\r\n    fn f() {}\r\n}\r\n";
        assert_eq!(format_source(source), source);
    }

    #[test]
    fn normalizes_mixed_endings_to_first_convention() {
        let source = "contract C {\r\n    fn f() {}\n}\r\n";
        let expected = "contract C {\r\n    fn f() {}\r\n}\r\n";
        assert_eq!(format_source(source), expected);
    }
}
