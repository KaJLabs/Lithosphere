//! Experimental local execution format. Not a production LithoVM ABI.

const HEADER: &[u8; 8] = b"LITHLAB\x01";
const RETURN_U64: u8 = 1;
pub const EXECUTION_COST: u64 = 1;

/// Compile exactly one public, zero-argument u64 constant-return function.
/// No source tokens may be discarded, including unsupported annotations.
pub fn compile(source: &str) -> Result<Vec<u8>, &'static str> {
    if source.len() > 4096 || !source.is_ascii() {
        return Err("source exceeds the experimental ASCII/size boundary");
    }
    let mut spaced = String::new();
    for c in source.chars() {
        if "{}();->".contains(c) {
            spaced.push(' ');
            spaced.push(c);
            spaced.push(' ');
        } else {
            spaced.push(c);
        }
    }
    let tokens: Vec<_> = spaced.split_whitespace().collect();
    if tokens.len() != 17
        || tokens[0] != "contract"
        || tokens[2] != "{"
        || tokens[3] != "pub"
        || tokens[4] != "fn"
        || tokens[6..13] != ["(", ")", "-", ">", "u64", "{", "return"]
        || tokens[14..17] != [";", "}", "}"]
    {
        return Err("unsupported syntax: expected one pub fn returning a u64 literal");
    }
    let identifier = |name: &str| {
        let mut chars = name.chars();
        matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    };
    if !identifier(tokens[1]) || !identifier(tokens[5]) {
        return Err("invalid identifier");
    }
    if !tokens[13].bytes().all(|b| b.is_ascii_digit()) {
        return Err("expected unsigned decimal literal");
    }
    let value: u64 = tokens[13].parse().map_err(|_| "literal exceeds u64")?;
    let mut bytes = HEADER.to_vec();
    bytes.push(RETURN_U64);
    bytes.extend_from_slice(&value.to_be_bytes());
    Ok(bytes)
}

/// Execute a validated laboratory artifact. No storage, calls, I/O or signing.
pub fn execute(bytes: &[u8], gas_limit: u64) -> Result<u64, &'static str> {
    if bytes.len() != 17 || &bytes[..8] != HEADER || bytes[8] != RETURN_U64 {
        return Err("invalid laboratory artifact, version, length or opcode");
    }
    if gas_limit < EXECUTION_COST {
        return Err("out of gas");
    }
    Ok(u64::from_be_bytes(bytes[9..17].try_into().unwrap()))
}

#[cfg(test)]
mod tests {
    use super::*;
    const SOURCE: &str = "contract Answer { pub fn value() -> u64 { return 42; } }";

    #[test]
    fn compiler_matches_independent_wire_vector_and_vm_returns_value() {
        let expected = [76, 73, 84, 72, 76, 65, 66, 1, 1, 0, 0, 0, 0, 0, 0, 0, 42];
        assert_eq!(compile(SOURCE).unwrap(), expected);
        assert_eq!(execute(&expected, 1), Ok(42));
        assert_eq!(execute(&expected, 0), Err("out of gas"));
    }

    #[test]
    fn rejects_unsupported_authorization_and_bodies() {
        for source in [
            format!("requires TOKEN_TRANSFER {SOURCE}"),
            format!("{SOURCE} contract Extra {{}}"),
            SOURCE.replace("42", "1 + 41"),
            SOURCE.replace("u64", "u256"),
            SOURCE.replace("42", "18446744073709551616"),
            SOURCE.replace("42", "-1"),
            SOURCE.replace("42", "call()"),
            SOURCE.replace("pub", "public"),
        ] {
            assert!(compile(&source).is_err(), "accepted {source}");
        }
    }

    #[test]
    fn rejects_malformed_and_old_dummy_bytecode() {
        let valid = compile(SOURCE).unwrap();
        for length in 0..valid.len() {
            assert!(execute(&valid[..length], 1).is_err());
        }
        for position in 0..9 {
            let mut bad = valid.clone();
            bad[position] ^= 255;
            assert!(execute(&bad, 1).is_err());
        }
        let mut extended = valid;
        extended.push(0);
        assert!(execute(&extended, 1).is_err());
        assert!(execute(b"LITHOVM00000000000000000000000000000000", 1).is_err());
    }

    #[test]
    fn numeric_boundaries_and_whitespace_are_deterministic() {
        for value in [0, 1, u64::MAX] {
            let source = SOURCE.replace("42", &value.to_string());
            let bytes = compile(&source).unwrap();
            assert_eq!(execute(&bytes, 1), Ok(value));
            assert_eq!(compile(&source.replace(' ', "\n\t")).unwrap(), bytes);
        }
    }
}
