use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn source_file(label: &str, source: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock")
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "lithlint-{label}-{}-{nonce}.lithic",
        std::process::id()
    ));
    fs::write(&path, source).expect("write Lithic fixture");
    path
}

#[test]
fn deny_warnings_fails_when_a_finding_is_reported() {
    let path = source_file("finding", "contract bad_name {}");
    let output = Command::new(env!("CARGO_BIN_EXE_lithlint"))
        .arg("--deny-warnings")
        .arg(&path)
        .output()
        .expect("run lithlint");
    fs::remove_file(&path).expect("remove Lithic fixture");

    assert!(!output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("L001 contract `bad_name`"),
        "stdout: {stdout}"
    );
}

#[test]
fn multiple_input_files_are_rejected_instead_of_silently_ignoring_one() {
    let first = source_file("first", "contract First {}");
    let second = source_file("second", "contract Second {}");
    let output = Command::new(env!("CARGO_BIN_EXE_lithlint"))
        .arg(&first)
        .arg(&second)
        .output()
        .expect("run lithlint");
    fs::remove_file(&first).expect("remove first Lithic fixture");
    fs::remove_file(&second).expect("remove second Lithic fixture");

    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("multiple input files are not supported"),
        "stderr: {stderr}"
    );
}
