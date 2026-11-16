//! Abstract syntax tree for Lithic contracts.
//!
//! This is a declaration-level AST: contract, consts, state, events and
//! function *signatures* are fully parsed; function bodies are retained as raw
//! source slices (`body_src`). Full statement/expression parsing is a later
//! phase of the toolchain.

/// A Lithic type expression.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Type {
    Named(String),
    Map(Box<Type>, Box<Type>),
    Vec(Box<Type>),
}

impl Type {
    /// Render the type back to its canonical Lithic spelling.
    pub fn render(&self) -> String {
        match self {
            Type::Named(n) => n.clone(),
            Type::Map(k, v) => format!("map<{}, {}>", k.render(), v.render()),
            Type::Vec(t) => format!("vec<{}>", t.render()),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Field {
    pub name: String,
    pub ty: Type,
}

#[derive(Clone, Debug)]
pub struct Param {
    pub name: String,
    pub ty: Type,
}

#[derive(Clone, Debug)]
pub struct Attr {
    pub name: String,
    /// Raw argument source between the parentheses, e.g. `max_cost = 300`.
    pub args_src: String,
}

#[derive(Clone, Debug)]
pub struct ConstDecl {
    pub name: String,
    pub ty: Type,
    /// Raw initialiser source, e.g. `keccak256("ADMIN_ROLE")`.
    pub value_src: String,
}

#[derive(Clone, Debug)]
pub struct StateBlock {
    pub fields: Vec<Field>,
}

#[derive(Clone, Debug)]
pub struct EventDecl {
    pub name: String,
    pub fields: Vec<Field>,
}

#[derive(Clone, Debug)]
pub struct FuncDecl {
    pub attrs: Vec<Attr>,
    pub is_pub: bool,
    pub is_async: bool,
    pub name: String,
    pub params: Vec<Param>,
    pub ret: Option<Type>,
    /// Raw body source between the outer braces.
    pub body_src: String,
}

impl FuncDecl {
    pub fn has_attr(&self, name: &str) -> bool {
        self.attrs.iter().any(|a| a.name == name)
    }
}

#[derive(Clone, Debug)]
pub enum Item {
    Const(ConstDecl),
    State(StateBlock),
    Event(EventDecl),
    Func(FuncDecl),
}

#[derive(Clone, Debug)]
pub struct Contract {
    pub name: String,
    pub items: Vec<Item>,
}

impl Contract {
    pub fn consts(&self) -> Vec<&ConstDecl> {
        self.items
            .iter()
            .filter_map(|i| {
                if let Item::Const(c) = i {
                    Some(c)
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn events(&self) -> Vec<&EventDecl> {
        self.items
            .iter()
            .filter_map(|i| {
                if let Item::Event(e) = i {
                    Some(e)
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn funcs(&self) -> Vec<&FuncDecl> {
        self.items
            .iter()
            .filter_map(|i| if let Item::Func(f) = i { Some(f) } else { None })
            .collect()
    }

    pub fn func(&self, name: &str) -> Option<&FuncDecl> {
        self.funcs().into_iter().find(|f| f.name == name)
    }

    /// Total number of declared state fields across all `state { .. }` blocks.
    pub fn state_field_count(&self) -> usize {
        self.items
            .iter()
            .filter_map(|i| {
                if let Item::State(s) = i {
                    Some(s.fields.len())
                } else {
                    None
                }
            })
            .sum()
    }

    /// A human-readable summary (used by `lithc --emit summary`).
    pub fn summary(&self) -> String {
        let mut s = String::new();
        s.push_str(&format!("contract {}\n", self.name));
        s.push_str(&format!("  consts:       {}\n", self.consts().len()));
        s.push_str(&format!("  state fields: {}\n", self.state_field_count()));
        s.push_str(&format!("  events:       {}\n", self.events().len()));
        let funcs = self.funcs();
        s.push_str(&format!("  functions:    {}\n", funcs.len()));
        for f in funcs {
            let vis = if f.is_pub { "pub " } else { "" };
            let asy = if f.is_async { "async " } else { "" };
            let params: Vec<String> = f
                .params
                .iter()
                .map(|p| format!("{}: {}", p.name, p.ty.render()))
                .collect();
            let ret = f
                .ret
                .as_ref()
                .map(|t| format!(" -> {}", t.render()))
                .unwrap_or_default();
            let attrs = if f.attrs.is_empty() {
                String::new()
            } else {
                let names: Vec<String> = f.attrs.iter().map(|a| format!("@{}", a.name)).collect();
                format!("{} ", names.join(" "))
            };
            s.push_str(&format!(
                "    {}{}{}fn {}({}){}\n",
                attrs,
                vis,
                asy,
                f.name,
                params.join(", "),
                ret
            ));
        }
        s
    }

    /// Emit a Lithic ABI as JSON: public functions and events with their
    /// declared parameter types. (This is a Lithic-native ABI, not Solidity.)
    pub fn to_abi_json(&self) -> String {
        let mut entries: Vec<String> = Vec::new();
        for f in self.funcs() {
            if !f.is_pub {
                continue;
            }
            let inputs: Vec<String> = f
                .params
                .iter()
                .map(|p| {
                    format!(
                        "{{\"name\":\"{}\",\"type\":\"{}\"}}",
                        esc(&p.name),
                        esc(&p.ty.render())
                    )
                })
                .collect();
            let outputs = match &f.ret {
                Some(t) => format!("[{{\"type\":\"{}\"}}]", esc(&t.render())),
                None => "[]".to_string(),
            };
            entries.push(format!(
                "{{\"type\":\"function\",\"name\":\"{}\",\"stateMutability\":\"{}\",\"inputs\":[{}],\"outputs\":{}}}",
                esc(&f.name),
                if f.is_async { "async" } else { "nonpayable" },
                inputs.join(","),
                outputs
            ));
        }
        for e in self.events() {
            let inputs: Vec<String> = e
                .fields
                .iter()
                .map(|fl| {
                    format!(
                        "{{\"name\":\"{}\",\"type\":\"{}\"}}",
                        esc(&fl.name),
                        esc(&fl.ty.render())
                    )
                })
                .collect();
            entries.push(format!(
                "{{\"type\":\"event\",\"name\":\"{}\",\"inputs\":[{}]}}",
                esc(&e.name),
                inputs.join(",")
            ));
        }
        format!("[{}]", entries.join(","))
    }

    /// Emit the declaration AST as JSON.
    pub fn to_json(&self) -> String {
        let consts: Vec<String> = self
            .consts()
            .iter()
            .map(|c| {
                format!(
                    "{{\"name\":\"{}\",\"type\":\"{}\",\"value\":\"{}\"}}",
                    esc(&c.name),
                    esc(&c.ty.render()),
                    esc(&c.value_src)
                )
            })
            .collect();
        let events: Vec<String> = self
            .events()
            .iter()
            .map(|e| {
                let fs: Vec<String> = e
                    .fields
                    .iter()
                    .map(|f| {
                        format!(
                            "{{\"name\":\"{}\",\"type\":\"{}\"}}",
                            esc(&f.name),
                            esc(&f.ty.render())
                        )
                    })
                    .collect();
                format!(
                    "{{\"name\":\"{}\",\"fields\":[{}]}}",
                    esc(&e.name),
                    fs.join(",")
                )
            })
            .collect();
        let funcs: Vec<String> = self
            .funcs()
            .iter()
            .map(|f| {
                let ps: Vec<String> = f
                    .params
                    .iter()
                    .map(|p| format!("{{\"name\":\"{}\",\"type\":\"{}\"}}", esc(&p.name), esc(&p.ty.render())))
                    .collect();
                let attrs: Vec<String> = f
                    .attrs
                    .iter()
                    .map(|a| format!("{{\"name\":\"{}\",\"args\":\"{}\"}}", esc(&a.name), esc(&a.args_src)))
                    .collect();
                let ret = match &f.ret {
                    Some(t) => format!("\"{}\"", esc(&t.render())),
                    None => "null".to_string(),
                };
                format!(
                    "{{\"name\":\"{}\",\"pub\":{},\"async\":{},\"attrs\":[{}],\"params\":[{}],\"returns\":{}}}",
                    esc(&f.name),
                    f.is_pub,
                    f.is_async,
                    attrs.join(","),
                    ps.join(","),
                    ret
                )
            })
            .collect();
        format!(
            "{{\"contract\":\"{}\",\"consts\":[{}],\"stateFields\":{},\"events\":[{}],\"functions\":[{}]}}",
            esc(&self.name),
            consts.join(","),
            self.state_field_count(),
            events.join(","),
            funcs.join(",")
        )
    }
}

/// Minimal JSON string escaping.
fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}
