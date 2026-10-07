import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AbiCoder, Interface, Wallet, Transaction, keccak256 } from 'ethers';
import { relayNativeOnce, NATIVE_RELAY_ABI } from '../src/nativeRelay.js';
import { createNativeRelayJournal } from '../src/nativeRelayJournal.js';

const hash = n => '0x' + n.repeat(64);
const source = { chainId: 1, vault: '0x1111111111111111111111111111111111111111' };
const destination = { chainId: 56, vault: '0x2222222222222222222222222222222222222222' };
const iface = new Interface(NATIVE_RELAY_ABI);
async function fixture(action = 'release') {
  const wallet = Wallet.createRandom();
  const operation = { sourceChain: 1, sourceVault: source.vault, sourceDepositor: wallet.address,
    sourceNonce: 0, clientReference: hash('a'), sourceTxHash: hash('b'), sourceAmount: '100',
    recipient: wallet.address, outputAmount: '90', sourceQuoteExpiry: 2000, releaseDeadline: 2000,
    authorizationExpiry: 1900 };
  operation.operationId = keccak256(AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'address', 'address', 'uint256', 'bytes32'],
    [1, source.vault, wallet.address, 0, operation.clientReference]));
  const signatures = Array(3).fill('0x' + '11'.repeat(65));
  const packet = { action, operation, destination, signatures, evidence: {}, destinationTxHash: hash('c') };
  let method = 'releaseNative', args = [operation, signatures], chain = destination;
  if (action === 'cancel') {
    packet.request = { ...operation, authorizationExpiry: 2200 };
    method = 'cancelRelease'; args = [packet.request, signatures];
  } else if (action === 'finalize') {
    method = 'finalizeDeposit'; args = [operation.operationId, packet.destinationTxHash, signatures]; chain = source;
  } else if (action === 'refund') {
    packet.request = { operationId: operation.operationId, cancellationTxHash: hash('d'),
      cancellationBlockHash: hash('e'), cancellationBlockNumber: 12, authorizationExpiry: 2200 };
    method = 'refundDeposit'; args = [packet.request, signatures]; chain = source;
  }
  const unsigned = { type: 2, chainId: chain.chainId, nonce: 0, to: chain.vault,
    data: iface.encodeFunctionData(method, args), value: 0, gasLimit: 500000,
    maxFeePerGas: 2, maxPriorityFeePerGas: 1 };
  const rawTransaction = await wallet.signTransaction(unsigned);
  const tx = Transaction.from(rawTransaction);
  const policy = { chains: [source, destination], quoteSigner: wallet.address, authorityEpoch: hash('f') };
  const approval = { action, operationId: operation.operationId, transactionHash: tx.hash,
    relayer: wallet.address, quoteSigner: wallet.address, authorityEpoch: hash('f'),
    start: 900, end: 2300, runtimeHash: keccak256('0x1234'), maxOutputWei: '100' };
  const calls = [], records = [];
  let claimed = false;
  const journal = { claim() { if (claimed) throw new Error('duplicate'); claimed = true; calls.push('claim'); },
    record(status) { records.push(status); calls.push(status); } };
  const verify = async () => { calls.push('verify'); };
  const verifier = { verifyRelease: verify, verifyCancellation: verify, verifyFinalization: verify, verifyRefund: verify };
  const provider = { send: async () => '0x' + chain.chainId.toString(16), getCode: async () => '0x1234',
    call: async () => { calls.push('simulate'); return '0x'; },
    broadcastTransaction: async raw => { assert.equal(raw, rawTransaction); calls.push('broadcast'); return { hash: tx.hash }; } };
  const options = { policy, packet, approval, rawTransaction, provider, journal, verifier, enabled: true,
    now: () => action === 'release' ? 1000 : 2100,
    contractFactory: () => ({ availableLiquidity: async () => 1000n, dailyPayoutCap: async () => 1000n }) };
  return { options, calls, records, wallet, unsigned };
}

for (const action of ['release', 'cancel', 'finalize', 'refund']) {
  test(`${action}: revalidates after simulation, submits once, never retries`, async () => {
    const { options, calls } = await fixture(action);
    assert.equal((await relayNativeOnce(options)).status, 'SUBMITTED');
    assert.deepEqual(calls, ['claim', 'verify', 'simulate', 'verify', 'BROADCAST_ATTEMPT', 'broadcast', 'SUBMITTED']);
    await assert.rejects(relayNativeOnce(options), /duplicate/);
    assert.equal(calls.filter(x => x === 'broadcast').length, 1);
  });
}
for (const fault of ['not finalized', 'RPC disagreement', 'finality unavailable', 'canonical hash changed']) {
  test(`stale certificate / ${fault}: no broadcast and durable hold`, async () => {
    const { options, calls, records } = await fixture();
    let checks = 0;
    options.verifier.verifyRelease = async () => { if (++checks === 2) throw new Error(fault); };
    await assert.rejects(relayNativeOnce(options), /HOLD/);
    assert.deepEqual(records, ['HOLD']);
    assert.equal(calls.includes('broadcast'), false);
    await assert.rejects(relayNativeOnce(options), /duplicate/);
  });
}
test('disabled invocation never claims or calls RPC', async () => {
  const { options, calls } = await fixture(); options.enabled = false;
  await assert.rejects(relayNativeOnce(options), /disabled/); assert.deepEqual(calls, []);
});
for (const change of ['to', 'data', 'value', 'chainId']) {
  test(`raw transaction ${change} drift is rejected`, async () => {
    const { options, wallet, unsigned, calls } = await fixture();
    const mutations = { to: source.vault, data: '0x', value: 1, chainId: 8453 };
    options.rawTransaction = await wallet.signTransaction({ ...unsigned, [change]: mutations[change] });
    await assert.rejects(relayNativeOnce(options), /exact vault action/); assert.deepEqual(calls, []);
  });
}
test('wrong approval, expired certificate and expired window never broadcast', async () => {
  for (const mode of ['approval', 'certificate', 'window']) {
    const { options, calls } = await fixture();
    if (mode === 'approval') options.approval.transactionHash = hash('0');
    if (mode === 'certificate') options.now = () => 1950;
    if (mode === 'window') options.now = () => 2300;
    await assert.rejects(relayNativeOnce(options)); assert.deepEqual(calls, []);
  }
});
test('certificate expiry during finality reads prevents broadcast', async () => {
  const { options, records, calls } = await fixture();
  let time = 1000; options.now = () => time;
  options.verifier.verifyRelease = async () => { time = 2000; };
  await assert.rejects(relayNativeOnce(options), /HOLD/);
  assert.deepEqual(records, ['HOLD']); assert.equal(calls.includes('broadcast'), false);
});
for (const mode of ['approval ceiling', 'liquidity', 'daily cap', 'runtime', 'chain', 'simulation']) {
  test(`${mode} failure puts operation on hold`, async () => {
    const { options, calls, records } = await fixture();
    if (mode === 'approval ceiling') options.approval.maxOutputWei = '80';
    if (mode === 'liquidity') options.contractFactory = () => ({ availableLiquidity: async () => 800n, dailyPayoutCap: async () => 1000n });
    if (mode === 'daily cap') options.contractFactory = () => ({ availableLiquidity: async () => 1000n, dailyPayoutCap: async () => 800n });
    if (mode === 'runtime') options.provider.getCode = async () => '0x';
    if (mode === 'chain') options.provider.send = async () => '0x1';
    if (mode === 'simulation') options.provider.call = async () => { throw new Error('revert'); };
    await assert.rejects(relayNativeOnce(options), /HOLD/);
    assert.deepEqual(records, ['HOLD']); assert.equal(calls.includes('broadcast'), false);
  });
}
test('ambiguous broadcast error stays held with no retry and redacted error', async () => {
  const { options, records } = await fixture();
  options.provider.broadcastTransaction = async () => { throw new Error('https://private-rpc/secret'); };
  await assert.rejects(relayNativeOnce(options), error => /HOLD/.test(error.message) && !error.message.includes('secret'));
  assert.deepEqual(records, ['BROADCAST_ATTEMPT', 'HOLD']);
  await assert.rejects(relayNativeOnce(options), /duplicate/);
});
test('journal survives restart and blocks simultaneous/duplicate attempts', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-relay-'));
  try {
    const directory = path.join(parent, 'approved-attempt');
    const journal = createNativeRelayJournal(directory);
    journal.claim({ operationId: hash('1'), action: 'release', transactionHash: hash('2') });
    journal.record('HOLD');
    assert.throws(() => createNativeRelayJournal(directory).claim({}), /EEXIST/);
    assert.equal(fs.existsSync(path.join(directory, 'HOLD')), true);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
