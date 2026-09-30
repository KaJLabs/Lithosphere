const { expect } = require('chai');
const assert = require('node:assert/strict');
const { ethers } = require('hardhat');
const crypto = require('crypto');
const {
  verifyFactoryTransaction, verifyPristineVaultHistory,
} = require('../scripts/native-mesh/verify-paused-deployment.cjs');

const FACTORY = '0x1111111111111111111111111111111111111111';
const VAULT = '0x2222222222222222222222222222222222222222';
const TX = `0x${'31'.repeat(32)}`;
const BLOCK_HASH = `0x${'32'.repeat(32)}`;
const CODE = '0x6001600055';
const hash = code => crypto.createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex');
const topics = [
  ethers.utils.id('OwnershipTransferred(address,address)'),
  ethers.utils.id('ValidatorSetUpdated(address[])'),
  ethers.utils.id('Paused(address)'),
];

function fixture() {
  const constructorLogs = topics.map((topic, logIndex) => ({
    address: VAULT, blockNumber: 12, blockHash: BLOCK_HASH, transactionHash: TX,
    logIndex, topics: [topic], data: '0x', removed: false,
  }));
  const state = { beforeCode: '0x', afterCode: CODE, blockHash: BLOCK_HASH,
    history: [...constructorLogs], constructorLogs: [...constructorLogs] };
  const provider = {
    getTransaction: async () => ({ to: FACTORY, value: ethers.BigNumber.from(0), data: '0x1234' }),
    getTransactionReceipt: async () => ({
      status: 1, blockNumber: 12, blockHash: BLOCK_HASH, logs: state.constructorLogs,
    }),
    getBlock: async () => ({ hash: state.blockHash }),
    getCode: async (_address, blockTag) => blockTag === 11 ? state.beforeCode : state.afterCode,
    getLogs: async () => state.history,
  };
  return { provider, state };
}

describe('Native mesh post-deployment provenance', function () {
  it('requires canonical empty-before/code-after creation and exact factory calldata', async function () {
    const { provider, state } = fixture();
    const expected = { to: FACTORY, data: '0x1234' };
    const result = await verifyFactoryTransaction(provider, expected, TX, 20, 'vault', VAULT, hash(CODE));
    expect(result.blockNumber).to.equal(12);
    await assert.rejects(verifyFactoryTransaction(provider, expected, TX, 13, 'vault', VAULT, hash(CODE), 3),
      /lacks required confirmations/);
    state.beforeCode = CODE;
    await assert.rejects(verifyFactoryTransaction(provider, expected, TX, 20, 'vault', VAULT, hash(CODE)),
      /code existed before creation/);
    state.beforeCode = '0x'; state.blockHash = `0x${'33'.repeat(32)}`;
    await assert.rejects(verifyFactoryTransaction(provider, expected, TX, 20, 'vault', VAULT, hash(CODE)),
      /receipt is not canonical/);
  });

  it('rejects hidden cancellation history even if aggregate counters return to zero', async function () {
    const { provider, state } = fixture();
    const deployment = { transactionHash: TX, blockNumber: 12, blockHash: BLOCK_HASH };
    expect(await verifyPristineVaultHistory(provider, VAULT, deployment, 20)).to.equal(3);
    state.history.push({
      ...state.history[0], blockNumber: 15, logIndex: 4,
      transactionHash: `0x${'40'.repeat(32)}`,
      topics: [ethers.utils.id('ReleaseCancelled(bytes32,uint256,bytes32)')],
    });
    await assert.rejects(verifyPristineVaultHistory(provider, VAULT, deployment, 20),
      /post-constructor event history/);
  });

  it('requires a complete constructor event record', async function () {
    const { provider, state } = fixture();
    state.constructorLogs.pop();
    await assert.rejects(verifyPristineVaultHistory(provider, VAULT,
      { transactionHash: TX, blockNumber: 12, blockHash: BLOCK_HASH }, 20),
    /constructor event evidence incomplete/);
  });
});
