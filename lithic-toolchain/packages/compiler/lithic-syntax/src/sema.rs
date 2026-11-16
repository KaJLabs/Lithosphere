//! Conservative declaration checks for parsed Lithic contracts.
//!
//! The repository does not yet contain an approved full Lithic type-system or
//! function-body specification. This pass therefore checks only name collisions
//! that are unambiguous in the current declaration AST. It deliberately does
//! not infer primitive types, overload rules, map-key rules, return semantics,
//! or any other language behavior that has not been specified.

use crate::ast::{Contract, Item};
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Error,
}

impl Level {
    pub fn label(self) -> &'static str {
        match self {
            Level::Error => "error",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Finding {
    pub level: Level,
    pub code: &'static str,
    pub message: String,
}

impl Finding {
    fn error(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            level: Level::Error,
            code,
            message: message.into(),
        }
    }

    pub fn is_error(&self) -> bool {
        self.level == Level::Error
    }

    pub fn render(&self, filename: &str) -> String {
        format!(
            "{}: {}: [{}] {}",
            filename,
            self.level.label(),
            self.code,
            self.message
        )
    }
}

fn report_duplicates<'a>(
    names: impl Iterator<Item = &'a str>,
    kind: &str,
    code: &'static str,
    findings: &mut Vec<Finding>,
) {
    let mut seen = HashSet::new();
    for name in names {
        if !seen.insert(name) {
            findings.push(Finding::error(
                code,
                format!("duplicate {} `{}`", kind, name),
            ));
        }
    }
}

/// Validate declaration-level name collisions supported by the current AST.
pub fn check(contract: &Contract) -> Vec<Finding> {
    let mut findings = Vec::new();

    report_duplicates(
        contract
            .consts()
            .iter()
            .map(|constant| constant.name.as_str()),
        "const",
        "E001",
        &mut findings,
    );

    let state_fields = contract.items.iter().filter_map(|item| match item {
        Item::State(state) => Some(state.fields.as_slice()),
        _ => None,
    });
    report_duplicates(
        state_fields.flatten().map(|field| field.name.as_str()),
        "state field",
        "E002",
        &mut findings,
    );

    for function in contract.funcs() {
        report_duplicates(
            function.params.iter().map(|param| param.name.as_str()),
            &format!("parameter of function `{}`", function.name),
            "E003",
            &mut findings,
        );
    }

    findings
}

pub fn error_count(findings: &[Finding]) -> usize {
    findings.iter().filter(|finding| finding.is_error()).count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse;

    fn check_source(source: &str) -> Vec<Finding> {
        let result = parse(source);
        assert_eq!(
            result.error_count(),
            0,
            "unexpected parser diagnostics: {:?}",
            result.diagnostics
        );
        check(&result.contract.expect("contract"))
    }

    fn codes(findings: &[Finding]) -> Vec<&str> {
        findings.iter().map(|finding| finding.code).collect()
    }

    #[test]
    fn accepts_unique_declarations() {
        let findings = check_source(
            "contract C { const A: bytes32 = 1; state { x: u256; } fn f(a: u256) {} }",
        );
        assert!(findings.is_empty());
    }

    #[test]
    fn rejects_duplicate_consts() {
        let findings = check_source("contract C { const A: u256 = 1; const A: u256 = 2; }");
        assert!(codes(&findings).contains(&"E001"));
    }

    #[test]
    fn rejects_duplicate_state_fields_across_blocks() {
        let findings = check_source("contract C { state { x: u256; } state { x: bool; } }");
        assert!(codes(&findings).contains(&"E002"));
    }

    #[test]
    fn rejects_duplicate_parameters() {
        let findings = check_source("contract C { fn f(a: u256, a: address) {} }");
        assert!(codes(&findings).contains(&"E003"));
    }

    #[test]
    fn leaves_unapproved_type_and_overload_rules_uninferred() {
        let findings = check_source(
            "contract C { state { x: FutureType; } fn f(a: u256) {} fn f(a: address) {} }",
        );
        assert!(findings.is_empty());
    }
}
