import assert from 'node:assert/strict';
import test from 'node:test';
import { AbiCoder, Wallet, getBytes, keccak256 } from 'ethers';
import { createNativeEvidenceVerifier, quoteDigest } from '../src/nativeEvidence.js';
import { parseNativeSignerPolicy } from '../src/nativePolicy.js';

const coder = AbiCoder.defaultAbiCoder();
const SOURCE_VAULT = '0x1111111111111111111111111111111111111111';
const TARGET_VAULT = '0x2222222222222222222222222222222222222222';
const DEPOSITOR = '0x3333333333333333333333333333333333333333';
const RECIPIENT = '0x4444444444444444444444444444444444444444';
const SOURCE_TX = `0x${'51'.repeat(32)}`;
const RELEASE_TX = `0x${'52'.repeat(32)}`;
const CANCEL_TX = `0x${'53'.repeat(32)}`;
const CLIENT_REFERENCE = `0x${'61'.repeat(32)}`;
const hashFor = number => `0x${Number(number).toString(16).padStart(64, '0')}`;

const operationId = keccak256(coder.encode(
  ['uint256', 'address', 'address', 'uint256', 'bytes32'],
  [1, SOURCE_VAULT, DEPOSITOR, 7, CLIENT_REFERENCE],
));
const operation = {
  operationId, sourceChain: 1, sourceVault: SOURCE_VAULT, sourceDepositor: DEPOSITOR,
  sourceNonce: 7, clientReference: CLIENT_REFERENCE, sourceTxHash: SOURCE_TX,
  sourceAmount: 1000, recipient: RECIPIENT, outputAmount: 900,
  sourceQuoteExpiry: 1000, releaseDeadline: 1000, authorizationExpiry: 990,
};
const destination = { chainId: 56, vault: TARGET_VAULT };

function fixture() {
  const quoteWallet = Wallet.createRandom();
  const policy = parseNativeSignerPolicy({
    quoteSigner: quoteWallet.address, authorityEpoch: `0x${'ab'.repeat(32)}`,
    chains: [
      { chainId: 1, rpcUrl: 'http://127.0.0.1:10001', vault: SOURCE_VAULT, confirmations: 3, finalityDelaySeconds: 60 },
      { chainId: 56, rpcUrl: 'http://127.0.0.1:10056', vault: TARGET_VAULT, confirmations: 3, finalityDelaySeconds: 60 },
    ],
  });
  const deposit = {
    depositor: DEPOSITOR, recipient: RECIPIENT, amount: 1000n, targetChain: 56,
    quotedOutput: 900n, quoteExpiry: 1000, targetVault: TARGET_VAULT,
    finalityDelaySeconds: 60, state: 1,
  };
  const state = { targetReleaseState: 0, sourceDepositState: 1 };
  const providers = new Map([1, 56].map(chainId => [chainId, {
    send: async method => {
      assert.equal(method, 'eth_chainId');
      return `0x${chainId.toString(16)}`;
    },
    getBlockNumber: async () => 20,
    getBlock: async number => ({ number: Number(number), hash: hashFor(number), timestamp: Number(number) === 12 ? 1100 : 1200 }),
    getTransactionReceipt: async hash => {
      if (hash === SOURCE_TX) return { status: 1, blockNumber: 10, blockHash: hashFor(10), to: SOURCE_VAULT };
      if (hash === RELEASE_TX) return { status: 1, blockNumber: 11, blockHash: hashFor(11), to: TARGET_VAULT };
      if (hash === CANCEL_TX) return { status: 1, blockNumber: 12, blockHash: hashFor(12), to: TARGET_VAULT };
      return null;
    },
  }]));
  const contracts = new Map([
    [1, {
      filters: { NativeDeposited: id => ({ kind: 'deposit', id }) },
      queryFilter: async filter => filter.kind === 'deposit' ? [{
        removed: false, transactionHash: SOURCE_TX, blockHash: hashFor(10),
        args: { depositor: DEPOSITOR, recipient: RECIPIENT, amount: 1000n,
          targetChain: 56, quotedOutput: 900n, quoteExpiry: 1000 },
      }] : [],
      deposits: async (_id, options) => Number(options.blockTag) === 10
        ? deposit : { ...deposit, state: state.sourceDepositState },
      releaseStates: async () => 0,
    }],
    [56, {
      filters: {
        NativeReleased: id => ({ kind: 'release', id }),
        ReleaseCancelled: id => ({ kind: 'cancel', id }),
      },
      queryFilter: async filter => {
        if (filter.kind === 'release') return [{
          removed: false, transactionHash: RELEASE_TX, blockHash: hashFor(11), args: {
            sourceChain: 1, recipient: RECIPIENT, sourceAmount: 1000n, outputAmount: 900n,
            sourceTxHash: SOURCE_TX, sourceVault: SOURCE_VAULT,
          },
        }];
        if (filter.kind === 'cancel') return [{
          removed: false, transactionHash: CANCEL_TX, blockHash: hashFor(12),
          args: { sourceChain: 1, sourceTxHash: SOURCE_TX },
        }];
        return [];
      },
      releaseStates: async (_id, options) => Number(options.blockTag) === 12 ? 2 : state.targetReleaseState,
      deposits: async () => { throw new Error('unexpected target deposit read'); },
    }],
  ]);
  const verifier = createNativeEvidenceVerifier(policy, {
    providerFactory: chain => providers.get(chain.chainId),
    contractFactory: chain => contracts.get(chain.chainId),
  });
  return { quoteWallet, verifier, state };
}

async function releaseEvidence(quoteWallet) {
  return {
    sourceBlockNumber: 10, sourceBlockHash: hashFor(10),
    quoteSignature: await quoteWallet.signMessage(getBytes(quoteDigest(operation, destination))),
  };
}

test('verifies quote authority, canonical source deposit and unused destination', async () => {
  const { quoteWallet, verifier, state } = fixture();
  await verifier.verifyRelease(operation, destination, await releaseEvidence(quoteWallet));
  state.sourceDepositState = 3;
  await assert.rejects(verifier.verifyRelease(operation, destination, await releaseEvidence(quoteWallet)),
    /no longer pending/);
  const wrong = Wallet.createRandom();
  const evidence = await releaseEvidence(wrong);
  await assert.rejects(verifier.verifyRelease(operation, destination, evidence), /quote authorization signer mismatch/);
});

test('verifies expiry recovery, finalization and refund evidence', async () => {
  const { quoteWallet, verifier, state } = fixture();
  await verifier.verifyCancellation(operation, destination, await releaseEvidence(quoteWallet));

  state.targetReleaseState = 1;
  await verifier.verifyFinalization(operation, { chainId: 1, vault: SOURCE_VAULT }, destination, {
    destinationTxHash: RELEASE_TX, expectedDestinationTxHash: RELEASE_TX,
    destinationBlockNumber: 11, destinationBlockHash: hashFor(11),
  });
  await assert.rejects(verifier.verifyFinalization(operation, { chainId: 1, vault: SOURCE_VAULT }, destination, {
    destinationTxHash: RELEASE_TX, expectedDestinationTxHash: SOURCE_TX,
    destinationBlockNumber: 11, destinationBlockHash: hashFor(11),
  }), /transaction mismatch/);

  state.targetReleaseState = 0;
  const verified = await verifier.verifyRefund({
    operationId, cancellationTxHash: CANCEL_TX, cancellationBlockHash: hashFor(12),
    cancellationBlockNumber: 12, authorizationExpiry: 1300,
  }, operation, { chainId: 1, vault: SOURCE_VAULT }, destination, {});
  assert.equal(verified.deposit.amount, 1000n);
  assert.equal(verified.cancellation.finalized, true);
});
