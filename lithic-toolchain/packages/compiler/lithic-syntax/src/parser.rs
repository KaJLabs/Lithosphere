//! A recursive-descent parser for Lithic declarations.
//!
//! Function bodies are captured as raw source via balanced-brace scanning;
//! everything at declaration level (contract, const, state, event, function
//! signatures, attributes, types) is fully parsed into the AST.

use crate::ast::*;
use crate::diagnostic::Diagnostic;
use crate::lexer::lex;
use crate::token::{Token, TokenKind as K};

pub struct ParseResult {
    pub contract: Option<Contract>,
    pub diagnostics: Vec<Diagnostic>,
}

impl ParseResult {
    pub fn error_count(&self) -> usize {
        self.diagnostics.iter().filter(|d| d.is_error()).count()
    }
}

pub fn parse(src: &str) -> ParseResult {
    let toks = lex(src);
    let mut p = Parser {
        src,
        toks,
        pos: 0,
        diags: Vec::new(),
    };
    let contract = p.parse_contract();
    ParseResult {
        contract,
        diagnostics: p.diags,
    }
}

struct Parser<'a> {
    src: &'a str,
    toks: Vec<Token>,
    pos: usize,
    diags: Vec<Diagnostic>,
}

impl<'a> Parser<'a> {
    fn cur(&self) -> Token {
        self.toks[self.pos]
    }

    fn kind(&self) -> K {
        self.cur().kind
    }

    fn at(&self, k: K) -> bool {
        self.kind() == k
    }

    fn bump(&mut self) -> Token {
        let t = self.cur();
        if t.kind != K::Eof {
            self.pos += 1;
        }
        t
    }

    fn eat(&mut self, k: K) -> bool {
        if self.at(k) {
            self.bump();
            true
        } else {
            false
        }
    }

    fn text(&self, t: Token) -> String {
        self.src[t.lo..t.hi].to_string()
    }

    fn error(&mut self, msg: impl Into<String>) {
        let t = self.cur();
        self.diags.push(Diagnostic::error(msg, t.lo, t.hi));
    }

    fn expect(&mut self, k: K, msg: &str) -> Option<Token> {
        if self.at(k) {
            Some(self.bump())
        } else {
            self.error(msg);
            None
        }
    }

    fn parse_contract(&mut self) -> Option<Contract> {
        self.expect(K::Contract, "expected 'contract'")?;
        let name_tok = self.expect(K::Ident, "expected contract name")?;
        let name = self.text(name_tok);
        self.expect(K::LBrace, "expected '{' after contract name")?;

        let mut items: Vec<Item> = Vec::new();
        let mut pending_attrs: Vec<Attr> = Vec::new();

        loop {
            match self.kind() {
                K::RBrace => {
                    self.bump();
                    break;
                }
                K::Eof => {
                    self.error("unexpected end of file in contract body");
                    break;
                }
                K::At => match self.parse_attr() {
                    Some(a) => pending_attrs.push(a),
                    None => break,
                },
                K::Const => match self.parse_const() {
                    Some(c) => items.push(Item::Const(c)),
                    None => break,
                },
                K::State => match self.parse_state() {
                    Some(s) => items.push(Item::State(s)),
                    None => break,
                },
                K::Event => match self.parse_event() {
                    Some(e) => items.push(Item::Event(e)),
                    None => break,
                },
                K::Pub | K::Async | K::Fn => {
                    let attrs = std::mem::take(&mut pending_attrs);
                    match self.parse_func(attrs) {
                        Some(f) => items.push(Item::Func(f)),
                        None => break,
                    }
                }
                _ => {
                    self.error("unexpected token in contract body");
                    self.bump();
                }
            }
        }

        Some(Contract { name, items })
    }

    fn parse_attr(&mut self) -> Option<Attr> {
        self.bump(); // `@`
        let nt = self.expect(K::Ident, "expected attribute name")?;
        let name = self.text(nt);
        self.expect(K::LParen, "expected '(' after attribute name")?;
        let start = self.cur().lo;
        let mut end = start;
        let mut depth = 1usize;
        loop {
            let t = self.cur();
            match t.kind {
                K::LParen => {
                    depth += 1;
                    end = t.hi;
                    self.bump();
                }
                K::RParen => {
                    depth -= 1;
                    if depth == 0 {
                        self.bump();
                        break;
                    }
                    end = t.hi;
                    self.bump();
                }
                K::Eof => {
                    self.error("unterminated attribute argument list");
                    break;
                }
                _ => {
                    end = t.hi;
                    self.bump();
                }
            }
        }
        let args_src = self.src[start..end].trim().to_string();
        Some(Attr { name, args_src })
    }

    fn parse_const(&mut self) -> Option<ConstDecl> {
        self.bump(); // `const`
        let nt = self.expect(K::Ident, "expected const name")?;
        let name = self.text(nt);
        self.expect(K::Colon, "expected ':' after const name")?;
        let ty = self.parse_type()?;
        self.expect(K::Eq, "expected '=' in const declaration")?;
        let start = self.cur().lo;
        let mut end = start;
        while !self.at(K::Semi) && !self.at(K::Eof) {
            end = self.cur().hi;
            self.bump();
        }
        self.eat(K::Semi);
        let value_src = self.src[start..end].trim().to_string();
        Some(ConstDecl {
            name,
            ty,
            value_src,
        })
    }

    fn parse_state(&mut self) -> Option<StateBlock> {
        self.bump(); // `state`
        self.expect(K::LBrace, "expected '{' after 'state'")?;
        let mut fields: Vec<Field> = Vec::new();
        loop {
            match self.kind() {
                K::RBrace => {
                    self.bump();
                    break;
                }
                K::Eof => {
                    self.error("unterminated state block");
                    break;
                }
                K::Ident => {
                    let nt = self.bump();
                    let fname = self.text(nt);
                    self.expect(K::Colon, "expected ':' after state field name")?;
                    let ty = self.parse_type()?;
                    self.eat(K::Semi);
                    fields.push(Field { name: fname, ty });
                }
                _ => {
                    self.error("unexpected token in state block");
                    self.bump();
                }
            }
        }
        Some(StateBlock { fields })
    }

    fn parse_event(&mut self) -> Option<EventDecl> {
        self.bump(); // `event`
        let nt = self.expect(K::Ident, "expected event name")?;
        let name = self.text(nt);
        self.expect(K::LBrace, "expected '{' after event name")?;
        let mut fields: Vec<Field> = Vec::new();
        loop {
            match self.kind() {
                K::RBrace => {
                    self.bump();
                    break;
                }
                K::Eof => {
                    self.error("unterminated event declaration");
                    break;
                }
                K::Comma => {
                    self.bump();
                }
                K::Ident => {
                    let ft = self.bump();
                    let fname = self.text(ft);
                    self.expect(K::Colon, "expected ':' after event field name")?;
                    let ty = self.parse_type()?;
                    fields.push(Field { name: fname, ty });
                    self.eat(K::Comma);
                }
                _ => {
                    self.error("unexpected token in event declaration");
                    self.bump();
                }
            }
        }
        Some(EventDecl { name, fields })
    }

    fn parse_func(&mut self, attrs: Vec<Attr>) -> Option<FuncDecl> {
        let is_pub = self.eat(K::Pub);
        let is_async = self.eat(K::Async);
        self.expect(K::Fn, "expected 'fn'")?;
        let nt = self.expect(K::Ident, "expected function name")?;
        let name = self.text(nt);

        self.expect(K::LParen, "expected '(' after function name")?;
        let mut params: Vec<Param> = Vec::new();
        loop {
            match self.kind() {
                K::RParen => {
                    self.bump();
                    break;
                }
                K::Eof => {
                    self.error("unterminated parameter list");
                    break;
                }
                K::Comma => {
                    self.bump();
                }
                K::Ident => {
                    let pt = self.bump();
                    let pname = self.text(pt);
                    self.expect(K::Colon, "expected ':' after parameter name")?;
                    let ty = self.parse_type()?;
                    params.push(Param { name: pname, ty });
                    self.eat(K::Comma);
                }
                _ => {
                    self.error("unexpected token in parameter list");
                    self.bump();
                }
            }
        }

        let ret = if self.at(K::Arrow) {
            self.bump();
            Some(self.parse_type()?)
        } else {
            None
        };

        self.expect(K::LBrace, "expected '{' to begin function body")?;
        let body_lo = self.cur().lo;
        let mut body_hi = body_lo;
        let mut depth = 1usize;
        loop {
            let t = self.cur();
            match t.kind {
                K::LBrace => {
                    depth += 1;
                    body_hi = t.hi;
                    self.bump();
                }
                K::RBrace => {
                    depth -= 1;
                    if depth == 0 {
                        self.bump();
                        break;
                    }
                    body_hi = t.hi;
                    self.bump();
                }
                K::Eof => {
                    self.error("unterminated function body");
                    break;
                }
                _ => {
                    body_hi = t.hi;
                    self.bump();
                }
            }
        }
        let body_src = self.src[body_lo..body_hi].to_string();

        Some(FuncDecl {
            attrs,
            is_pub,
            is_async,
            name,
            params,
            ret,
            body_src,
        })
    }

    fn parse_type(&mut self) -> Option<Type> {
        let t = self.cur();
        if t.kind != K::Ident {
            self.error("expected a type");
            return None;
        }
        let name = self.text(t);
        self.bump();
        match name.as_str() {
            "map" => {
                self.expect(K::Lt, "expected '<' after 'map'")?;
                let k = self.parse_type()?;
                self.expect(K::Comma, "expected ',' in map type")?;
                let v = self.parse_type()?;
                self.expect(K::Gt, "expected '>' to close map type")?;
                Some(Type::Map(Box::new(k), Box::new(v)))
            }
            "vec" => {
                self.expect(K::Lt, "expected '<' after 'vec'")?;
                let inner = self.parse_type()?;
                self.expect(K::Gt, "expected '>' to close vec type")?;
                Some(Type::Vec(Box::new(inner)))
            }
            _ => Some(Type::Named(name)),
        }
    }
}
