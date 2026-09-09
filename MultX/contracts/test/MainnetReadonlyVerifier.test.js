const { expect } = require('chai');
const {
  verifyCreationProvenance,
  verifyExactValidatorSet,
} = require('../scripts/mainnet/verify-deployment-readonly');

const validators = Array.from({ length: 7 }, (_, index) =>
  `0x${String(index + 1).padStart(40, '0')}`
);

const bridgeWith = (live) => ({
  getValidatorCount: async () => ({ toString: () => String(live.length) }),
  getValidators: async () => live,
});

describe('deployment creation provenance', function () {
  const address = '0x1111111111111111111111111111111111111111';
  const txHash = `0x${'1'.repeat(64)}`;

  it('rejects a successful receipt for another contract with all other provenance valid', async function () {
    const provider = {
      getTransactionReceipt: async () => ({ status: 1, blockNumber: 100, contractAddress: validators[0] }),
      getTransaction: async () => ({ hash: txHash, from: address, data: '0x60006000' }),
      getCode: async (_address, block) => block === 99 ? '0x' : '0x6000',
    };
    await expectReject(verifyCreationProvenance(provider, address, txHash, 100, 'bridge', address, '0x6000'), /receipt contract address mismatch/);
  });

  it('accepts a successful receipt and exact empty-to-code boundary', async function () {
    const provider = {
      getTransactionReceipt: async () => ({ status: 1, blockNumber: 100, contractAddress: address }),
      getTransaction: async () => ({ hash: txHash, from: address, data: '0x60006000' }),
      getCode: async (_address, block) => block === 99 ? '0x' : '0x6000',
    };
    expect(await verifyCreationProvenance(provider, address, txHash, 100, 'bridge', address, '0x6000')).to.equal(100);
  });

  it('rejects caller-selected historical starts without creation proof', async function () {
    const provider = {
      getTransactionReceipt: async () => ({ status: 1, blockNumber: 99, contractAddress: address }),
      getTransaction: async () => ({ hash: txHash, from: address, data: '0x60006000' }),
      getCode: async () => '0x6000',
    };
    await expectReject(verifyCreationProvenance(provider, address, txHash, 100, 'bridge', address, '0x6000'), /does not prove/);
  });

  it('rejects the wrong deployer or unaudited creation bytecode', async function () {
    const provider = {
      getTransactionReceipt: async () => ({ status: 1, blockNumber: 100, contractAddress: address }),
      getTransaction: async () => ({ hash: txHash, from: address, data: '0x60006000' }),
      getCode: async (_address, block) => block === 99 ? '0x' : '0x6000',
    };
    await expectReject(
      verifyCreationProvenance(provider, address, txHash, 100, 'bridge',
        '0x2222222222222222222222222222222222222222', '0x6000'),
      /provenance mismatch/,
    );
    await expectReject(
      verifyCreationProvenance(provider, address, txHash, 100, 'bridge', address, '0x6100'),
      /audited creation bytecode/,
    );
  });
});

async function expectReject(promise, pattern) {
  try {
    await promise;
    expect.fail('expected verifier to reject');
  } catch (error) {
    expect(error.message).to.match(pattern);
  }
}

describe('mainnet read-only validator verification', function () {
  it('accepts exactly the complete manifest validator set', async function () {
    expect(await verifyExactValidatorSet(bridgeWith(validators), validators, 'LITHO')).to.deep.equal(validators);
  });

  it('rejects seven expected validators plus one hidden live validator', async function () {
    const live = [...validators, '0x0000000000000000000000000000000000000008'];
    await expectReject(verifyExactValidatorSet(bridgeWith(live), validators, 'LITHO'), /live validator count 8/);
  });

  it('rejects seven expected validators plus five hidden live validators', async function () {
    const extra = Array.from({ length: 5 }, (_, index) =>
      `0x${String(index + 8).padStart(40, '0')}`
    );
    await expectReject(
      verifyExactValidatorSet(bridgeWith([...validators, ...extra]), validators, 'LITHO'),
      /live validator count 12/
    );
  });
});
