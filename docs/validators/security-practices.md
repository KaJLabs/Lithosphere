# Security Practices

## Overview

This document describes the security baselines, policies, and cryptographic practices that underpin the Lithosphere network. It covers supply chain security, secret management, access control, vulnerability scanning, cryptographic primitives, and incident response.

---

## SLSA Compliance (Target: Level 3)

Lithosphere targets [SLSA](https://slsa.dev/) Level 3 compliance for its build and release pipeline, providing strong guarantees about the integrity and provenance of all released artifacts.

| Practice | Description |
|----------|-------------|
| **Provenance Generation** | Every build produces a signed provenance attestation describing the source, build process, and materials used. |
| **Artifact Signing** | All release artifacts are signed using [Cosign](https://github.com/sigstore/cosign), enabling consumers to verify authenticity before deployment. |
| **Build Isolation** | Builds run in ephemeral, isolated environments to prevent tampering. Build environments are not reused across builds. |
| **SBOM Generation** | A Software Bill of Materials (SBOM) is generated for every release, listing all dependencies and their versions. |

---

## Secret Management

### Policy

All secrets **must** be stored in HashiCorp Vault. No exceptions.

### Rotation Schedule

| Secret Type | Rotation Interval |
|-------------|-------------------|
| API keys | 90 days |
| Signing keys | Annual |
| TLS certificates | 90 days (automated) |
| Root CA certificates | 5 years |

### Prohibited Practices

The following practices are strictly prohibited and will be flagged during code review and CI checks:

- **Secrets in code** -- No credentials, API keys, tokens, or private keys may be committed to version control, even in encrypted form.
- **Shared credentials** -- Each service and operator must use unique credentials. Sharing credentials across services or team members is not permitted.
- **Long-lived tokens** -- All tokens must have an expiration. Permanent or excessively long-lived tokens are not allowed. Use short-lived tokens with automated renewal wherever possible.

---

## Access Control

### Git (Source Control)

- **GitHub Teams** -- Repository access is managed through GitHub Teams with the principle of least privilege.
- **Branch Protection** -- Critical branches are protected with mandatory review and status check requirements.

### Kubernetes

- **RBAC** -- Role-Based Access Control is enforced across all clusters. Service accounts are scoped to the minimum required permissions.
- **Namespace Isolation** -- Workloads are isolated into namespaces with resource quotas and network policies.

### AWS

- **IAM with OIDC** -- AWS access uses IAM roles federated through OIDC (OpenID Connect), eliminating the need for long-lived AWS credentials.

### Vault

- **Policy-based AppRole** -- Services authenticate to Vault using AppRole with policies scoped to the specific secrets they require. No service has access to secrets beyond its operational needs.

---

## Branch Protection for Mainnet

The mainnet release branch enforces the following protections:

| Rule | Requirement |
|------|-------------|
| **Approving reviews** | Minimum 2 approving reviews from designated reviewers |
| **Signed commits** | All commits must be GPG-signed |
| **Status checks** | All CI status checks must pass before merge |
| **Linear history** | Merge commits are disallowed; rebase or squash merges only |

These protections ensure that no single individual can push changes to the mainnet release pipeline without peer review and automated validation.

---

## Network Security

| Layer | Implementation |
|-------|----------------|
| **WAF + DDoS Protection** | Web Application Firewall and DDoS mitigation at the edge layer |
| **Network Policies** | Default-deny network policies in Kubernetes; only explicitly allowed traffic is permitted |
| **mTLS** | Mutual TLS enforced between all services via Istio service mesh |
| **Egress Allowlist** | Outbound traffic is restricted to an explicit allowlist of approved destinations |

---

## Vulnerability Scanning

Lithosphere employs multiple layers of vulnerability scanning across the entire software lifecycle:

| Tool | Scope | Frequency | Enforcement |
|------|-------|-----------|-------------|
| **Trivy** | Container images and filesystem | Every build | Blocks on CRITICAL and HIGH severity findings |
| **Dependabot** | Dependency vulnerabilities | Daily | Automated pull requests for updates |
| **Slither** | Smart contract static analysis | Every build | Findings reviewed before merge |
| **Checkov** | Infrastructure as Code (IaC) | Every build | Flags misconfigurations in Terraform, Kubernetes manifests |
| **Falco** | Runtime anomaly detection | Continuous | Alerts on suspicious runtime behavior in production |

---

## Cryptographic Security

### Threshold Secret Sharing

Lithosphere uses threshold secret-sharing schemes to distribute sensitive cryptographic material across multiple parties. No single party holds enough information to reconstruct the full secret, ensuring resilience against compromise of individual nodes.

### Elliptic Curve Cryptography

All cryptographic operations in the Lithosphere network use elliptic curve cryptography (ECC). ECC provides strong security guarantees with smaller key sizes compared to RSA, resulting in faster computations and lower bandwidth requirements.

### Ring Signatures

> **Status**: Ring signatures are part of the Lithosphere protocol design and roadmap. Not yet implemented on the Makalu testnet.

Ring signatures are designed for the Lithosphere network to provide **transaction anonymity**. A ring signature allows a member of a group to sign a message on behalf of the group without revealing which specific member produced the signature. This provides:

- **Signer anonymity** -- The actual signer is indistinguishable from other members of the ring.
- **No coordination required** -- Ring signatures do not require setup or cooperation from other ring members.
- **Unlinkability** -- Multiple signatures by the same signer cannot be linked together.

---

## Locked Account Security

Locked accounts in the Lithosphere network are secured using **Shamir's Secret Sharing**:

- The account's private key is split into multiple shares distributed across validators.
- A threshold number of shares (e.g., 3 of 5) must be combined to reconstruct the key and authorize transactions.
- The system is **fully decentralized** -- no third party is involved in key management or recovery.
- The scheme remains **secure and stable even when some validators are offline**, as long as the threshold number of shares remains available.

This approach ensures that locked accounts cannot be unilaterally accessed by any single validator, while remaining recoverable as long as a sufficient number of validators are operational.

---

## Incident Response

### Severity Levels

| Level | Description | Response Time | Example |
|-------|-------------|---------------|---------|
| **P1 -- Critical** | Active exploit, data breach, or complete service outage | 15 minutes | Validator key compromise, chain halt |
| **P2 -- High** | Significant degradation or vulnerability with known exploit | 1 hour | Consensus instability, critical CVE in production |
| **P3 -- Medium** | Moderate impact, no immediate risk of exploit | 4 hours | Non-critical vulnerability, partial service degradation |
| **P4 -- Low** | Minor issue, informational finding | 1 business day | Cosmetic issue, best-practice deviation |

### Escalation Matrix

1. **Detection** -- Automated alerts (Prometheus/AlertManager/Falco) or manual report.
2. **Triage** -- On-call engineer assesses severity and assigns the appropriate level.
3. **Response** -- Incident response team is assembled based on severity:
   - P1/P2: Immediate page to on-call + engineering lead + security team.
   - P3: Notification to the responsible team during business hours.
   - P4: Logged and prioritized in the next sprint.
4. **Mitigation** -- Immediate actions to contain the impact (e.g., key rotation, service isolation, traffic blocking).
5. **Resolution** -- Root cause analysis and permanent fix deployed.
6. **Post-mortem** -- Blameless post-incident review within 48 hours (P1/P2) or 1 week (P3/P4), with action items tracked to completion.
