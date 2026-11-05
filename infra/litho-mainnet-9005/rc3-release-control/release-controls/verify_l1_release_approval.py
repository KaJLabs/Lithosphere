#!/usr/bin/env python3
"""Fail closed unless an L1 binary has authenticated pre-activation approvals."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

PLACEHOLDERS = {"", "pending", "tbd", "todo", "unknown", "n/a", "none"}
KAJ_LABS_RELEASE_FINGERPRINT = "073B5DB350EF4BEBD939F24310326AAA1839EAEB"
TARGET_PROFILES = {
    "makalu": {"cosmosChainId": "lithosphere_700777-2", "evmChainId": 700777,
               "validators": {"mtest-val-02"}, "singleValidatorPauseRequired": True},
    # No Kamet validator is authorized until a reviewed identity is added.
    "kamet": {"cosmosChainId": "lithosphere_900523-2", "evmChainId": 900523,
              "validators": set(), "singleValidatorPauseRequired": True},
    "mainnet": {"cosmosChainId": "lithosphere_9005-1", "evmChainId": 9005,
                "validators": {"validator1"}, "singleValidatorPauseRequired": True},
}


def parse_time(value: str, field: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def required_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or value.strip().lower() in PLACEHOLDERS:
        raise ValueError(f"{field} must be a non-placeholder string")
    return value.strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_local_artifact(value: Any, field: str, base_dir: Path) -> Path:
    supplied = Path(required_text(value, field))
    artifact = supplied if supplied.is_absolute() else base_dir / supplied
    resolved = artifact.resolve(strict=True)
    approved_root = base_dir.resolve(strict=True)
    if resolved.parent != approved_root or not resolved.is_file():
        raise ValueError(f"{field} must identify a file directly under the approval directory")
    return resolved


def verify_hashed_approval(entry: Any, field: str, approval_type: str,
                           base_dir: Path, expected: dict[str, Any]) -> datetime:
    if not isinstance(entry, dict):
        raise ValueError(f"{field} must be an object")
    artifact = resolve_local_artifact(entry.get("artifactPath"), f"{field}.artifactPath", base_dir)
    expected_hash = required_text(entry.get("artifactSha256"), f"{field}.artifactSha256").lower()
    if len(expected_hash) != 64 or any(c not in "0123456789abcdef" for c in expected_hash):
        raise ValueError(f"{field}.artifactSha256 must be a lowercase SHA-256")
    if sha256(artifact) != expected_hash:
        raise ValueError(f"{field} artifact SHA-256 mismatch")
    try:
        document = json.loads(artifact.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"{field} must reference structured JSON approval evidence") from exc
    if document.get("schemaVersion") != 1 or document.get("approvalType") != approval_type:
        raise ValueError(f"{field} has the wrong approval schema or type")
    if document.get("decision") != "approved":
        raise ValueError(f"{field}.decision must be approved")
    required_text(document.get("approvalReference"), f"{field}.approvalReference")
    approved_at = parse_time(document.get("approvedAt"), f"{field}.approvedAt")
    for name, value in expected.items():
        if document.get(name) != value:
            raise ValueError(f"{field}.{name} does not match the canonical approval bundle")
    return approved_at


def verify_detached_signature(artifact: Path, signature: Path, public_key: Path) -> None:
    if not public_key.is_file():
        raise ValueError("release-signing public key does not exist")
    with tempfile.TemporaryDirectory(prefix="l1-gate-gpg-") as home:
        env = {**os.environ, "GNUPGHOME": home}
        imported = subprocess.run(["gpg", "--batch", "--quiet", "--import", str(public_key)],
                                  text=True, capture_output=True, env=env, check=False)
        if imported.returncode != 0:
            raise ValueError("unable to import the pinned release-signing public key")
        checked = subprocess.run(
            ["gpg", "--batch", "--status-fd=1", "--verify", str(signature), str(artifact)],
            text=True, capture_output=True, env=env, check=False,
        )
    valid_lines = [line.split() for line in checked.stdout.splitlines()
                   if line.startswith("[GNUPG:] VALIDSIG ")]
    fingerprints = {token.upper() for line in valid_lines for token in line[2:] if len(token) == 40}
    if checked.returncode != 0 or KAJ_LABS_RELEASE_FINGERPRINT not in fingerprints:
        raise ValueError("approval bundle signature is not valid for the pinned KaJ Labs release key")


def verify(approval_path: Path, binary_path: Path, environment: str, at: datetime,
           expected_release_id: str, public_key_path: Path,
           signature_verifier: Callable[[Path, Path, Path], None] = verify_detached_signature) -> dict[str, Any]:
    data = json.loads(approval_path.read_text(encoding="utf-8"))
    if data.get("schemaVersion") != 2:
        raise ValueError("schemaVersion must be 2")
    required_text(data.get("approvalId"), "approvalId")
    release_id = required_text(data.get("releaseId"), "releaseId")
    if release_id != expected_release_id:
        raise ValueError("releaseId does not match the immutable release tag")
    target = required_text(data.get("environment"), "environment").lower()
    if target != environment or target not in TARGET_PROFILES:
        raise ValueError("environment does not match the requested target")
    profile = TARGET_PROFILES[target]
    if data.get("cosmosChainId") != profile["cosmosChainId"] or data.get("evmChainId") != profile["evmChainId"]:
        raise ValueError("chain identity does not match the canonical target profile")
    validator = required_text(data.get("validator"), "validator")
    if validator not in profile["validators"]:
        raise ValueError("validator is not present in the reviewed target profile")
    if data.get("singleValidatorPauseRequired") is not profile["singleValidatorPauseRequired"]:
        raise ValueError("single-validator pause requirement does not match the target profile")
    if profile["singleValidatorPauseRequired"] and data.get("singleValidatorPauseApproved") is not True:
        raise ValueError("target profile requires explicit consensus-pause approval")

    expected_binary = required_text(data.get("binarySha256"), "binarySha256").lower()
    if len(expected_binary) != 64 or any(c not in "0123456789abcdef" for c in expected_binary):
        raise ValueError("binarySha256 must be a lowercase SHA-256")
    if sha256(binary_path) != expected_binary:
        raise ValueError("candidate binary SHA-256 mismatch")
    signature = resolve_local_artifact(data.get("bundleSignaturePath"), "bundleSignaturePath", approval_path.parent)
    signature_verifier(approval_path.resolve(strict=True), signature, public_key_path.resolve(strict=True))

    window = data.get("window")
    if not isinstance(window, dict):
        raise ValueError("window must be an object")
    starts_at = parse_time(window.get("startsAt"), "window.startsAt")
    ends_at = parse_time(window.get("endsAt"), "window.endsAt")
    if starts_at >= ends_at:
        raise ValueError("window must end after it starts")
    if not starts_at <= at <= ends_at:
        raise ValueError("verification time is outside the approved window")

    expected_approval = {
        "releaseId": release_id, "environment": target,
        "cosmosChainId": profile["cosmosChainId"], "evmChainId": profile["evmChainId"],
        "validator": validator, "singleValidatorPauseApproved": data["singleValidatorPauseApproved"],
    }
    autha_at = verify_hashed_approval(data.get("authaApproval"), "authaApproval",
                                      "autha-l1-release", approval_path.parent, expected_approval)
    kaj_at = verify_hashed_approval(data.get("kajLabsApproval"), "kajLabsApproval",
                                    "kaj-labs-l1-release", approval_path.parent, expected_approval)
    if autha_at > starts_at or kaj_at > starts_at:
        raise ValueError("all approvals must predate the activation window")
    operator = required_text(data.get("executionOperator"), "executionOperator")
    observer = required_text(data.get("independentObserver"), "independentObserver")
    if operator.casefold() == observer.casefold():
        raise ValueError("executionOperator and independentObserver must differ")
    return {
        "approvalId": data["approvalId"], "releaseId": release_id, "environment": target,
        "validator": validator, "binarySha256": expected_binary,
        "verifiedAt": at.isoformat().replace("+00:00", "Z"),
        "windowStartsAt": starts_at.isoformat().replace("+00:00", "Z"),
        "windowEndsAt": ends_at.isoformat().replace("+00:00", "Z"), "result": "approved",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--approval", required=True, type=Path)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--environment", required=True, choices=sorted(TARGET_PROFILES))
    parser.add_argument("--expected-release-id", required=True)
    parser.add_argument("--release-signing-public-key", required=True, type=Path)
    parser.add_argument("--at", help="UTC verification time; defaults to now")
    args = parser.parse_args()
    at = parse_time(args.at, "--at") if args.at else datetime.now(timezone.utc)
    try:
        result = verify(args.approval, args.binary, args.environment, at,
                        args.expected_release_id, args.release_signing_public_key)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"L1_RELEASE_GATE=denied reason={exc}")
        return 1
    print(json.dumps(result, sort_keys=True))
    print("L1_RELEASE_GATE=approved")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
