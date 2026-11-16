//! `lithlint` — the Lithic linter and static analyzer.
//!
//! v0 ships a handful of real, AST-driven rules:
//!   * L001 contract names should be UpperCamelCase
//!   * L002 function names should be snake_case
//!   * L003 const names should be SCREAMING_SNAKE_CASE
//!   * L004 `pub async fn` (which can call the AI primitive) should declare an
//!     `@ai_budget` to bound its cost
//!
//! Findings are warnings by default; pass `--deny-warnings` to exit non-zero.

use lithic_syntax::Contract;
use std::process::exit;

fn print_help() {
    eprintln!(
        "lithlint {} — Lithic linter (v0)\n\
\n\
USAGE:\n\
    lithlint [OPTIONS] <FILE.lithic>\n\
\n\
OPTIONS:\n\
    --deny-warnings  Exit with code 1 if any finding is reported\n\
    -h, --help       Print this help",
        env!("CARGO_PKG_VERSION")
    );
}

fn is_upper_camel(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .next()
            .map(|c| c.is_ascii_uppercase())
            .unwrap_or(false)
        && !s.contains('_')
}

fn is_snake(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn is_screaming_snake(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

fn lint(c: &Contract) -> Vec<String> {
    let mut findings = Vec::new();

    if !is_upper_camel(&c.name) {
        findings.push(format!(
            "L001 contract `{}` should be UpperCamelCase",
            c.name
        ));
    }
    for cst in c.consts() {
        if !is_screaming_snake(&cst.name) {
            findings.push(format!(
                "L003 const `{}` should be SCREAMING_SNAKE_CASE",
                cst.name
            ));
        }
    }
    for f in c.funcs() {
        if !is_snake(&f.name) {
            findings.push(format!("L002 function `{}` should be snake_case", f.name));
        }
        if f.is_pub && f.is_async && !f.has_attr("ai_budget") {
            findings.push(format!(
                "L004 `pub async fn {}` may invoke the AI primitive; add @ai_budget to bound its cost",
                f.name
            ));
        }
    }

    findings
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut path: Option<String> = None;
    let mut deny = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--deny-warnings" => deny = true,
            "-h" | "--help" => {
                print_help();
                return;
            }
            s if !s.starts_with('-') => {
                if let Some(first) = &path {
                    eprintln!(
                        "lithlint: error: multiple input files are not supported: '{}' and '{}'",
                        first, s
                    );
                    exit(2);
                }
                path = Some(s.to_string());
            }
            other => {
                eprintln!("lithlint: error: unknown option '{}'", other);
                exit(2);
            }
        }
        i += 1;
    }

    let path = match path {
        Some(p) => p,
        None => {
            eprintln!("lithlint: error: no input file given\n");
            print_help();
            exit(2);
        }
    };

    let src = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("lithlint: error: cannot read {}: {}", path, e);
            exit(2);
        }
    };

    let res = lithic_syntax::parse(&src);
    for d in &res.diagnostics {
        eprintln!("{}", d.render(&src, &path));
    }
    if res.error_count() > 0 {
        eprintln!("lithlint: error: cannot lint {} due to parse errors", path);
        exit(1);
    }

    let contract = match res.contract {
        Some(c) => c,
        None => {
            eprintln!("lithlint: error: no contract found in {}", path);
            exit(1);
        }
    };

    let findings = lint(&contract);
    for f in &findings {
        println!("{}: warning: {}", path, f);
    }

    if findings.is_empty() {
        println!("{}: clean (0 findings)", path);
    } else {
        println!("lithlint: {} finding(s)", findings.len());
        if deny {
            exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::lint;

    fn lint_source(source: &str) -> Vec<String> {
        let parsed = lithic_syntax::parse(source);
        assert_eq!(
            parsed.error_count(),
            0,
            "unexpected diagnostics: {:?}",
            parsed.diagnostics
        );
        lint(&parsed.contract.expect("contract"))
    }

    #[test]
    fn clean_contract_has_no_findings() {
        let source = r#"
            contract Token {
                const MAX_SUPPLY: u256 = 1;
                @ai_budget(max_cost = 1)
                pub async fn guarded_transfer() {}
            }
        "#;

        assert!(lint_source(source).is_empty());
    }

    #[test]
    fn naming_rules_report_their_declared_targets() {
        let source = r#"
            contract bad_name {
                const max_supply: u256 = 1;
                pub fn BadFunction() {}
            }
        "#;
        let findings = lint_source(source);

        assert_eq!(findings.len(), 3);
        assert!(findings.iter().any(|finding| finding.starts_with("L001 ")));
        assert!(findings.iter().any(|finding| finding.starts_with("L002 ")));
        assert!(findings.iter().any(|finding| finding.starts_with("L003 ")));
    }

    #[test]
    fn ai_budget_rule_is_limited_to_public_async_functions() {
        let source = r#"
            contract Token {
                pub async fn needs_budget() {}
                @ai_budget(max_cost = 1)
                pub async fn has_budget() {}
                async fn private_async() {}
                pub fn public_sync() {}
            }
        "#;
        let findings = lint_source(source);
        let budget_findings: Vec<_> = findings
            .iter()
            .filter(|finding| finding.starts_with("L004 "))
            .collect();

        assert_eq!(budget_findings.len(), 1);
        assert!(budget_findings[0].contains("needs_budget"));
    }
}
