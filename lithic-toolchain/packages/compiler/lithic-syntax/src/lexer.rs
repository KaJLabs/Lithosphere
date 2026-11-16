//! A tolerant lexer for Lithic source.
//!
//! It never fails: unrecognised characters become `TokenKind::Other` so that
//! callers (e.g. the brace-balancing body capture in the parser) keep working
//! even on constructs the declaration parser does not yet understand.

use crate::token::{Token, TokenKind};

pub fn lex(src: &str) -> Vec<Token> {
    let chars: Vec<(usize, char)> = src.char_indices().collect();
    let n = chars.len();
    let byte_at = |idx: usize| -> usize {
        if idx < n {
            chars[idx].0
        } else {
            src.len()
        }
    };

    let mut out: Vec<Token> = Vec::new();
    let mut i = 0usize;

    while i < n {
        let (off, c) = chars[i];

        // Whitespace.
        if c.is_whitespace() {
            i += 1;
            continue;
        }

        // Line comment `// ...`.
        if c == '/' && i + 1 < n && chars[i + 1].1 == '/' {
            i += 2;
            while i < n && chars[i].1 != '\n' {
                i += 1;
            }
            continue;
        }

        // Byte string `b"..."`.
        if c == 'b' && i + 1 < n && chars[i + 1].1 == '"' {
            let lo = off;
            i += 2; // skip `b` and opening quote
            while i < n && chars[i].1 != '"' {
                if chars[i].1 == '\\' {
                    i += 1;
                }
                i += 1;
            }
            if i < n {
                i += 1; // closing quote
            }
            out.push(Token {
                kind: TokenKind::ByteStr,
                lo,
                hi: byte_at(i),
            });
            continue;
        }

        // String `"..."`.
        if c == '"' {
            let lo = off;
            i += 1;
            while i < n && chars[i].1 != '"' {
                if chars[i].1 == '\\' {
                    i += 1;
                }
                i += 1;
            }
            if i < n {
                i += 1; // closing quote
            }
            out.push(Token {
                kind: TokenKind::Str,
                lo,
                hi: byte_at(i),
            });
            continue;
        }

        // Identifier or keyword.
        if c.is_alphabetic() || c == '_' {
            let lo = off;
            i += 1;
            while i < n && (chars[i].1.is_alphanumeric() || chars[i].1 == '_') {
                i += 1;
            }
            let hi = byte_at(i);
            let kind = match &src[lo..hi] {
                "contract" => TokenKind::Contract,
                "const" => TokenKind::Const,
                "state" => TokenKind::State,
                "event" => TokenKind::Event,
                "pub" => TokenKind::Pub,
                "fn" => TokenKind::Fn,
                "async" => TokenKind::Async,
                _ => TokenKind::Ident,
            };
            out.push(Token { kind, lo, hi });
            continue;
        }

        // Number (integer or float).
        if c.is_ascii_digit() {
            let lo = off;
            i += 1;
            let mut is_float = false;
            while i < n {
                let ch = chars[i].1;
                if ch.is_ascii_digit() {
                    i += 1;
                } else if ch == '.' && i + 1 < n && chars[i + 1].1.is_ascii_digit() {
                    is_float = true;
                    i += 1;
                } else {
                    break;
                }
            }
            let kind = if is_float {
                TokenKind::Float
            } else {
                TokenKind::Int
            };
            out.push(Token {
                kind,
                lo,
                hi: byte_at(i),
            });
            continue;
        }

        // Arrow `->`.
        if c == '-' && i + 1 < n && chars[i + 1].1 == '>' {
            out.push(Token {
                kind: TokenKind::Arrow,
                lo: off,
                hi: byte_at(i + 2),
            });
            i += 2;
            continue;
        }

        // Single-character punctuation. Note: `>` is always emitted on its own
        // (never combined into `>>`) so nested generics like `map<.., map<..>>`
        // parse as two close-angle tokens.
        let kind = match c {
            '@' => TokenKind::At,
            '{' => TokenKind::LBrace,
            '}' => TokenKind::RBrace,
            '(' => TokenKind::LParen,
            ')' => TokenKind::RParen,
            '[' => TokenKind::LBracket,
            ']' => TokenKind::RBracket,
            '<' => TokenKind::Lt,
            '>' => TokenKind::Gt,
            ',' => TokenKind::Comma,
            ';' => TokenKind::Semi,
            ':' => TokenKind::Colon,
            '=' => TokenKind::Eq,
            _ => TokenKind::Other,
        };
        out.push(Token {
            kind,
            lo: off,
            hi: byte_at(i + 1),
        });
        i += 1;
    }

    out.push(Token {
        kind: TokenKind::Eof,
        lo: src.len(),
        hi: src.len(),
    });
    out
}
