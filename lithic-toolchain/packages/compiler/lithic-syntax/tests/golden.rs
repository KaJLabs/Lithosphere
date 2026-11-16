//! Golden tests: the parser must handle the real example contracts shipped in
//! the monorepo (`Makalu/contracts/src/*.lithic`).

use lithic_syntax::parse;
use std::path::PathBuf;

fn example(name: &str) -> String {
    // Keep historical syntax fixtures local so this repository builds alone.
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests/fixtures");
    p.push(name);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("cannot read {}: {}", p.display(), e))
}

#[test]
fn doge_fungible_token() {
    let src = example("DOGE.lithic");
    let res = parse(&src);
    assert_eq!(res.error_count(), 0, "diagnostics: {:?}", res.diagnostics);

    let c = res.contract.expect("contract parsed");
    assert_eq!(c.name, "FungibleToken");
    assert_eq!(c.consts().len(), 3);
    assert_eq!(c.state_field_count(), 8);
    assert_eq!(c.events().len(), 8);

    let g = c
        .func("guarded_transfer")
        .expect("guarded_transfer present");
    assert!(g.is_pub, "guarded_transfer should be pub");
    assert!(g.is_async, "guarded_transfer should be async");
    assert!(
        g.has_attr("ai_budget"),
        "guarded_transfer should carry @ai_budget"
    );

    // Spot-check a signature with a vec return type.
    let bob = c
        .func("balance_of_batch")
        .expect("balance_of_batch present");
    assert_eq!(bob.params.len(), 2);
    assert_eq!(
        bob.ret.as_ref().map(|t| t.render()),
        Some("vec<u256>".to_string())
    );
}

#[test]
fn finesse_warriors_nft() {
    let src = example("FinesseWarriors.lithic");
    let res = parse(&src);
    assert_eq!(res.error_count(), 0, "diagnostics: {:?}", res.diagnostics);

    let c = res.contract.expect("contract parsed");
    assert_eq!(c.name, "NonFungibleToken");
    assert_eq!(c.consts().len(), 3);
    assert_eq!(c.state_field_count(), 12);
    assert_eq!(c.events().len(), 8);

    let m = c.func("ai_mint").expect("ai_mint present");
    assert!(m.is_pub && m.is_async);
    assert!(m.has_attr("ai_budget"));
    assert_eq!(m.ret.as_ref().map(|t| t.render()), Some("u256".to_string()));
}

#[test]
fn abi_is_emitted_for_public_surface() {
    let src = example("DOGE.lithic");
    let c = parse(&src).contract.expect("contract");
    let abi = c.to_abi_json();
    assert!(abi.starts_with('['));
    assert!(abi.contains("\"type\":\"function\""));
    assert!(abi.contains("\"name\":\"safe_transfer_from\""));
    assert!(abi.contains("\"type\":\"event\""));
    assert!(abi.contains("\"name\":\"TransferSingle\""));
}
