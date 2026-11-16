// LAX v13 (admin-controlled, adaptive supply) host tests. The test copy replaces the two
// hard-coded addresses: INITIAL_HOLDER -> 0x..08, INITIAL_ADMIN -> 0x..09.
use lithic_lithovm::compile;
use lithovm_bytecode::{values::Value, ValueType};
use lithovm_host::{
    CallRequest, DeployOutcome, DeployRequest, HostOutcome, InMemoryState, Initializer,
    TransactionalHost,
};

const SOURCE: &str = include_str!("../../../../../lax-v13/lax_lep100_v13_admin.lithic");
const HOLDER: u64 = 8;
const ADMIN: u64 = 9;
const ALICE: u64 = 10;
const BOB: u64 = 11;
const SPENDER: u64 = 12;
const NEXT_ADMIN: u64 = 13;

fn word(value: u64) -> [u8; 32] {
    let mut w = [0; 32];
    w[24..].copy_from_slice(&value.to_be_bytes());
    w
}
fn dec(text: &str) -> [u8; 32] {
    let mut w = [0u8; 32];
    for ch in text.bytes() {
        let mut carry = (ch - b'0') as u32;
        for byte in w.iter_mut().rev() {
            let v = (*byte as u32) * 10 + carry;
            *byte = (v & 0xff) as u8;
            carry = v >> 8;
        }
        assert_eq!(carry, 0, "overflow in dec()");
    }
    w
}
fn addr(n: u64) -> Value {
    Value::Word(ValueType::Address, word(n))
}
fn amount(n: u64) -> Value {
    Value::Word(ValueType::U256, word(n))
}
fn big(text: &str) -> Value {
    Value::Word(ValueType::U256, dec(text))
}
fn boolean(b: bool) -> Value {
    Value::Word(ValueType::Bool, word(b as u64))
}
const SUPPLY: &str = "10000000000000000000000000000";
const MAX_U256: &str =
    "115792089237316195423570985008687907853269984665640564039457584007913129639935";

fn test_source() -> String {
    let s = SOURCE
        .replace(
            "0x8FDbEe6b479dcaE4627b71D9b053FCa996836aAF",
            "0x0000000000000000000000000000000000000008",
        )
        .replace(
            "0x602699FA64Ab8f981e074E267bAe633d389b78Da",
            "0x0000000000000000000000000000000000000009",
        );
    assert!(s.contains("INITIAL_HOLDER: address = 0x0000000000000000000000000000000000000008"));
    assert!(s.contains("INITIAL_ADMIN: address = 0x0000000000000000000000000000000000000009"));
    s
}

struct Lax {
    host: TransactionalHost<InMemoryState>,
    contract: [u8; 32],
}

impl Lax {
    fn deploy_with(holder: u64, admin: u64) -> Result<Lax, ()> {
        let bytes = hex::decode(&compile(&test_source()).unwrap().bytecode[2..]).unwrap();
        let mut state = InMemoryState::default();
        state.set_balance(word(7), word(100));
        let mut host = TransactionalHost::new(state);
        let outcome = host.deploy_values(DeployRequest {
            deployer: word(7),
            nonce: 0,
            bytecode: bytes,
            initializer: Some(Initializer {
                function: "initialize".into(),
                arguments: vec![
                    addr(holder),
                    addr(admin),
                    Value::String("Lithosphere Algorithmic".into()),
                    Value::String("LAX".into()),
                ],
            }),
            value: word(0),
            gas_limit: 5_000_000,
            block_height: 42,
            block_timestamp: 1000,
            chain_id: 9005,
        });
        match outcome {
            DeployOutcome::Success(d) => Ok(Lax { host, contract: d.contract }),
            _ => Err(()),
        }
    }
    fn deploy() -> Lax {
        Lax::deploy_with(HOLDER, ADMIN).expect("deploy failed")
    }
    fn call(&mut self, caller: u64, function: &str, arguments: Vec<Value>) -> Option<Value> {
        let request = CallRequest {
            contract: self.contract,
            function: function.into(),
            arguments,
            gas_limit: 2_000_000,
            caller: word(caller),
            value: word(0),
            block_height: 43,
            block_timestamp: 1001,
            chain_id: 9005,
        };
        match self.host.execute_values(request) {
            HostOutcome::Success(r) => Some(r.result.return_value),
            HostOutcome::Failure(_) => None,
        }
    }
    // A call that must succeed (returns true for mutating calls).
    fn ok(&mut self, caller: u64, function: &str, arguments: Vec<Value>) {
        let r = self.call(caller, function, arguments);
        assert_eq!(r, Some(boolean(true)), "{function} by {caller} should succeed");
    }
    // A call that must revert and leave state unchanged.
    fn rejected(&mut self, caller: u64, function: &str, arguments: Vec<Value>) {
        let before = self.host.state().clone();
        assert!(self.call(caller, function, arguments).is_none(), "{function} by {caller} should revert");
        assert_eq!(self.host.state(), &before, "{function} revert changed state");
    }
    fn view(&mut self, function: &str, arguments: Vec<Value>) -> Value {
        self.call(1, function, arguments).expect("view failed")
    }
    fn balance(&mut self, who: u64) -> Value {
        self.view("balance_of", vec![addr(who)])
    }
}

#[test]
fn initializes_supply_holder_and_admin_once() {
    let mut lax = Lax::deploy();
    assert_eq!(lax.view("total_supply", vec![]), big(SUPPLY));
    assert_eq!(lax.balance(HOLDER), big(SUPPLY));
    assert_eq!(lax.view("admin", vec![]), addr(ADMIN));
    assert_eq!(lax.view("pending_admin", vec![]), addr(0));
    assert_eq!(lax.view("paused", vec![]), boolean(false));
    assert_eq!(lax.view("name", vec![]), Value::String("Lithosphere Algorithmic".into()));
    assert_eq!(lax.view("symbol", vec![]), Value::String("LAX".into()));
    assert_eq!(lax.view("decimals", vec![]), Value::Word(ValueType::U64, word(18)));
    lax.rejected(ADMIN, "initialize", vec![addr(HOLDER), addr(ADMIN), Value::String("X".into()), Value::String("X".into())]);
    // The hard-coded holder and admin cannot be substituted at deployment.
    assert!(Lax::deploy_with(ALICE, ADMIN).is_err());
    assert!(Lax::deploy_with(HOLDER, ALICE).is_err());
    assert!(Lax::deploy_with(HOLDER, 0).is_err());
}

#[test]
fn holders_transfer_approve_transfer_from_and_burn() {
    let mut lax = Lax::deploy();
    lax.ok(HOLDER, "transfer", vec![addr(ALICE), amount(1000)]);
    assert_eq!(lax.balance(ALICE), amount(1000));
    lax.rejected(ALICE, "transfer", vec![addr(BOB), amount(1001)]);
    lax.rejected(ALICE, "transfer", vec![addr(0), amount(1)]);
    lax.ok(ALICE, "approve", vec![addr(SPENDER), amount(300)]);
    lax.ok(SPENDER, "transfer_from", vec![addr(ALICE), addr(BOB), amount(200)]);
    assert_eq!(lax.view("allowance", vec![addr(ALICE), addr(SPENDER)]), amount(100));
    lax.rejected(SPENDER, "transfer_from", vec![addr(ALICE), addr(BOB), amount(101)]);
    lax.ok(BOB, "burn", vec![amount(50)]);
    assert_eq!(lax.balance(BOB), amount(150));
    assert_eq!(lax.view("total_supply", vec![]), big("9999999999999999999999999950"));
    lax.rejected(BOB, "burn", vec![amount(151)]);
}

#[test]
fn only_admin_mints_and_burns_and_supply_tracks() {
    let mut lax = Lax::deploy();
    lax.rejected(HOLDER, "mint", vec![addr(ALICE), amount(5)]);
    lax.rejected(ALICE, "mint", vec![addr(ALICE), amount(5)]);
    lax.ok(ADMIN, "mint", vec![addr(ALICE), amount(5000)]);
    assert_eq!(lax.balance(ALICE), amount(5000));
    assert_eq!(lax.view("total_supply", vec![]), big("10000000000000000000000005000"));
    lax.rejected(ADMIN, "mint", vec![addr(0), amount(1)]);
    // Overflow of total supply is rejected by checked arithmetic.
    lax.rejected(ADMIN, "mint", vec![addr(BOB), big(MAX_U256)]);
    lax.rejected(HOLDER, "admin_burn", vec![addr(ALICE), amount(1)]);
    lax.ok(ADMIN, "admin_burn", vec![addr(ALICE), amount(2000)]);
    assert_eq!(lax.balance(ALICE), amount(3000));
    lax.rejected(ADMIN, "admin_burn", vec![addr(ALICE), amount(3001)]);
    lax.ok(ADMIN, "admin_burn", vec![addr(HOLDER), big(SUPPLY)]);
    assert_eq!(lax.balance(HOLDER), amount(0));
    assert_eq!(lax.view("total_supply", vec![]), amount(3000));
}

#[test]
fn frozen_accounts_cannot_send_receive_approve_spend_or_burn() {
    let mut lax = Lax::deploy();
    lax.ok(HOLDER, "transfer", vec![addr(ALICE), amount(1000)]);
    lax.ok(ALICE, "approve", vec![addr(SPENDER), amount(500)]);
    lax.rejected(HOLDER, "freeze", vec![addr(ALICE)]);
    lax.rejected(ADMIN, "freeze", vec![addr(ADMIN)]);
    lax.rejected(ADMIN, "freeze", vec![addr(0)]);
    lax.ok(ADMIN, "freeze", vec![addr(ALICE)]);
    assert_eq!(lax.view("is_frozen", vec![addr(ALICE)]), boolean(true));
    lax.rejected(ADMIN, "freeze", vec![addr(ALICE)]);
    lax.rejected(ALICE, "transfer", vec![addr(BOB), amount(1)]);
    lax.rejected(HOLDER, "transfer", vec![addr(ALICE), amount(1)]);
    lax.rejected(ALICE, "approve", vec![addr(BOB), amount(1)]);
    lax.rejected(HOLDER, "approve", vec![addr(ALICE), amount(1)]);
    lax.rejected(SPENDER, "transfer_from", vec![addr(ALICE), addr(BOB), amount(1)]);
    lax.rejected(ALICE, "burn", vec![amount(1)]);
    lax.rejected(ADMIN, "mint", vec![addr(ALICE), amount(1)]);
    // The admin can still burn from a frozen account.
    lax.ok(ADMIN, "admin_burn", vec![addr(ALICE), amount(100)]);
    assert_eq!(lax.balance(ALICE), amount(900));
    lax.rejected(HOLDER, "unfreeze", vec![addr(ALICE)]);
    lax.ok(ADMIN, "unfreeze", vec![addr(ALICE)]);
    lax.rejected(ADMIN, "unfreeze", vec![addr(ALICE)]);
    lax.ok(ALICE, "transfer", vec![addr(BOB), amount(1)]);
    lax.ok(SPENDER, "transfer_from", vec![addr(ALICE), addr(BOB), amount(1)]);
    // A frozen spender cannot spend an allowance.
    lax.ok(ADMIN, "freeze", vec![addr(SPENDER)]);
    lax.rejected(SPENDER, "transfer_from", vec![addr(ALICE), addr(BOB), amount(1)]);
}

#[test]
fn pause_blocks_holders_but_not_admin_supply_controls() {
    let mut lax = Lax::deploy();
    lax.ok(HOLDER, "transfer", vec![addr(ALICE), amount(1000)]);
    lax.rejected(HOLDER, "pause", vec![]);
    lax.ok(ADMIN, "pause", vec![]);
    assert_eq!(lax.view("paused", vec![]), boolean(true));
    lax.rejected(ADMIN, "pause", vec![]);
    lax.rejected(ALICE, "transfer", vec![addr(BOB), amount(1)]);
    lax.rejected(ALICE, "approve", vec![addr(BOB), amount(1)]);
    lax.rejected(ALICE, "burn", vec![amount(1)]);
    lax.ok(ADMIN, "mint", vec![addr(BOB), amount(7)]);
    lax.ok(ADMIN, "admin_burn", vec![addr(ALICE), amount(7)]);
    lax.ok(ADMIN, "freeze", vec![addr(BOB)]);
    lax.rejected(ALICE, "unpause", vec![]);
    lax.ok(ADMIN, "unpause", vec![]);
    lax.rejected(ADMIN, "unpause", vec![]);
    lax.ok(ALICE, "transfer", vec![addr(HOLDER), amount(1)]);
}

#[test]
fn admin_handover_is_two_step_and_cancellable() {
    let mut lax = Lax::deploy();
    lax.rejected(ALICE, "transfer_admin", vec![addr(NEXT_ADMIN)]);
    lax.rejected(ADMIN, "transfer_admin", vec![addr(0)]);
    lax.rejected(ADMIN, "transfer_admin", vec![addr(ADMIN)]);
    lax.rejected(ADMIN, "cancel_admin_transfer", vec![]);
    lax.ok(ADMIN, "transfer_admin", vec![addr(NEXT_ADMIN)]);
    assert_eq!(lax.view("pending_admin", vec![]), addr(NEXT_ADMIN));
    assert_eq!(lax.view("admin", vec![]), addr(ADMIN));
    lax.ok(ADMIN, "mint", vec![addr(ALICE), amount(1)]); // old admin keeps control until acceptance
    lax.rejected(ALICE, "accept_admin", vec![]);
    lax.ok(ADMIN, "cancel_admin_transfer", vec![]);
    lax.rejected(NEXT_ADMIN, "accept_admin", vec![]);
    lax.ok(ADMIN, "transfer_admin", vec![addr(NEXT_ADMIN)]);
    lax.ok(NEXT_ADMIN, "accept_admin", vec![]);
    assert_eq!(lax.view("admin", vec![]), addr(NEXT_ADMIN));
    assert_eq!(lax.view("pending_admin", vec![]), addr(0));
    lax.rejected(ADMIN, "mint", vec![addr(ALICE), amount(1)]);
    lax.rejected(ADMIN, "pause", vec![]);
    lax.ok(NEXT_ADMIN, "mint", vec![addr(ALICE), amount(1)]);
    lax.ok(NEXT_ADMIN, "freeze", vec![addr(ADMIN)]);
}
