import {
  AbiCoder,
  ZeroAddress,
  getAddress,
  getBytes,
  keccak256,
  toUtf8Bytes,
} from 'ethers';

const coder = AbiCoder.defaultAbiCoder();
const RELEASE_ACTION = keccak256(toUtf8Bytes('MULTX_NATIVE_RELEASE_V1'));
const CANCEL_ACTION = keccak256(toUtf8Bytes('MULTX_NATIVE_CANCEL_V1'));
const FINALIZE_ACTION = keccak256(toUtf8Bytes('MULTX_NATIVE_FINALIZE_V1'));
const REFUND_ACTION = keccak256(toUtf8Bytes('MULTX_NATIVE_REFUND_V1'));
const OPERATION_ACTION = keccak256(toUtf8Bytes('MULTX_NATIVE_OPERATION_V2'));

const bytes32 = (value, label) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value || '')) throw new Error(`${label} must be bytes32`);
  return value.toLowerCase();
};
const address = (value, label) => {
  const normalized = getAddress(value || '');
  if (normalized === ZeroAddress) throw new Error(`${label} must be non-zero`);
  return normalized;
};
const uint = (value, label, { positive = true } = {}) => {
  const text = String(value ?? '');
  if (!/^(0|[1-9][0-9]*)$/.test(text) || (positive && text === '0')) {
    throw new Error(`${label} must be ${positive ? 'a positive' : 'an'} integer`);
  }
  return BigInt(text);
};

export function settlementIdentity(input) {
  const result = {
    operationId: bytes32(input?.operationId, 'operationId'),
    sourceChain: uint(input?.sourceChain, 'sourceChain'),
    sourceVault: address(input?.sourceVault, 'sourceVault'),
    sourceDepositor: address(input?.sourceDepositor, 'sourceDepositor'),
    sourceNonce: uint(input?.sourceNonce, 'sourceNonce', { positive: false }),
    clientReference: bytes32(input?.clientReference, 'clientReference'),
    sourceTxHash: bytes32(input?.sourceTxHash, 'sourceTxHash'),
    sourceQuoteExpiry: uint(input?.sourceQuoteExpiry, 'sourceQuoteExpiry'),
    releaseDeadline: uint(input?.releaseDeadline, 'releaseDeadline'),
  };
  const derived = keccak256(coder.encode(
    ['uint256', 'address', 'address', 'uint256', 'bytes32'],
    [result.sourceChain, result.sourceVault, result.sourceDepositor, result.sourceNonce, result.clientReference],
  ));
  if (derived !== result.operationId) throw new Error('operationId does not match canonical source identity');
  if (result.releaseDeadline !== result.sourceQuoteExpiry) {
    throw new Error('release deadline must equal source quote expiry');
  }
  return result;
}

export function nativeDecisionKey(operationId) {
  return `native:${bytes32(operationId, 'operationId')}`;
}

function releaseRequest(input) {
  const identity = settlementIdentity(input);
  return {
    ...identity,
    sourceAmount: uint(input?.sourceAmount, 'sourceAmount'),
    recipient: address(input?.recipient, 'recipient'),
    outputAmount: uint(input?.outputAmount, 'outputAmount'),
    authorizationExpiry: uint(input?.authorizationExpiry, 'authorizationExpiry'),
  };
}

function cancelRequest(input) {
  const identity = settlementIdentity(input);
  return { ...identity, authorizationExpiry: uint(input?.authorizationExpiry, 'authorizationExpiry') };
}

export function operationCommitment(operation, destination) {
  const item = releaseRequest(operation);
  const authorityEpoch = bytes32(destination?.authorityEpoch, 'authorityEpoch');
  const targetChain = uint(destination?.chainId, 'destinationChain');
  const targetVault = address(destination?.vault, 'destinationVault');
  return keccak256(coder.encode(
    ['bytes32', 'bytes32', 'uint256', 'address', 'address', 'uint256', 'bytes32', 'bytes32',
      'uint256', 'address', 'uint256', 'uint64', 'uint256', 'address', 'bytes32'],
    [OPERATION_ACTION, item.operationId, item.sourceChain, item.sourceVault, item.sourceDepositor,
      item.sourceNonce, item.clientReference, item.sourceTxHash, item.sourceAmount, item.recipient,
      item.outputAmount, item.sourceQuoteExpiry, targetChain, targetVault, authorityEpoch],
  ));
}

function assertSameIdentity(request, operation) {
  for (const field of ['operationId', 'sourceVault', 'sourceDepositor', 'clientReference', 'sourceTxHash']) {
    if (String(request[field]).toLowerCase() !== String(operation[field]).toLowerCase()) {
      throw new Error(`cancellation ${field} does not match immutable operation`);
    }
  }
  for (const field of ['sourceChain', 'sourceNonce', 'sourceQuoteExpiry', 'releaseDeadline']) {
    if (BigInt(request[field]) !== BigInt(operation[field])) {
      throw new Error(`cancellation ${field} does not match immutable operation`);
    }
  }
}

export function releaseDigest(input, destinationChain, destinationVault) {
  const r = releaseRequest(input);
  const requestHash = keccak256(coder.encode(
    ['tuple(bytes32 operationId,uint256 sourceChain,address sourceVault,address sourceDepositor,uint256 sourceNonce,bytes32 clientReference,bytes32 sourceTxHash,uint256 sourceAmount,address recipient,uint256 outputAmount,uint64 sourceQuoteExpiry,uint64 releaseDeadline,uint64 authorizationExpiry)'],
    [[r.operationId, r.sourceChain, r.sourceVault, r.sourceDepositor, r.sourceNonce, r.clientReference,
      r.sourceTxHash, r.sourceAmount, r.recipient, r.outputAmount, r.sourceQuoteExpiry, r.releaseDeadline, r.authorizationExpiry]],
  ));
  return keccak256(coder.encode(
    ['bytes32', 'bytes32', 'uint256', 'address'],
    [RELEASE_ACTION, requestHash, uint(destinationChain, 'destinationChain'), address(destinationVault, 'destinationVault')],
  ));
}

export function cancelDigest(input, destinationChain, destinationVault) {
  const r = cancelRequest(input);
  const requestHash = keccak256(coder.encode(
    ['tuple(bytes32 operationId,uint256 sourceChain,address sourceVault,address sourceDepositor,uint256 sourceNonce,bytes32 clientReference,bytes32 sourceTxHash,uint64 sourceQuoteExpiry,uint64 releaseDeadline,uint64 authorizationExpiry)'],
    [[r.operationId, r.sourceChain, r.sourceVault, r.sourceDepositor, r.sourceNonce,
      r.clientReference, r.sourceTxHash, r.sourceQuoteExpiry, r.releaseDeadline, r.authorizationExpiry]],
  ));
  return keccak256(coder.encode(
    ['bytes32', 'bytes32', 'uint256', 'address'],
    [CANCEL_ACTION, requestHash, uint(destinationChain, 'destinationChain'), address(destinationVault, 'destinationVault')],
  ));
}

export function finalizeDigest(operationId, destinationTxHash, sourceChain, sourceVault) {
  return keccak256(coder.encode(
    ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
    [FINALIZE_ACTION, bytes32(operationId, 'operationId'), bytes32(destinationTxHash, 'destinationTxHash'),
      uint(sourceChain, 'sourceChain'), address(sourceVault, 'sourceVault')],
  ));
}

export function refundDigest(request, deposit, sourceChain, sourceVault) {
  const operationId = bytes32(request?.operationId, 'operationId');
  const cancellationTxHash = bytes32(request?.cancellationTxHash, 'cancellationTxHash');
  const cancellationBlockHash = bytes32(request?.cancellationBlockHash, 'cancellationBlockHash');
  const cancellationBlockNumber = uint(request?.cancellationBlockNumber, 'cancellationBlockNumber');
  const authorizationExpiry = uint(request?.authorizationExpiry, 'authorizationExpiry');
  const depositHash = keccak256(coder.encode(
    ['address', 'address', 'uint256', 'uint256', 'uint256', 'uint64', 'address', 'uint64'],
    [address(deposit?.depositor, 'deposit.depositor'), address(deposit?.recipient, 'deposit.recipient'),
      uint(deposit?.amount, 'deposit.amount'), uint(deposit?.targetChain, 'deposit.targetChain'),
      uint(deposit?.quotedOutput, 'deposit.quotedOutput'), uint(deposit?.quoteExpiry, 'deposit.quoteExpiry'),
      address(deposit?.targetVault, 'deposit.targetVault'), uint(deposit?.finalityDelaySeconds, 'deposit.finalityDelaySeconds')],
  ));
  const requestHash = keccak256(coder.encode(
    ['tuple(bytes32 operationId,bytes32 cancellationTxHash,bytes32 cancellationBlockHash,uint256 cancellationBlockNumber,uint64 authorizationExpiry)'],
    [[operationId, cancellationTxHash, cancellationBlockHash, cancellationBlockNumber, authorizationExpiry]],
  ));
  return keccak256(coder.encode(
    ['bytes32', 'bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
    [REFUND_ACTION, operationId, depositHash, requestHash,
      uint(sourceChain, 'sourceChain'), address(sourceVault, 'sourceVault')],
  ));
}

export function createNativeSettlementDecision({ journal, signer, now = () => Math.floor(Date.now() / 1000) }) {
  let queue = Promise.resolve();
  const decide = task => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };
  const verifyTwice = async (verifyEvidence, persist, digest) => {
    await verifyEvidence();
    await persist();
    await verifyEvidence();
    return signer.signMessage(getBytes(digest));
  };

  return {
    signRelease(input, destination, verifyEvidence) {
      return decide(async () => {
        const request = releaseRequest(input);
        const time = BigInt(now());
        if (time > request.releaseDeadline) throw new Error('release deadline passed');
        if (request.authorizationExpiry < time || request.authorizationExpiry > request.releaseDeadline) {
          throw new Error('invalid release authorization window');
        }
        const key = nativeDecisionKey(request.operationId);
        const operationHash = operationCommitment(request, destination);
        const digest = releaseDigest(request, destination.chainId, destination.vault);
        return verifyTwice(verifyEvidence, () => journal.transition({
          key, state: 'RELEASE_AUTHORIZED', operationHash, decisionHash: digest,
          authorityEpoch: bytes32(destination.authorityEpoch, 'authorityEpoch'),
          authorizationExpiry: Number(request.authorizationExpiry),
        }), digest);
      });
    },
    signCancellation(input, operation, destination, verifyEvidence) {
      return decide(async () => {
        const request = cancelRequest(input);
        const immutable = releaseRequest(operation);
        assertSameIdentity(request, immutable);
        const time = BigInt(now());
        if (time <= request.releaseDeadline) throw new Error('release window remains active');
        if (request.authorizationExpiry < time) throw new Error('cancellation authorization expired');
        const key = nativeDecisionKey(request.operationId);
        const prior = journal.get(key);
        if (prior?.state === 'PAYOUT_FINALIZED' || prior?.state === 'REFUND_AUTHORIZED') {
          throw new Error(`operation already terminal as ${prior.state}`);
        }
        if (prior?.state === 'RELEASE_AUTHORIZED' && time <= BigInt(prior.authorizationExpiry)) {
          throw new Error('recorded release authorization remains executable');
        }
        const operationHash = operationCommitment(immutable, destination);
        const digest = cancelDigest(request, destination.chainId, destination.vault);
        return verifyTwice(verifyEvidence, () => journal.transition({
          key, state: 'CANCELLATION_AUTHORIZED', operationHash, decisionHash: digest,
          authorityEpoch: bytes32(destination.authorityEpoch, 'authorityEpoch'),
          authorizationExpiry: Number(request.authorizationExpiry),
        }), digest);
      });
    },
    signFinalization({ operation, destinationTxHash, source, destination }, verifyEvidence) {
      return decide(async () => {
        const immutable = releaseRequest(operation);
        const key = nativeDecisionKey(immutable.operationId);
        const prior = journal.get(key);
        if (prior?.state === 'REFUND_AUTHORIZED') {
          throw new Error(`operation already committed to recovery as ${prior.state}`);
        }
        const operationHash = operationCommitment(immutable, destination);
        const digest = finalizeDigest(immutable.operationId, destinationTxHash, source.chainId, source.vault);
        return verifyTwice(verifyEvidence, () => journal.transition({
          key, state: 'PAYOUT_FINALIZED', operationHash, decisionHash: digest,
          authorityEpoch: bytes32(destination.authorityEpoch, 'authorityEpoch'), authorizationExpiry: 0,
        }), digest);
      });
    },
    signRefund({ request, deposit, identity, source, destination, cancellation }, verifyEvidence) {
      return decide(async () => {
        const item = settlementIdentity(identity);
        if (String(request.operationId).toLowerCase() !== item.operationId) throw new Error('refund operation mismatch');
        const time = BigInt(now());
        const expiry = uint(request.authorizationExpiry, 'authorizationExpiry');
        if (expiry < time) throw new Error('refund authorization expired');
        const eligibleAt = uint(deposit.quoteExpiry, 'deposit.quoteExpiry') + uint(deposit.finalityDelaySeconds, 'finalityDelaySeconds');
        if (time <= eligibleAt) throw new Error('destination cancellation is not final');
        if (String(cancellation.txHash).toLowerCase() !== String(request.cancellationTxHash).toLowerCase() ||
            String(cancellation.blockHash).toLowerCase() !== String(request.cancellationBlockHash).toLowerCase() ||
            BigInt(cancellation.blockNumber) !== BigInt(request.cancellationBlockNumber) || cancellation.finalized !== true) {
          throw new Error('finalized cancellation evidence mismatch');
        }
        const operation = {
          ...item, sourceAmount: deposit.amount, recipient: deposit.recipient,
          outputAmount: deposit.quotedOutput, authorizationExpiry: item.releaseDeadline,
        };
        const key = nativeDecisionKey(item.operationId);
        const prior = journal.get(key);
        if (prior?.state === 'PAYOUT_FINALIZED') throw new Error('operation payout already finalized');
        if (prior?.state === 'RELEASE_AUTHORIZED' && time <= BigInt(prior.authorizationExpiry)) {
          throw new Error('recorded release authorization remains executable');
        }
        const operationHash = operationCommitment(operation, destination);
        const digest = refundDigest(request, deposit, source.chainId, source.vault);
        return verifyTwice(verifyEvidence, () => journal.transition({
          key, state: 'REFUND_AUTHORIZED', operationHash, decisionHash: digest,
          authorityEpoch: bytes32(destination.authorityEpoch, 'authorityEpoch'),
          authorizationExpiry: Number(expiry),
        }), digest);
      });
    },
  };
}
