# Destination bridge settlement evidence

destinationSettlement.js verifies the existing TokensReleased receipt against
operator-owned deployment policy and coordinator-owned settlement expectations.
It requires the correct chain and bridge runtime hash, successful receipt, one
matching release event, source chain/bridge/lock identity, token, holder, amount,
confirmations, canonical block and historical token balance credit. Canonicality
is checked again after balance reads. It makes no transactions.

This is a bridge-leg verifier, not full native swap readiness. The result must be
bound durably to its swap/source assignment before use. It is currently unwired:
no database readiness transition or public endpoint consumes this result.

The configured token must separately be verified against deployment policy;
bridge runtime identity alone does not authenticate the token or its backing.
Historical balance credit is conservative and can reject same-block spending.
The adapter targets direct calls to a non-proxy bridge; proxy verification and
batched multi-release transactions require separately supported adapters.
Tests use synthetic RPC receipts, not production deployments.

Launch blockers remain: approved deployed contracts and funded liquidity,
destination execution adapter and quote protection, durable settlement/policy
binding, then end-to-end native swap rehearsal and consolidated audit/approval.
Passing a bridge receipt must never itself enable a route or complete a swap.
