//! `lithic-syntax` — lexer, parser, and AST for the Lithic smart-contract
//! language that targets LithoVM bytecode.
//!
//! The entry point is [`parse`], which lexes and parses a source string into a
//! declaration-level [`ast::Contract`] plus any [`diagnostic::Diagnostic`]s.

pub mod ast;
pub mod diagnostic;
pub mod lexer;
pub mod parser;
pub mod sema;
pub mod span;
pub mod token;

pub use ast::{Attr, ConstDecl, Contract, EventDecl, Field, FuncDecl, Item, Param, Type};
pub use diagnostic::{Diagnostic, Severity};
pub use parser::{parse, ParseResult};
pub use sema::{check, Finding, Level};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_minimal_contract() {
        let src = r#"
            contract Token {
                const ADMIN_ROLE: bytes32 = keccak256("ADMIN_ROLE");
                state {
                    name: string;
                    balances: map<u256, map<address, u256>>;
                }
                event Transfer { from: address, to: address, value: u256 }
                pub fn balance_of(account: address, id: u256) -> u256 {
                    return self.balances[id][account];
                }
                @ai_budget(max_cost = 300)
                pub async fn guarded(to: address) {
                    let r = await ai.request("x", { a: 1 });
                }
            }
        "#;
        let res = parse(src);
        assert_eq!(res.error_count(), 0, "diagnostics: {:?}", res.diagnostics);
        let c = res.contract.expect("contract");
        assert_eq!(c.name, "Token");
        assert_eq!(c.consts().len(), 1);
        assert_eq!(c.state_field_count(), 2);
        assert_eq!(c.events().len(), 1);
        let g = c.func("guarded").expect("guarded fn");
        assert!(g.is_pub && g.is_async);
        assert!(g.has_attr("ai_budget"));
    }

    #[test]
    fn nested_generics_parse() {
        let src = "contract C { state { m: map<bytes32, map<address, bool>>; } }";
        let res = parse(src);
        assert_eq!(res.error_count(), 0, "diagnostics: {:?}", res.diagnostics);
    }
}
