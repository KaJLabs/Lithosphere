//! Token definitions for the Lithic lexer.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenKind {
    // Keywords that matter for declaration-level parsing.
    Contract,
    Const,
    State,
    Event,
    Pub,
    Fn,
    Async,

    // Identifiers and literals.
    Ident,
    Int,
    Float,
    Str,
    ByteStr,

    // Punctuation.
    At,
    LBrace,
    RBrace,
    LParen,
    RParen,
    LBracket,
    RBracket,
    Lt,
    Gt,
    Comma,
    Semi,
    Colon,
    Arrow,
    Eq,

    /// Any other single character (operators inside opaque bodies, etc.).
    Other,
    Eof,
}

/// A lexical token, identified by byte offsets into the source string.
#[derive(Clone, Copy, Debug)]
pub struct Token {
    pub kind: TokenKind,
    pub lo: usize,
    pub hi: usize,
}
