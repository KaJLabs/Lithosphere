import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFinalityCheckpoints, initializeFinalityCheckpoints } from '../src/finalityCheckpoints.js';
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

const directories = [];
after(() => { for (const dir of directories) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-evidence-'));
  directories.push(dir);
  const checkpointFile = path.join(dir, 'checkpoints.json');
  const binding = 'a'.repeat(64);
  const reports = [];
  initializeFinalityCheckpoints(checkpointFile, binding);
  const quoteWallet = Wallet.createRandom();
  const policy = parseNativeSignerPolicy({
    quoteSigner: quoteWallet.address, authorityEpoch: `0x${'ab'.repeat(32)}`,
    chains: [
      { chainId: 1, rpcUrl: 'http://127.0.0.1:10001', finalityRpcUrl: 'http://127.0.0.1:11001', vault: SOURCE_VAULT, confirmations: 3, finalityDelaySeconds: 60 },
      { chainId: 56, rpcUrl: 'http://127.0.0.1:10056', finalityRpcUrl: 'http://127.0.0.1:11056', vault: TARGET_VAULT, confirmations: 3, finalityDelaySeconds: 60 },
      { chainId: 8453, rpcUrl: 'http://127.0.0.1:18453', finalityRpcUrl: 'http://127.0.0.1:19453', vault: SOURCE_VAULT, confirmations: 3, finalityDelaySeconds: 60 },
    ],
  });
  const deposit = {
    depositor: DEPOSITOR, recipient: RECIPIENT, amount: 1000n, targetChain: 56,
    quotedOutput: 900n, quoteExpiry: 1000, targetVault: TARGET_VAULT,
    finalityDelaySeconds: 60, state: 1,
  };
  const state = { targetReleaseState: 0, sourceDepositState: 1,
    outerRecipient: null, targetForkAt: null, targetForked: false,
    finalized: { 1: 18, 56: 18, 8453: 18 }, peerFinalized: { 1: 18, 56: 18, 8453: 18 },
    peerForked: false, missingFinality: false, headSequences: {}, latestSequences: {} };
  const makeProvider = (chainId, peer = false) => {
    let headReads = 0, latestReads = 0;
    const key = `${chainId}:${peer ? 'peer' : 'primary'}`;
    return ({
    isPeer: peer,
    send: async method => {
      if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
      assert.equal(method, 'eth_getBlockByNumber');
      if (state.missingFinality) return null;
      if (state.timeoutRole === key) return new Promise(() => {});
      const sequence = state.headSequences[key];
      const number = sequence ? sequence[Math.min(headReads++, sequence.length - 1)]
        : (peer ? state.peerFinalized : state.finalized)[chainId];
      return { number: `0x${number.toString(16)}`, hash: state.changedHead === key || (peer && state.peerForked) ? hashFor(99) : hashFor(number) };
    },
    getBlockNumber: async () => {
      const sequence = state.latestSequences[key];
      return sequence ? sequence[Math.min(latestReads++, sequence.length - 1)] : 20;
    },
    getBlock: async number => ({ number: Number(number),
      hash: (state.brokenContinuity === key && Number(number) === 18) || (peer && state.peerForked) ? hashFor(99) :
        chainId === 56 && state.targetForked && [11, 12].includes(Number(number))
        ? hashFor(99) : hashFor(number),
      timestamp: peer && state.peerContent === 'timestamp' ? 1500 : Number(number) === 12 ? 1100 : 1200 }),
    getTransactionReceipt: async hash => {
      if (hash === SOURCE_TX) return { status: peer && state.peerContent === 'receipt' ? 0 : 1, blockNumber: 10, blockHash: hashFor(10), to: state.outerRecipient || SOURCE_VAULT };
      if (hash === RELEASE_TX) return { status: 1, blockNumber: 11, blockHash: hashFor(11), to: state.outerRecipient || TARGET_VAULT };
      if (hash === CANCEL_TX) return { status: 1, blockNumber: 12, blockHash: hashFor(12), to: state.outerRecipient || TARGET_VAULT };
      return null;
    },
  });
  };
  const providers = new Map([1, 56, 8453].map(chainId => [chainId, makeProvider(chainId)]));
  const peers = new Map([1, 56, 8453].map(chainId => [chainId, makeProvider(chainId, true)]));
  const contracts = new Map([
    [1, {
      filters: { NativeDeposited: id => ({ kind: 'deposit', id }) },
      queryFilter: async filter => filter.kind === 'deposit' ? [{
        removed: false, transactionHash: SOURCE_TX, blockHash: hashFor(10),
        args: { depositor: DEPOSITOR, recipient: RECIPIENT, amount: 1000n,
          targetChain: 56, quotedOutput: 900n, quoteExpiry: 1000 },
      }] : [],
      deposits: async (_id, options) => {
        if (state.targetForkAt === 'sourceRead') state.targetForked = true;
        return Number(options.blockTag) === 10 ? deposit : { ...deposit, state: state.sourceDepositState };
      },
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
      releaseStates: async (_id, options) => {
        if (state.targetForkAt === 'terminalRead' && [11, 12].includes(Number(options.blockTag))) {
          state.targetForked = true;
        }
        return Number(options.blockTag) === 12 ? 2 : state.targetReleaseState;
      },
      deposits: async () => { throw new Error('unexpected target deposit read'); },
    }],
  ]);
  contracts.set(8453, contracts.get(1));
  const makeVerifier = () => createNativeEvidenceVerifier(policy, {
    checkpoints: createFinalityCheckpoints(checkpointFile, binding),
    report: record => reports.push(record),
    providerFactory: chain => providers.get(chain.chainId),
    finalityProviderFactory: chain => peers.get(chain.chainId),
    contractFactory: (chain, rpc) => {
      const original = contracts.get(chain.chainId);
      if (!rpc.isPeer) return original;
      return { ...original,
        deposits: async (...args) => { const value = await original.deposits(...args);
          return state.peerContent === 'state' ? { ...value, amount: 999n } : value; },
        queryFilter: async (...args) => state.peerContent === 'logs' ? [] : original.queryFilter(...args),
      };
    },
    ...options,
  });
  const verifier = makeVerifier();
  return { quoteWallet, verifier, state, makeVerifier, checkpointFile, binding, reports };
}

async function releaseEvidence(quoteWallet) {
  return {
    sourceBlockNumber: 10, sourceBlockHash: hashFor(10),
    quoteSignature: await quoteWallet.signMessage(getBytes(quoteDigest(operation, destination))),
  };
}

for (const chainId of [1, 8453]) {
  for (const role of ['primary', 'peer']) {
    test(`rejects ${role} finalized regression above shared minimum on ${chainId}`, async () => {
      const { verifier, state } = fixture();
      state.finalized[chainId] = 17;
      state.peerFinalized[chainId] = 17;
      state.headSequences[`${chainId}:${role}`] = [19, 18];
      await assert.rejects(verifier.verifyCancellation({ ...operation, sourceChain: chainId }, destination,
        { sourceBlockNumber: 10, sourceBlockHash: hashFor(10) }), /finality head regressed/);
    });
    test(`allows ${role} latest regression above finality on ${chainId}`, async () => {
      const { verifier, state, reports } = fixture();
      state.latestSequences[`${chainId}:${role}`] = [30, 29];
      await verifier.verifyCancellation({ ...operation, sourceChain: chainId }, destination,
        { sourceBlockNumber: 10, sourceBlockHash: hashFor(10) });
      assert.ok(reports.some(record => record.event === 'LATEST_HEAD_REGRESSION' && record.chainId === chainId &&
        record.role === (role === 'peer' ? 'finality' : 'primary')));
    });
    test(`rejects ${role} latest below its finalized head on ${chainId}`, async () => {
      const { verifier, state } = fixture();
      state.latestSequences[`${chainId}:${role}`] = [17];
      await assert.rejects(verifier.verifyCancellation({ ...operation, sourceChain: chainId }, destination,
        { sourceBlockNumber: 10, sourceBlockHash: hashFor(10) }), /head ordering/);
    });
  }
}

for (const role of ['primary', 'peer']) {
  test(`${role} finalized checkpoint rejects regression after verifier restart`, async () => {
    const f = fixture();
    await f.verifier.verifyCancellation(operation, destination, { sourceBlockNumber: 10, sourceBlockHash: hashFor(10) });
    f.state.headSequences[`1:${role}`] = [17];
    await assert.rejects(f.makeVerifier().verifyCancellation(operation, destination,
      { sourceBlockNumber: 10, sourceBlockHash: hashFor(10) }), /finality head regressed/);
  });
  for (const fault of ['changedHead', 'brokenContinuity']) {
    test(`${role} rejects ${fault} against its persisted finalized checkpoint`, async () => {
      const f = fixture();
      const evidence = { sourceBlockNumber: 10, sourceBlockHash: hashFor(10) };
      await f.verifier.verifyCancellation(operation, destination, evidence);
      f.state[fault] = `1:${role}`;
      if (fault === 'brokenContinuity') f.state.headSequences[`1:${role}`] = [19];
      await assert.rejects(f.makeVerifier().verifyCancellation(operation, destination, evidence),
        /finality head hash changed|finality continuity broken/);
    });
  }
  test(`${role} RPC timeout rejects within the configured deadline`, async () => {
    const f = fixture({ rpcTimeoutMs: 30 });
    f.state.timeoutRole = `1:${role}`;
    await assert.rejects(f.verifier.verifyCancellation(operation, destination,
      { sourceBlockNumber: 10, sourceBlockHash: hashFor(10) }), /deadline exceeded/);
  });
}
for (const content of ['receipt', 'logs', 'state', 'timestamp']) {
  test(`B04: agreement on hashes cannot hide differing ${content}`, async () => {
    const f = fixture();
    f.state.peerContent = content;
    await assert.rejects(f.verifier.verifyRelease(operation, destination, await releaseEvidence(f.quoteWallet)),
      /content disagrees/);
  });
}
test('parallel verifications serialize checkpoints and retain the newest observations', async () => {
  const f = fixture();
  f.state.headSequences['1:primary'] = [18, 19, 20];
  f.state.headSequences['1:peer'] = [18, 19, 20];
  await Promise.all(Array.from({ length: 3 }, () => f.verifier.verifyCancellation(operation, destination,
    { sourceBlockNumber: 10, sourceBlockHash: hashFor(10) })));
  assert.deepEqual(JSON.parse(fs.readFileSync(f.checkpointFile)).data.chains['1'].map(h => h.number), [20, 20]);
});
for (const fault of ['missing', 'tampered']) {
  test(`a ${fault} checkpoint cannot silently restart`, async () => {
    const f = fixture();
    await f.verifier.verifyCancellation(operation, destination, { sourceBlockNumber: 10, sourceBlockHash: hashFor(10) });
    if (fault === 'missing') fs.unlinkSync(f.checkpointFile);
    else fs.writeFileSync(f.checkpointFile, '{}');
    assert.throws(f.makeVerifier);
    await assert.rejects(f.verifier.verifyCancellation(operation, destination,
      { sourceBlockNumber: 10, sourceBlockHash: hashFor(10) }));
  });
}

test('verifies quote authority, canonical source deposit and unused destination', async () => {
  const { quoteWallet, verifier, state } = fixture();
  await verifier.verifyRelease(operation, destination, await releaseEvidence(quoteWallet));
  state.sourceDepositState = 3;
  await assert.rejects(verifier.verifyRelease(operation, destination, await releaseEvidence(quoteWallet)),
    /no longer pending/);
  state.sourceDepositState = 1;
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

  state.targetReleaseState = 2;
  const verified = await verifier.verifyRefund({
    operationId, cancellationTxHash: CANCEL_TX, cancellationBlockHash: hashFor(12),
    cancellationBlockNumber: 12, authorizationExpiry: 1300,
  }, operation, { chainId: 1, vault: SOURCE_VAULT }, destination, {});
  assert.equal(verified.deposit.amount, 1000n);
  assert.equal(verified.cancellation.finalized, true);
});

test('accepts approved vault events from contract-wallet and contract-relayer transactions', async () => {
  const { quoteWallet, verifier, state } = fixture();
  state.outerRecipient = '0x5555555555555555555555555555555555555555';
  await verifier.verifyRelease(operation, destination, await releaseEvidence(quoteWallet));
  await verifier.verifyCancellation(operation, destination, { sourceBlockNumber: 10, sourceBlockHash: hashFor(10) });
  state.targetReleaseState = 1;
  await verifier.verifyFinalization(operation, { chainId: 1, vault: SOURCE_VAULT }, destination, {
    destinationTxHash: RELEASE_TX, expectedDestinationTxHash: RELEASE_TX,
    destinationBlockNumber: 11, destinationBlockHash: hashFor(11),
  });
  state.targetReleaseState = 2;
  await verifier.verifyRefund({ operationId, cancellationTxHash: CANCEL_TX,
    cancellationBlockHash: hashFor(12), cancellationBlockNumber: 12, authorizationExpiry: 1300 },
  operation, { chainId: 1, vault: SOURCE_VAULT }, destination, {});
});

test('rejects terminal proof reorganization after historical or dependent reads', async () => {
  const finalization = fixture();
  finalization.state.targetReleaseState = 1;
  finalization.state.targetForkAt = 'terminalRead';
  await assert.rejects(finalization.verifier.verifyFinalization(operation,
    { chainId: 1, vault: SOURCE_VAULT }, destination, {
      destinationTxHash: RELEASE_TX, expectedDestinationTxHash: RELEASE_TX,
      destinationBlockNumber: 11, destinationBlockHash: hashFor(11),
    }), /not canonical/);

  const refund = fixture();
  refund.state.targetReleaseState = 2;
  refund.state.targetForkAt = 'terminalRead';
  await assert.rejects(refund.verifier.verifyRefund({ operationId,
    cancellationTxHash: CANCEL_TX, cancellationBlockHash: hashFor(12),
    cancellationBlockNumber: 12, authorizationExpiry: 1300 }, operation,
  { chainId: 1, vault: SOURCE_VAULT }, destination, {}), /not canonical/);
});

test('permits cancellation of a real deposit when no approved payout quote exists', async () => {
  const { verifier } = fixture();
  await assert.rejects(verifier.verifyRelease(operation, destination,
    { sourceBlockNumber: 10, sourceBlockHash: hashFor(10) }), /quote authorization signature/);
  await verifier.verifyCancellation(operation, destination,
    { sourceBlockNumber: 10, sourceBlockHash: hashFor(10) });
});

test('rejects a three-block-deep deposit that is not finalized', async () => {
  const { quoteWallet, verifier, state } = fixture();
  state.finalized[1] = 9;
  state.peerFinalized[1] = 9;
  await assert.rejects(verifier.verifyRelease(operation, destination, await releaseEvidence(quoteWallet)),
    /not finalized/);
  state.finalized[1] = 10;
  state.peerFinalized[1] = 10;
  await verifier.verifyRelease(operation, destination, await releaseEvidence(quoteWallet));
});

test('fails closed on independent finalized RPC disagreement or unavailable finality', async () => {
  for (const mutate of [state => { state.peerForked = true; },
    state => { state.peerFinalized[1] = 0; }, state => { state.missingFinality = true; }]) {
    const { quoteWallet, verifier, state } = fixture();
    mutate(state);
    await assert.rejects(verifier.verifyRelease(operation, destination, await releaseEvidence(quoteWallet)),
      /independent finalized RPC views disagree|finality head unavailable/);
  }
});

test('Base latest/safe depth does not substitute for an L2 finalized head', async () => {
  const { quoteWallet, verifier, state } = fixture();
  const baseOperation = { ...operation, sourceChain: 8453, operationId: keccak256(coder.encode(
    ['uint256', 'address', 'address', 'uint256', 'bytes32'],
    [8453, SOURCE_VAULT, DEPOSITOR, 7, CLIENT_REFERENCE],
  )) };
  const evidence = { sourceBlockNumber: 10, sourceBlockHash: hashFor(10),
    quoteSignature: await quoteWallet.signMessage(getBytes(quoteDigest(baseOperation, destination))) };
  state.finalized[8453] = 9;
  state.peerFinalized[8453] = 9;
  await assert.rejects(verifier.verifyRelease(baseOperation, destination, evidence), /not finalized/);
  state.finalized[8453] = 10;
  state.peerFinalized[8453] = 10;
  await verifier.verifyRelease(baseOperation, destination, evidence);
});

test('rejects cancellation proof until the destination block is finalized', async () => {
  const { verifier, state } = fixture();
  state.finalized[56] = 11;
  state.peerFinalized[56] = 11;
  await assert.rejects(verifier.verifyRefund({ operationId, cancellationTxHash: CANCEL_TX,
    cancellationBlockHash: hashFor(12), cancellationBlockNumber: 12, authorizationExpiry: 1300 },
  operation, { chainId: 1, vault: SOURCE_VAULT }, destination, {}), /not finalized/);
});
