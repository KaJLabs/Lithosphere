import { Contract, Interface, Transaction, keccak256 } from 'ethers';
import { createNativeEvidenceVerifier } from './nativeEvidence.js';
import { resolveNativeChain } from './nativePolicy.js';
import { settlementIdentity } from './nativeSettlementPolicy.js';

const identity = 'bytes32 operationId,uint256 sourceChain,address sourceVault,address sourceDepositor,uint256 sourceNonce,bytes32 clientReference,bytes32 sourceTxHash';
export const NATIVE_RELAY_ABI = [
  `function releaseNative((${identity},uint256 sourceAmount,address recipient,uint256 outputAmount,uint64 sourceQuoteExpiry,uint64 releaseDeadline,uint64 authorizationExpiry) request,bytes[] signatures)`,
  `function cancelRelease((${identity},uint64 sourceQuoteExpiry,uint64 releaseDeadline,uint64 authorizationExpiry) request,bytes[] signatures)`,
  'function finalizeDeposit(bytes32 operationId,bytes32 destinationTxHash,bytes[] signatures)',
  'function refundDeposit((bytes32 operationId,bytes32 cancellationTxHash,bytes32 cancellationBlockHash,uint256 cancellationBlockNumber,uint64 authorizationExpiry) request,bytes[] signatures)',
  'function availableLiquidity() view returns(uint256)',
  'function dailyPayoutCap() view returns(uint256)',
];
const iface = new Interface(NATIVE_RELAY_ABI);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// One operator-reviewed transaction, never a background retry loop. Raw transaction
// signing takes place outside this process; it never receives a wallet private key.
export async function relayNativeOnce({ policy, packet, approval, rawTransaction, provider,
  journal, enabled = false, now = () => Math.floor(Date.now() / 1000),
  verifier = createNativeEvidenceVerifier(policy),
  contractFactory = (address, rpc) => new Contract(address, NATIVE_RELAY_ABI, rpc),
}) {
  if (enabled !== true) throw new Error('native relay is disabled');
  // Snapshot caller inputs before asynchronous checks.
  packet = JSON.parse(JSON.stringify(packet));
  approval = JSON.parse(JSON.stringify(approval));
  const { operation, request, destination, evidence, signatures, action } = packet;
  settlementIdentity(operation);
  const source = resolveNativeChain(policy, operation.sourceChain, operation.sourceVault);
  const target = resolveNativeChain(policy, destination.chainId, destination.vault);
  if (source.chainId === target.chainId) throw new Error('cross-chain route required');
  if (!Array.isArray(signatures) || signatures.length !== 3) throw new Error('exactly three certificates required');
  let method, args, chain, verify;
  if (action === 'release') {
    method = 'releaseNative'; args = [operation, signatures]; chain = target;
    verify = () => verifier.verifyRelease(operation, target, evidence);
  } else if (action === 'cancel') {
    method = 'cancelRelease'; args = [request, signatures]; chain = target;
    for (const key of ['operationId', 'sourceChain', 'sourceVault', 'sourceDepositor',
      'sourceNonce', 'clientReference', 'sourceTxHash', 'sourceQuoteExpiry', 'releaseDeadline']) {
      if (!same(request?.[key], operation[key])) throw new Error('cancellation identity mismatch');
    }
    verify = () => verifier.verifyCancellation(operation, target, evidence);
  } else if (action === 'finalize') {
    method = 'finalizeDeposit'; args = [operation.operationId, packet.destinationTxHash, signatures]; chain = source;
    verify = () => verifier.verifyFinalization(operation, source, target,
      { ...evidence, expectedDestinationTxHash: packet.destinationTxHash });
  } else if (action === 'refund') {
    if (!same(request?.operationId, operation.operationId)) throw new Error('refund identity mismatch');
    method = 'refundDeposit'; args = [request, signatures]; chain = source;
    verify = () => verifier.verifyRefund(request, operation, source, target, evidence);
  } else throw new Error('unsupported native relay action');

  const tx = Transaction.from(rawTransaction);
  if (!tx.isSigned() || ![0, 2].includes(tx.type) || tx.value !== 0n || tx.chainId !== BigInt(chain.chainId) ||
      !same(tx.to, chain.vault) || !same(tx.data, iface.encodeFunctionData(method, args))) {
    throw new Error('signed relay transaction does not match exact vault action');
  }
  if (!same(approval.operationId, operation.operationId) || approval.action !== action ||
      !same(approval.transactionHash, tx.hash) || !same(approval.relayer, tx.from) ||
      !same(approval.quoteSigner, policy.quoteSigner) || !same(approval.authorityEpoch, policy.authorityEpoch)) {
    throw new Error('relay approval identity mismatch');
  }
  const checkWindow = () => {
    const time = now();
    if (!Number.isSafeInteger(approval.start) || !Number.isSafeInteger(approval.end) ||
        approval.end <= approval.start || time < approval.start || time >= approval.end) {
      throw new Error('outside approved relay window');
    }
    const expiry = action === 'release' ? operation.authorizationExpiry : request?.authorizationExpiry;
    if (action !== 'finalize' && (!Number.isSafeInteger(Number(expiry)) || time >= Number(expiry))) {
      throw new Error('relay certificate expired');
    }
    if (action === 'release' && time >= Number(operation.releaseDeadline)) throw new Error('release deadline passed');
  };
  checkWindow();
  // The durable claim precedes all RPC work; uncertainty cannot trigger a retry.
  await journal.claim({ operationId: operation.operationId, action, transactionHash: tx.hash });
  try {
    if (Number(BigInt(await provider.send('eth_chainId', []))) !== chain.chainId) throw new Error('relay RPC chain mismatch');
    if (!/^0x[0-9a-fA-F]{64}$/.test(approval.runtimeHash || '') ||
        !same(keccak256(await provider.getCode(chain.vault)), approval.runtimeHash)) {
      throw new Error('relay vault runtime mismatch');
    }
    await verify();
    // eth_call also checks current quorum, route, cap, expiry and terminal state.
    await provider.call({ from: tx.from, to: tx.to, data: tx.data, value: 0n });
    if (action === 'release') {
      const vault = contractFactory(chain.vault, provider);
      const [liquidity, cap] = await Promise.all([vault.availableLiquidity(), vault.dailyPayoutCap()]);
      if (!/^[1-9][0-9]*$/.test(String(approval.maxOutputWei || ''))) throw new Error('finite canary ceiling required');
      const amount = BigInt(operation.outputAmount);
      if (amount <= 0n || amount > BigInt(approval.maxOutputWei) || amount > BigInt(liquidity) / 10n ||
          amount > BigInt(cap) / 10n) throw new Error('canary payout ceiling exceeded');
    }
    // Independently re-resolve finality after all other network reads, immediately
    // before handing the exact signed transaction to the RPC broadcaster.
    await verify();
    checkWindow();
    await journal.record('BROADCAST_ATTEMPT');
    const result = await provider.broadcastTransaction(rawTransaction);
    if (!same(result.hash, tx.hash)) throw new Error('broadcast transaction hash mismatch');
    await journal.record('SUBMITTED');
    return { operationId: operation.operationId, action, transactionHash: tx.hash, status: 'SUBMITTED' };
  } catch {
    // Never expose RPC exceptions (they may contain credential-bearing URLs).
    // Includes ambiguous broadcast outcomes: reconcile manually, never auto-refund.
    await journal.record('HOLD');
    throw new Error('native relay on HOLD; no retry or automatic refund; reconcile private evidence');
  }
}
