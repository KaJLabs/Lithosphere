//! A fail-closed Lithic-to-EVM backend.
//!
//! The backend deliberately begins with a small, deployable subset: stateless
//! public functions with static parameters that return a constant or one of
//! their parameters as `u64`, `u256`, `bool`, `address`, or `bytes32`. Any
//! unsupported declaration or function body rejects the whole contract instead
//! of being ignored or miscompiled.

use lithic_syntax::{Contract, Item, Type};
use serde::Serialize;
use sha3::{Digest, Keccak256};
use std::fmt;

const TARGET: &str = "evm-lithosphere-9005-v1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionArtifact {
    pub name: String,
    pub signature: String,
    pub selector: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub contract_name: String,
    pub target: String,
    pub abi: serde_json::Value,
    pub bytecode: String,
    pub deployed_bytecode: String,
    pub functions: Vec<FunctionArtifact>,
}

impl Artifact {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("artifact serialization cannot fail")
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompileError {
    messages: Vec<String>,
}

impl CompileError {
    fn one(message: impl Into<String>) -> Self {
        Self {
            messages: vec![message.into()],
        }
    }

    pub fn messages(&self) -> &[String] {
        &self.messages
    }
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.messages.join("\n"))
    }
}

impl std::error::Error for CompileError {}

struct CompiledFunction {
    artifact: FunctionArtifact,
    selector: [u8; 4],
    output_type: &'static str,
    inputs: Vec<CompiledParam>,
    return_value: ReturnValue,
}

struct CompiledParam {
    name: String,
    evm_type: &'static str,
}

#[derive(Clone, Copy)]
enum ReturnValue {
    Constant([u8; 32]),
    Parameter(usize),
}

/// Compile a complete Lithic source file into an EVM deployment artifact.
///
/// Parsing, validation, type lowering, selector derivation, ABI generation,
/// dispatch assembly and deployment wrapping are atomic. Errors emit no
/// partial bytecode.
pub fn compile(source: &str) -> Result<Artifact, CompileError> {
    let parsed = lithic_syntax::parse(source);
    let mut errors: Vec<String> = parsed
        .diagnostics
        .iter()
        .filter(|d| d.is_error())
        .map(|d| format!("syntax error: {}", d.message))
        .collect();
    let contract = parsed
        .contract
        .ok_or_else(|| CompileError::one("no contract found"))?;

    errors.extend(
        lithic_syntax::check(&contract)
            .into_iter()
            .filter(|f| matches!(f.level, lithic_syntax::Level::Error))
            .map(|f| format!("declaration error: {}", f.message)),
    );
    if !errors.is_empty() {
        return Err(CompileError { messages: errors });
    }

    compile_contract(&contract)
}

fn compile_contract(contract: &Contract) -> Result<Artifact, CompileError> {
    let mut errors = Vec::new();
    let mut functions = Vec::new();

    for item in &contract.items {
        match item {
            Item::State(state) if !state.fields.is_empty() => {
                errors.push("state fields are not supported by the v1 EVM backend".to_string())
            }
            Item::Const(_) => errors
                .push("contract constants are not supported by the v1 EVM backend".to_string()),
            Item::Event(_) => errors
                .push("event declarations are not supported by the v1 EVM backend".to_string()),
            Item::Func(function) => match compile_function(function) {
                Ok(compiled) => functions.push(compiled),
                Err(message) => errors.push(format!("function '{}': {}", function.name, message)),
            },
            Item::State(_) => {}
        }
    }

    if functions.is_empty() {
        errors.push("at least one supported public function is required".to_string());
    }

    for left in 0..functions.len() {
        for right in (left + 1)..functions.len() {
            if functions[left].selector == functions[right].selector {
                errors.push(format!(
                    "selector collision between '{}' and '{}'",
                    functions[left].artifact.signature, functions[right].artifact.signature
                ));
            }
        }
    }

    if !errors.is_empty() {
        return Err(CompileError { messages: errors });
    }

    let runtime = build_runtime(&functions)?;
    let deployment = wrap_deployment(&runtime)?;
    let abi = build_abi(&functions);

    Ok(Artifact {
        contract_name: contract.name.clone(),
        target: TARGET.to_string(),
        abi,
        bytecode: format!("0x{}", hex::encode(deployment)),
        deployed_bytecode: format!("0x{}", hex::encode(runtime)),
        functions: functions.into_iter().map(|f| f.artifact).collect(),
    })
}

fn compile_function(function: &lithic_syntax::FuncDecl) -> Result<CompiledFunction, String> {
    if !function.is_pub {
        return Err("private functions are not supported by the v1 EVM backend".to_string());
    }
    if function.is_async {
        return Err("async functions are not supported by the v1 EVM backend".to_string());
    }
    if !function.attrs.is_empty() {
        return Err("function attributes are not supported by the v1 EVM backend".to_string());
    }
    let return_type = function
        .ret
        .as_ref()
        .ok_or_else(|| "a return type is required".to_string())?;
    let output_type = evm_type(return_type)?;
    let inputs = function
        .params
        .iter()
        .map(|param| {
            Ok(CompiledParam {
                name: param.name.clone(),
                evm_type: evm_type(&param.ty)?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let return_value = parse_return(&function.body_src, output_type, &inputs)?;
    let signature = format!(
        "{}({})",
        function.name,
        inputs
            .iter()
            .map(|param| param.evm_type)
            .collect::<Vec<_>>()
            .join(",")
    );
    let hash = Keccak256::digest(signature.as_bytes());
    let selector: [u8; 4] = hash[..4].try_into().expect("four-byte selector");

    Ok(CompiledFunction {
        artifact: FunctionArtifact {
            name: function.name.clone(),
            signature,
            selector: format!("0x{}", hex::encode(selector)),
        },
        selector,
        output_type,
        inputs,
        return_value,
    })
}

fn evm_type(ty: &Type) -> Result<&'static str, String> {
    match ty {
        Type::Named(name) => match name.as_str() {
            "u64" => Ok("uint64"),
            "u256" => Ok("uint256"),
            "bool" => Ok("bool"),
            "address" => Ok("address"),
            "bytes32" => Ok("bytes32"),
            other => Err(format!("type '{other}' has no v1 EVM lowering")),
        },
        Type::Map(_, _) | Type::Vec(_) => Err("collection returns are not supported".to_string()),
    }
}

fn parse_return(
    body: &str,
    output_type: &str,
    inputs: &[CompiledParam],
) -> Result<ReturnValue, String> {
    let body = body.trim();
    let value = body
        .strip_prefix("return")
        .and_then(|rest| rest.trim().strip_suffix(';'))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "expected exactly 'return <constant>;'".to_string())?;

    if let Some((index, param)) = inputs
        .iter()
        .enumerate()
        .find(|(_, param)| param.name == value)
    {
        if param.evm_type != output_type {
            return Err(format!(
                "return parameter '{}' has type {}, expected {}",
                param.name, param.evm_type, output_type
            ));
        }
        return Ok(ReturnValue::Parameter(index));
    }

    if value.contains(char::is_whitespace) {
        return Err("constant return expression contains unsupported tokens".to_string());
    }

    let word = match output_type {
        "bool" => match value {
            "true" => Ok(word_from_u64(1)),
            "false" => Ok([0; 32]),
            _ => Err("bool return must be true or false".to_string()),
        },
        "address" => parse_fixed_hex(value, 20),
        "bytes32" => parse_fixed_hex(value, 32),
        "uint64" => {
            let parsed: u64 = value
                .parse()
                .map_err(|_| "u64 return must be an unsigned decimal literal".to_string())?;
            Ok(word_from_u64(parsed))
        }
        "uint256" => parse_u256_decimal(value),
        _ => Err("internal unsupported EVM type".to_string()),
    }?;
    Ok(ReturnValue::Constant(word))
}

fn parse_fixed_hex(value: &str, width: usize) -> Result<[u8; 32], String> {
    let hex_value = value
        .strip_prefix("0x")
        .ok_or_else(|| "hex constant must start with 0x".to_string())?;
    if hex_value.len() != width * 2 {
        return Err(format!("hex constant must contain exactly {} bytes", width));
    }
    let decoded = hex::decode(hex_value).map_err(|_| "invalid hex constant".to_string())?;
    let mut word = [0u8; 32];
    word[32 - width..].copy_from_slice(&decoded);
    Ok(word)
}

fn parse_u256_decimal(value: &str) -> Result<[u8; 32], String> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("u256 return must be an unsigned decimal literal".to_string());
    }
    let mut word = [0u8; 32];
    for digit in value.bytes().map(|byte| byte - b'0') {
        let mut carry = digit as u16;
        for byte in word.iter_mut().rev() {
            let next = (*byte as u16) * 10 + carry;
            *byte = next as u8;
            carry = next >> 8;
        }
        if carry != 0 {
            return Err("u256 literal exceeds 256 bits".to_string());
        }
    }
    Ok(word)
}

fn word_from_u64(value: u64) -> [u8; 32] {
    let mut word = [0u8; 32];
    word[24..].copy_from_slice(&value.to_be_bytes());
    word
}

fn build_runtime(functions: &[CompiledFunction]) -> Result<Vec<u8>, CompileError> {
    let mut code = vec![0x36, 0x60, 0x04, 0x11, 0x61, 0, 0, 0x57];
    let short_calldata_jump = 5;
    code.extend([0x60, 0x00, 0x35, 0x60, 0xe0, 0x1c]);

    let mut destinations = Vec::new();
    for function in functions {
        code.extend([0x80, 0x63]);
        code.extend(function.selector);
        code.extend([0x14, 0x61]);
        destinations.push(code.len());
        code.extend([0, 0, 0x57]);
    }

    let revert_destination = u16_offset(code.len())?;
    code.extend([0x5b, 0x60, 0x00, 0x60, 0x00, 0xfd]);
    patch_u16(&mut code, short_calldata_jump, revert_destination);

    for (function, patch) in functions.iter().zip(destinations) {
        let destination = u16_offset(code.len())?;
        patch_u16(&mut code, patch, destination);
        code.extend([0x5b, 0x50]);
        let expected_calldata = 4usize
            .checked_add(function.inputs.len() * 32)
            .ok_or_else(|| CompileError::one("function calldata size overflow"))?;
        let expected_calldata = u16::try_from(expected_calldata)
            .map_err(|_| CompileError::one("function calldata exceeds v1 size limit"))?;
        code.extend([
            0x61,
            (expected_calldata >> 8) as u8,
            expected_calldata as u8,
            0x36,
            0x14,
            0x61,
        ]);
        let valid_size_patch = code.len();
        code.extend([0, 0, 0x57, 0x60, 0x00, 0x60, 0x00, 0xfd]);
        let valid_size_destination = u16_offset(code.len())?;
        patch_u16(&mut code, valid_size_patch, valid_size_destination);
        code.push(0x5b);

        for (index, input) in function.inputs.iter().enumerate() {
            emit_parameter_load(&mut code, index)?;
            emit_parameter_validation(&mut code, input.evm_type)?;
            code.push(0x50);
        }

        match function.return_value {
            ReturnValue::Constant(word) => {
                code.push(0x7f);
                code.extend(word);
            }
            ReturnValue::Parameter(index) => {
                emit_parameter_load(&mut code, index)?;
            }
        }
        code.extend([0x60, 0x00, 0x52, 0x60, 0x20, 0x60, 0x00, 0xf3]);
    }
    Ok(code)
}

fn emit_parameter_load(code: &mut Vec<u8>, index: usize) -> Result<(), CompileError> {
    let offset = 4usize + index * 32;
    let offset = u16::try_from(offset)
        .map_err(|_| CompileError::one("parameter offset exceeds v1 limit"))?;
    code.extend([0x61, (offset >> 8) as u8, offset as u8, 0x35]);
    Ok(())
}

fn emit_parameter_validation(code: &mut Vec<u8>, evm_type: &str) -> Result<(), CompileError> {
    match evm_type {
        "uint256" | "bytes32" => return Ok(()),
        "uint64" => code.extend([0x80, 0x60, 0x40, 0x1c, 0x15]),
        "address" => code.extend([0x80, 0x60, 0xa0, 0x1c, 0x15]),
        "bool" => code.extend([0x80, 0x60, 0x01, 0x10, 0x15]),
        _ => return Err(CompileError::one("internal unsupported parameter type")),
    }
    code.push(0x61);
    let valid_patch = code.len();
    code.extend([0, 0, 0x57, 0x60, 0x00, 0x60, 0x00, 0xfd]);
    let valid_destination = u16_offset(code.len())?;
    patch_u16(code, valid_patch, valid_destination);
    code.push(0x5b);
    Ok(())
}

fn wrap_deployment(runtime: &[u8]) -> Result<Vec<u8>, CompileError> {
    let length = u16::try_from(runtime.len())
        .map_err(|_| CompileError::one("runtime bytecode exceeds v1 size limit"))?;
    const PREFIX_LEN: u16 = 15;
    let mut deployment = vec![
        0x61,
        (length >> 8) as u8,
        length as u8,
        0x61,
        (PREFIX_LEN >> 8) as u8,
        PREFIX_LEN as u8,
        0x60,
        0x00,
        0x39,
        0x61,
        (length >> 8) as u8,
        length as u8,
        0x60,
        0x00,
        0xf3,
    ];
    deployment.extend(runtime);
    Ok(deployment)
}

fn u16_offset(offset: usize) -> Result<u16, CompileError> {
    u16::try_from(offset).map_err(|_| CompileError::one("runtime jump offset exceeds v1 limit"))
}

fn patch_u16(code: &mut [u8], index: usize, value: u16) {
    code[index] = (value >> 8) as u8;
    code[index + 1] = value as u8;
}

fn build_abi(functions: &[CompiledFunction]) -> serde_json::Value {
    serde_json::Value::Array(
        functions
            .iter()
            .map(|function| {
                serde_json::json!({
                    "type": "function",
                    "name": function.artifact.name,
                    "stateMutability": "pure",
                    "inputs": function.inputs.iter().map(|param| serde_json::json!({
                        "name": param.name,
                        "type": param.evm_type
                    })).collect::<Vec<_>>(),
                    "outputs": [{"name": "", "type": function.output_type}]
                })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_deterministic_deployable_artifact() {
        let source = r#"
            contract Constants {
                pub fn answer() -> u64 { return 42; }
                pub fn ready() -> bool { return true; }
            }
        "#;
        let first = compile(source).expect("compile");
        let second = compile(source).expect("compile again");
        assert_eq!(first, second);
        assert_eq!(first.target, TARGET);
        assert!(first.bytecode.starts_with("0x61"));
        assert!(first.bytecode.ends_with(&first.deployed_bytecode[2..]));
        assert_eq!(first.functions.len(), 2);
        assert_eq!(first.functions[0].signature, "answer()");
        assert_eq!(first.functions[0].selector, "0x85bb7d69");
    }

    #[test]
    fn supports_full_width_u256_and_fixed_hex_constants() {
        let max = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
        let source = format!(
            "contract C {{ pub fn max() -> u256 {{ return {max}; }} pub fn who() -> address {{ return 0x1111111111111111111111111111111111111111; }} }}"
        );
        let artifact = compile(&source).expect("compile");
        assert!(artifact.deployed_bytecode.contains(&"ff".repeat(32)));
        assert!(artifact
            .deployed_bytecode
            .contains("0000000000000000000000001111111111111111111111111111111111111111"));
    }

    #[test]
    fn rejects_every_unsupported_semantic_instead_of_dropping_it() {
        let cases = [
            "contract C { state { value: u64; } pub fn x() -> u64 { return 1; } }",
            "contract C { pub fn x(value: string) -> u64 { return 1; } }",
            "contract C { pub async fn x() -> u64 { return 1; } }",
            "contract C { fn x() -> u64 { return 1; } }",
            "contract C { pub fn x() -> u64 { return 1 + 2; } }",
            "contract C { event Seen { value: u64 } pub fn x() -> u64 { return 1; } }",
        ];
        for source in cases {
            assert!(compile(source).is_err(), "unexpectedly compiled: {source}");
        }
    }

    #[test]
    fn rejects_u256_overflow() {
        let overflow =
            "115792089237316195423570985008687907853269984665640564039457584007913129639936";
        let source = format!("contract C {{ pub fn x() -> u256 {{ return {overflow}; }} }}");
        assert!(compile(&source).is_err());
    }

    #[test]
    fn compiles_static_parameters_into_selector_and_abi() {
        let artifact = compile(
            "contract C { pub fn echo(value: u64, enabled: bool) -> u64 { return value; } }",
        )
        .expect("compile");
        assert_eq!(artifact.functions[0].signature, "echo(uint64,bool)");
        assert_eq!(artifact.functions[0].selector, "0xcb6fb066");
        assert_eq!(artifact.abi[0]["inputs"][0]["name"], "value");
        assert_eq!(artifact.abi[0]["inputs"][0]["type"], "uint64");
        assert_eq!(artifact.abi[0]["inputs"][1]["type"], "bool");
    }

    #[test]
    fn rejects_parameter_return_type_mismatch() {
        let error = compile("contract C { pub fn bad(value: address) -> u64 { return value; } }")
            .expect_err("must reject mismatched parameter return");
        assert!(error
            .to_string()
            .contains("has type address, expected uint64"));
    }

    #[test]
    fn generated_runtime_executes_in_an_independent_evm() {
        use revm::{
            db::BenchmarkDB,
            primitives::{address, Bytecode, Bytes, TxKind},
            Evm,
        };

        let artifact =
            compile("contract C { pub fn answer() -> u64 { return 42; } }").expect("compile");
        let runtime = hex::decode(&artifact.deployed_bytecode[2..]).expect("runtime hex");
        let calldata = hex::decode(&artifact.functions[0].selector[2..]).expect("selector hex");
        let mut evm = Evm::builder()
            .with_db(BenchmarkDB::new_bytecode(Bytecode::new_raw(runtime.into())))
            .modify_tx_env(|tx| {
                tx.caller = address!("1000000000000000000000000000000000000000");
                tx.transact_to = TxKind::Call(address!("0000000000000000000000000000000000000000"));
                tx.data = Bytes::from(calldata);
            })
            .build();

        let result = evm.transact().expect("EVM transaction");
        assert!(
            result.result.is_success(),
            "execution failed: {:?}",
            result.result
        );
        let output = result
            .result
            .output()
            .unwrap_or_else(|| panic!("expected output: {:?}", result.result));
        assert_eq!(output.len(), 32);
        assert_eq!(&output[..24], &[0u8; 24]);
        assert_eq!(&output[24..], &42u64.to_be_bytes());
    }

    #[test]
    fn decodes_and_validates_static_parameter_in_an_independent_evm() {
        use revm::{
            db::BenchmarkDB,
            primitives::{address, Bytecode, Bytes, ExecutionResult, TxKind},
            Evm,
        };

        let artifact = compile("contract C { pub fn echo(value: u64) -> u64 { return value; } }")
            .expect("compile");
        let runtime = hex::decode(&artifact.deployed_bytecode[2..]).expect("runtime hex");
        let mut calldata = hex::decode(&artifact.functions[0].selector[2..]).expect("selector");
        calldata.extend(word_from_u64(42));
        let mut evm = Evm::builder()
            .with_db(BenchmarkDB::new_bytecode(Bytecode::new_raw(
                runtime.clone().into(),
            )))
            .modify_tx_env(|tx| {
                tx.caller = address!("1000000000000000000000000000000000000000");
                tx.transact_to = TxKind::Call(address!("0000000000000000000000000000000000000000"));
                tx.data = Bytes::from(calldata);
            })
            .build();
        let result = evm.transact().expect("EVM transaction");
        assert!(
            result.result.is_success(),
            "execution failed: {:?}",
            result.result
        );
        let output = result.result.output().expect("successful output");
        assert_eq!(&output[24..], &42u64.to_be_bytes());

        let mut malformed = hex::decode(&artifact.functions[0].selector[2..]).expect("selector");
        let mut invalid_u64 = [0u8; 32];
        invalid_u64[0] = 1;
        malformed.extend(invalid_u64);
        let mut evm = Evm::builder()
            .with_db(BenchmarkDB::new_bytecode(Bytecode::new_raw(runtime.into())))
            .modify_tx_env(|tx| {
                tx.caller = address!("1000000000000000000000000000000000000000");
                tx.transact_to = TxKind::Call(address!("0000000000000000000000000000000000000000"));
                tx.data = Bytes::from(malformed);
            })
            .build();
        let result = evm.transact().expect("EVM transaction");
        assert!(matches!(result.result, ExecutionResult::Revert { .. }));
    }

    #[test]
    fn rejects_non_exact_calldata_length() {
        use revm::{
            db::BenchmarkDB,
            primitives::{address, Bytecode, Bytes, ExecutionResult, TxKind},
            Evm,
        };

        let artifact =
            compile("contract C { pub fn answer() -> u64 { return 42; } }").expect("compile");
        let runtime = hex::decode(&artifact.deployed_bytecode[2..]).expect("runtime hex");
        let mut calldata = hex::decode(&artifact.functions[0].selector[2..]).expect("selector");
        calldata.push(0);
        let mut evm = Evm::builder()
            .with_db(BenchmarkDB::new_bytecode(Bytecode::new_raw(runtime.into())))
            .modify_tx_env(|tx| {
                tx.caller = address!("1000000000000000000000000000000000000000");
                tx.transact_to = TxKind::Call(address!("0000000000000000000000000000000000000000"));
                tx.data = Bytes::from(calldata);
            })
            .build();
        let result = evm.transact().expect("EVM transaction");
        assert!(matches!(result.result, ExecutionResult::Revert { .. }));
    }

    #[test]
    fn validates_unused_static_parameters() {
        use revm::{
            db::BenchmarkDB,
            primitives::{address, Bytecode, Bytes, ExecutionResult, TxKind},
            Evm,
        };

        let artifact = compile("contract C { pub fn answer(enabled: bool) -> u64 { return 42; } }")
            .expect("compile");
        let runtime = hex::decode(&artifact.deployed_bytecode[2..]).expect("runtime hex");
        let mut calldata = hex::decode(&artifact.functions[0].selector[2..]).expect("selector");
        calldata.extend(word_from_u64(2));
        let mut evm = Evm::builder()
            .with_db(BenchmarkDB::new_bytecode(Bytecode::new_raw(runtime.into())))
            .modify_tx_env(|tx| {
                tx.caller = address!("1000000000000000000000000000000000000000");
                tx.transact_to = TxKind::Call(address!("0000000000000000000000000000000000000000"));
                tx.data = Bytes::from(calldata);
            })
            .build();
        let result = evm.transact().expect("EVM transaction");
        assert!(matches!(result.result, ExecutionResult::Revert { .. }));
    }

    #[test]
    fn generated_deployment_code_returns_the_exact_runtime() {
        use revm::{
            db::InMemoryDB,
            primitives::{address, AccountInfo, Bytes, TxKind, U256},
            Evm,
        };

        let artifact =
            compile("contract C { pub fn answer() -> u64 { return 42; } }").expect("compile");
        let deployment = hex::decode(&artifact.bytecode[2..]).expect("deployment hex");
        let runtime = hex::decode(&artifact.deployed_bytecode[2..]).expect("runtime hex");
        let caller = address!("1000000000000000000000000000000000000000");
        let mut db = InMemoryDB::default();
        db.insert_account_info(
            caller,
            AccountInfo {
                balance: U256::MAX,
                ..Default::default()
            },
        );
        let mut evm = Evm::builder()
            .with_db(db)
            .modify_tx_env(|tx| {
                tx.caller = caller;
                tx.transact_to = TxKind::Create;
                tx.data = Bytes::from(deployment);
                tx.gas_limit = 1_000_000;
            })
            .build();

        let result = evm.transact().expect("EVM creation transaction");
        let output = result.result.output().expect("creation output");
        assert_eq!(output.as_ref(), runtime.as_slice());
    }
}
