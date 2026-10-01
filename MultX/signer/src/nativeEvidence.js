import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  getAddress,
  getBytes,
  keccak256,
  toUtf8Bytes,
  verifyMessage,
} from 'ethers';
import { resolveNativeChain } from './nativePolicy.js';

const coder = AbiCoder.defaultAbiCoder();
const QUOTE_ACTION = keccak256(toUtf8Bytes('MULTX_NATIVE_QUOTE_V1'));
const ABI = [
  'event NativeDeposited(bytes32 indexed operationId,address indexed depositor,address indexed recipient,uint256 amount,uint256 targetChain,uint256 quotedOutput,uint64 quoteExpiry)',
  'event NativeReleased(bytes32 indexed operationId,uint256 indexed sourceChain,address indexed recipient,uint256 sourceAmount,uint256 outputAmount,bytes32 sourceTxHash,address sourceVault)',
  'event ReleaseCancelled(bytes32 indexed operationId,uint256 indexed sourceChain,bytes32 indexed sourceTxHash)',
  'function deposits(bytes32) view returns(address depositor,address recipient,uint256 amount,uint256 targetChain,uint256 quotedOutput,uint64 quoteExpiry,address targetVault,uint64 finalityDelaySeconds,uint8 state)',
  'function releaseStates(bytes32) view returns(uint8)',
];
const bytes32 = value => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
const lower = value => String(value).toLowerCase();

export function quoteDigest(operation, destination) {
  return keccak256(coder.encode(
    ['bytes32', 'bytes32', 'uint256', 'address', 'address', 'uint256', 'bytes32', 'uint256',
      'uint256', 'address', 'address', 'uint256', 'uint64'],
    [QUOTE_ACTION, operation.operationId, operation.sourceChain, operation.sourceVault,
      operation.sourceDepositor, operation.sourceNonce, operation.clientReference,
      operation.sourceAmount, destination.chainId, destination.vault, operation.recipient,
      operation.outputAmount, operation.sourceQuoteExpiry],
  ));
}

function assertQuote(policy, operation, destination, signature) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature || '')) throw new Error('quote authorization signature is required');
  const recovered = verifyMessage(getBytes(quoteDigest(operation, destination)), signature);
  if (getAddress(recovered) !== policy.quoteSigner) throw new Error('quote authorization signer mismatch');
}

function normalizeDeposit(value) {
  return {
    depositor: getAddress(value.depositor ?? value[0]), recipient: getAddress(value.recipient ?? value[1]),
    amount: BigInt(value.amount ?? value[2]), targetChain: Number(value.targetChain ?? value[3]),
    quotedOutput: BigInt(value.quotedOutput ?? value[4]), quoteExpiry: Number(value.quoteExpiry ?? value[5]),
    targetVault: getAddress(value.targetVault ?? value[6]),
    finalityDelaySeconds: Number(value.finalityDelaySeconds ?? value[7]), state: Number(value.state ?? value[8]),
  };
}

export function createNativeEvidenceVerifier(policy, {
  providerFactory = chain => new JsonRpcProvider(chain.rpcUrl, undefined, { cacheTimeout: -1 }),
  contractFactory = (chain, provider) => new Contract(chain.vault, ABI, provider),
} = {}) {
  const clients = new Map();
  const client = chain => {
    if (!clients.has(chain.chainId)) {
      const provider = providerFactory(chain);
      clients.set(chain.chainId, { provider, contract: contractFactory(chain, provider) });
    }
    return clients.get(chain.chainId);
  };

  async function assertNetwork(chain, provider) {
    const measured = Number(BigInt(await provider.send('eth_chainId', [])));
    if (measured !== chain.chainId) throw new Error(`native RPC chain ${chain.chainId} identity mismatch`);
  }

  async function confirmedBlock(chain, number, hash) {
    if (!Number.isSafeInteger(Number(number)) || Number(number) <= 0 || !bytes32(hash)) {
      throw new Error('explicit block number and hash are required');
    }
    const { provider } = client(chain);
    await assertNetwork(chain, provider);
    const tip = await provider.getBlockNumber();
    const block = await provider.getBlock(Number(number));
    if (!block?.hash || lower(block.hash) !== lower(hash)) throw new Error('evidence block is not canonical');
    if (tip - Number(number) + 1 < chain.confirmations) throw new Error('evidence has insufficient confirmations');
    return block;
  }

  async function stableFinalizedState(chain, read) {
    const { provider, contract } = client(chain);
    await assertNetwork(chain, provider);
    const tip = await provider.getBlockNumber();
    const blockTag = tip - chain.confirmations + 1;
    if (blockTag <= 0) throw new Error('chain has no finalized policy block');
    const before = await provider.getBlock(blockTag);
    if (!before?.hash) throw new Error('finalized policy block unavailable');
    const value = await read(contract, blockTag, before);
    const after = await provider.getBlock(blockTag);
    if (!after?.hash || lower(after.hash) !== lower(before.hash)) throw new Error('finalized policy block changed');
    return { value, block: after };
  }

  async function sourceDeposit(operation, destination, evidence, requireQuote = true) {
    const source = resolveNativeChain(policy, operation.sourceChain, operation.sourceVault);
    resolveNativeChain(policy, destination.chainId, destination.vault);
    if (requireQuote) assertQuote(policy, operation, destination, evidence?.quoteSignature);
    const block = await confirmedBlock(source, evidence?.sourceBlockNumber, evidence?.sourceBlockHash);
    const { provider, contract } = client(source);
    const receipt = await provider.getTransactionReceipt(operation.sourceTxHash);
    if (!receipt || Number(receipt.status) !== 1 || receipt.blockNumber !== Number(evidence.sourceBlockNumber) ||
        lower(receipt.blockHash) !== lower(evidence.sourceBlockHash)) {
      throw new Error('source deposit receipt mismatch');
    }
    const events = await contract.queryFilter(contract.filters.NativeDeposited(operation.operationId),
      Number(evidence.sourceBlockNumber), Number(evidence.sourceBlockNumber));
    if (events.length !== 1) throw new Error('source native deposit event is missing or ambiguous');
    const event = events[0], a = event.args;
    if (event.removed || lower(event.transactionHash) !== lower(operation.sourceTxHash) ||
        lower(event.blockHash) !== lower(evidence.sourceBlockHash) || getAddress(a.depositor) !== getAddress(operation.sourceDepositor) ||
        getAddress(a.recipient) !== getAddress(operation.recipient) || BigInt(a.amount) !== BigInt(operation.sourceAmount) ||
        Number(a.targetChain) !== Number(destination.chainId) || BigInt(a.quotedOutput) !== BigInt(operation.outputAmount) ||
        Number(a.quoteExpiry) !== Number(operation.sourceQuoteExpiry)) throw new Error('source native deposit event mismatch');
    const deposit = normalizeDeposit(await contract.deposits(operation.operationId, { blockTag: Number(evidence.sourceBlockNumber) }));
    if (deposit.state !== 1 || deposit.depositor !== getAddress(operation.sourceDepositor) ||
        deposit.recipient !== getAddress(operation.recipient) || deposit.amount !== BigInt(operation.sourceAmount) ||
        deposit.targetChain !== Number(destination.chainId) || deposit.quotedOutput !== BigInt(operation.outputAmount) ||
        deposit.quoteExpiry !== Number(operation.sourceQuoteExpiry) || deposit.targetVault !== getAddress(destination.vault)) {
      throw new Error('source native deposit state mismatch');
    }
    const current = await stableFinalizedState(source, (reader, blockTag) =>
      reader.deposits(operation.operationId, { blockTag }));
    const currentDeposit = normalizeDeposit(current.value);
    if (currentDeposit.state !== 1 || currentDeposit.depositor !== deposit.depositor ||
        currentDeposit.recipient !== deposit.recipient || currentDeposit.amount !== deposit.amount ||
        currentDeposit.targetChain !== deposit.targetChain ||
        currentDeposit.quotedOutput !== deposit.quotedOutput ||
        currentDeposit.quoteExpiry !== deposit.quoteExpiry ||
        currentDeposit.targetVault !== deposit.targetVault ||
        currentDeposit.finalityDelaySeconds !== deposit.finalityDelaySeconds) {
      throw new Error('source native deposit is no longer pending with the quoted terms');
    }
    await confirmedBlock(source, block.number, block.hash);
    return { source, deposit };
  }

  async function terminalState(chain, operationId, expectedState, blockNumber, blockHash) {
    await confirmedBlock(chain, blockNumber, blockHash);
    const { value } = await stableFinalizedState(chain, (contract, blockTag) =>
      contract.releaseStates(operationId, { blockTag }));
    if (Number(value) !== expectedState) throw new Error('destination terminal state changed');
    await confirmedBlock(chain, blockNumber, blockHash);
  }

  async function releasedEvent(operation, destination, evidence) {
    const chain = resolveNativeChain(policy, destination.chainId, destination.vault);
    await confirmedBlock(chain, evidence?.destinationBlockNumber, evidence?.destinationBlockHash);
    const { provider, contract } = client(chain);
    const receipt = await provider.getTransactionReceipt(evidence?.destinationTxHash);
    if (!receipt || Number(receipt.status) !== 1 || receipt.blockNumber !== Number(evidence.destinationBlockNumber) ||
        lower(receipt.blockHash) !== lower(evidence.destinationBlockHash)) {
      throw new Error('destination release receipt mismatch');
    }
    const events = await contract.queryFilter(contract.filters.NativeReleased(operation.operationId),
      Number(evidence.destinationBlockNumber), Number(evidence.destinationBlockNumber));
    if (events.length !== 1 || events[0].removed) throw new Error('destination release event is missing or ambiguous');
    const event = events[0], a = event.args;
    if (lower(event.transactionHash) !== lower(evidence.destinationTxHash) ||
        lower(event.blockHash) !== lower(evidence.destinationBlockHash) ||
        Number(a.sourceChain) !== Number(operation.sourceChain) || getAddress(a.recipient) !== getAddress(operation.recipient) ||
        BigInt(a.sourceAmount) !== BigInt(operation.sourceAmount) || BigInt(a.outputAmount) !== BigInt(operation.outputAmount) ||
        lower(a.sourceTxHash) !== lower(operation.sourceTxHash) || getAddress(a.sourceVault) !== getAddress(operation.sourceVault)) {
      throw new Error('destination release event mismatch');
    }
    const state = await contract.releaseStates(operation.operationId, { blockTag: Number(evidence.destinationBlockNumber) });
    if (Number(state) !== 1) throw new Error('destination release state is not Released');
    await terminalState(chain, operation.operationId, 1, evidence.destinationBlockNumber, evidence.destinationBlockHash);
    return { chain, receipt };
  }

  return {
    async verifyRelease(operation, destination, evidence) {
      await sourceDeposit(operation, destination, evidence);
      const target = resolveNativeChain(policy, destination.chainId, destination.vault);
      const { value } = await stableFinalizedState(target, (contract, blockTag) =>
        contract.releaseStates(operation.operationId, { blockTag }));
      if (Number(value) !== 0) throw new Error('destination operation is already terminal');
    },
    async verifyCancellation(operation, destination, evidence) {
      await sourceDeposit(operation, destination, evidence, false);
      const target = resolveNativeChain(policy, destination.chainId, destination.vault);
      const { value, block } = await stableFinalizedState(target, async (contract, blockTag) => ({
        state: Number(await contract.releaseStates(operation.operationId, { blockTag })),
      }));
      if (value.state !== 0) throw new Error('destination operation is already terminal');
      if (Number(block.timestamp) <= Number(operation.releaseDeadline)) throw new Error('finalized destination time has not passed release deadline');
    },
    async verifyFinalization(operation, source, destination, evidence) {
      if (Number(operation.sourceChain) !== Number(source.chainId) ||
          getAddress(operation.sourceVault) !== getAddress(source.vault)) {
        throw new Error('source finalization route mismatch');
      }
      if (lower(evidence?.destinationTxHash) !== lower(evidence?.expectedDestinationTxHash)) {
        throw new Error('destination finalization transaction mismatch');
      }
      await releasedEvent(operation, destination, evidence);
      const sourceChain = resolveNativeChain(policy, source.chainId, source.vault);
      const { value } = await stableFinalizedState(sourceChain, (contract, blockTag) =>
        contract.deposits(operation.operationId, { blockTag }));
      const deposit = normalizeDeposit(value);
      if (deposit.state !== 1 || deposit.depositor !== getAddress(operation.sourceDepositor) ||
          deposit.recipient !== getAddress(operation.recipient) ||
          deposit.amount !== BigInt(operation.sourceAmount) ||
          deposit.quotedOutput !== BigInt(operation.outputAmount) ||
          deposit.quoteExpiry !== Number(operation.sourceQuoteExpiry) ||
          deposit.targetChain !== destination.chainId || deposit.targetVault !== destination.vault) {
        throw new Error('source finalization deposit mismatch');
      }
      await terminalState(resolveNativeChain(policy, destination.chainId, destination.vault),
        operation.operationId, 1, evidence.destinationBlockNumber, evidence.destinationBlockHash);
    },
    async verifyRefund(request, identity, source, destination, evidence) {
      if (Number(identity.sourceChain) !== Number(source.chainId) ||
          getAddress(identity.sourceVault) !== getAddress(source.vault)) {
        throw new Error('source refund route mismatch');
      }
      const sourceChain = resolveNativeChain(policy, source.chainId, source.vault);
      const target = resolveNativeChain(policy, destination.chainId, destination.vault);
      const cancellationBlock = await confirmedBlock(target, request.cancellationBlockNumber, request.cancellationBlockHash);
      const { provider, contract } = client(target);
      const receipt = await provider.getTransactionReceipt(request.cancellationTxHash);
      if (!receipt || Number(receipt.status) !== 1 || receipt.blockNumber !== Number(request.cancellationBlockNumber) ||
          lower(receipt.blockHash) !== lower(request.cancellationBlockHash)) {
        throw new Error('destination cancellation receipt mismatch');
      }
      const events = await contract.queryFilter(contract.filters.ReleaseCancelled(identity.operationId),
        Number(request.cancellationBlockNumber), Number(request.cancellationBlockNumber));
      if (events.length !== 1 || events[0].removed ||
          lower(events[0].transactionHash) !== lower(request.cancellationTxHash) ||
          lower(events[0].blockHash) !== lower(request.cancellationBlockHash) ||
          Number(events[0].args.sourceChain) !== Number(identity.sourceChain) ||
          lower(events[0].args.sourceTxHash) !== lower(identity.sourceTxHash)) {
        throw new Error('destination cancellation event mismatch');
      }
      const state = await contract.releaseStates(identity.operationId, { blockTag: Number(request.cancellationBlockNumber) });
      if (Number(state) !== 2) throw new Error('destination release state is not Cancelled');
      const sourceState = await stableFinalizedState(sourceChain, (sourceContract, blockTag) =>
        sourceContract.deposits(identity.operationId, { blockTag }));
      const deposit = normalizeDeposit(sourceState.value);
      if (deposit.state !== 1 || deposit.depositor !== getAddress(identity.sourceDepositor) ||
          deposit.targetChain !== target.chainId || deposit.targetVault !== target.vault ||
          deposit.quoteExpiry !== Number(identity.sourceQuoteExpiry)) throw new Error('source refund deposit mismatch');
      if (deposit.finalityDelaySeconds < target.finalityDelaySeconds) {
        throw new Error('source finality snapshot is below approved destination policy');
      }
      const finalized = await stableFinalizedState(target, (_contract, _tag, block) => block.timestamp);
      if (Number(finalized.value) < Number(cancellationBlock.timestamp) + deposit.finalityDelaySeconds) {
        throw new Error('destination cancellation finality delay has not elapsed');
      }
      await terminalState(target, identity.operationId, 2,
        request.cancellationBlockNumber, request.cancellationBlockHash);
      return { deposit, cancellation: { txHash: request.cancellationTxHash, blockHash: request.cancellationBlockHash,
        blockNumber: Number(request.cancellationBlockNumber), finalized: true } };
    },
  };
}
