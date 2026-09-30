const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('NativeLiquidityVault', function () {
  let owner, guardian, user, recipient, outsider, validators, vault;
  const targetChain = 1;

  async function deploy() {
    [owner, guardian, user, recipient, outsider, ...validators] = await ethers.getSigners();
    validators = validators.slice(0, 5);
    const factory = await ethers.getContractFactory('NativeLiquidityVault');
    vault = await factory.deploy(owner.address, validators.map((signer) => signer.address));
    await vault.deployed();
  }

  async function configure(depositCap = 1000, payoutCap = 1000) {
    await vault.setRoute(targetChain, outsider.address);
    await vault.setDailyCaps(depositCap, payoutCap);
    await vault.setPauseGuardian(guardian.address);
    await vault.unpause();
  }

  async function signatures(digest, signers = validators.slice(0, 3)) {
    const values = await Promise.all(signers.map(async (signer) => ({
      address: signer.address.toLowerCase(),
      signature: await signer.signMessage(ethers.utils.arrayify(digest)),
    })));
    values.sort((a, b) => a.address.localeCompare(b.address));
    return values.map((value) => value.signature);
  }

  function releaseRequest(operationId, sourceTxHash, expiry, outputAmount = 90) {
    return {
      operationId,
      sourceChain: targetChain,
      sourceVault: outsider.address,
      sourceTxHash,
      sourceAmount: 100,
      recipient: recipient.address,
      outputAmount,
      authorizationExpiry: expiry,
    };
  }

  beforeEach(deploy);

  it('starts paused and requires the exact five-validator policy', async function () {
    expect(await vault.paused()).to.equal(true);
    expect(await vault.signaturesRequired()).to.equal(3);
    expect(await vault.getValidators()).to.deep.equal(validators.map((signer) => signer.address));
    const factory = await ethers.getContractFactory('NativeLiquidityVault');
    await expect(factory.deploy(owner.address, validators.slice(0, 4).map((signer) => signer.address)))
      .to.be.revertedWith('Exactly five validators required');
    await expect(factory.deploy(owner.address, [
      validators[0].address, validators[1].address, validators[2].address,
      validators[3].address, validators[3].address,
    ])).to.be.revertedWith('Invalid validator');
  });

  it('refuses activation without routes, finite caps and a separate guardian', async function () {
    await expect(vault.unpause()).to.be.revertedWith('No routes configured');
    await vault.setRoute(targetChain, outsider.address);
    await expect(vault.unpause()).to.be.revertedWith('Caps not configured');
    await expect(vault.setDailyCaps(0, 1)).to.be.revertedWith('Finite caps required');
    await vault.setDailyCaps(100, 100);
    await expect(vault.setPauseGuardian(owner.address)).to.be.revertedWith('Guardian must be separate');
    await expect(vault.unpause()).to.be.revertedWith('Guardian not configured');
  });

  it('escrows native input without treating it as payout liquidity', async function () {
    await configure();
    await vault.fundLiquidity({ value: 500 });
    const operationId = ethers.utils.id('deposit-1');
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    await expect(vault.connect(user).depositNative(
      operationId, targetChain, recipient.address, 90, now + 600, { value: 100 },
    )).to.emit(vault, 'NativeDeposited');
    expect(await vault.outstandingEscrow()).to.equal(100);
    expect(await vault.availableLiquidity()).to.equal(500);
    await expect(vault.connect(user).depositNative(
      operationId, targetChain, recipient.address, 90, now + 600, { value: 100 },
    )).to.be.revertedWith('Operation exists');
  });

  it('releases native output with three ordered validator signatures and rejects replay', async function () {
    await configure();
    await vault.fundLiquidity({ value: 500 });
    const operationId = ethers.utils.id('release-1');
    const sourceTxHash = ethers.utils.id('source-tx');
    const expiry = (await ethers.provider.getBlock('latest')).timestamp + 600;
    const request = releaseRequest(operationId, sourceTxHash, expiry);
    const digest = await vault.releaseDigest(request);
    const sigs = await signatures(digest);
    await expect(vault.releaseNative(request, sigs)).to.emit(vault, 'NativeReleased');
    expect(await vault.processedReleases(operationId)).to.equal(true);
    expect(await vault.availableLiquidity()).to.equal(410);
    await expect(vault.releaseNative(request, sigs)).to.be.revertedWith('Operation processed');
  });

  it('rejects incorrect counts, duplicate, outsider and wrong-message signatures', async function () {
    await configure();
    await vault.fundLiquidity({ value: 500 });
    const operationId = ethers.utils.id('release-invalid');
    const sourceTxHash = ethers.utils.id('source-invalid');
    const expiry = (await ethers.provider.getBlock('latest')).timestamp + 600;
    const request = releaseRequest(operationId, sourceTxHash, expiry);
    const digest = await vault.releaseDigest(request);
    await expect(vault.releaseNative(request, await signatures(digest, validators.slice(0, 2))))
      .to.be.revertedWith('Exactly three signatures required');
    await expect(vault.releaseNative(request, await signatures(digest, validators.slice(0, 4))))
      .to.be.revertedWith('Exactly three signatures required');
    await expect(vault.releaseNative(request, await signatures(digest, [validators[0], validators[0], validators[1]])))
      .to.be.revertedWith('Signatures not ordered');
    await expect(vault.releaseNative(request, await signatures(digest, [validators[0], validators[1], outsider])))
      .to.be.revertedWith('Invalid signer');
    const wrongDigest = await vault.releaseDigest({ ...request, outputAmount: 91 });
    await expect(vault.releaseNative(request, await signatures(wrongDigest)))
      .to.be.revertedWith('Invalid signer');
    expect(await vault.processedReleases(operationId)).to.equal(false);
  });

  it('binds releases to the configured source vault', async function () {
    await configure();
    await vault.fundLiquidity({ value: 500 });
    const expiry = (await ethers.provider.getBlock('latest')).timestamp + 600;
    const request = {
      ...releaseRequest(ethers.utils.id('wrong-source-vault'), ethers.utils.id('source'), expiry),
      sourceVault: user.address,
    };
    const digest = await vault.releaseDigest(request);
    await expect(vault.releaseNative(request, await signatures(digest)))
      .to.be.revertedWith('Invalid source');
  });

  it('finalizes a paid deposit or refunds an expired deposit, never both', async function () {
    await configure();
    const operationId = ethers.utils.id('finalize-1');
    let now = (await ethers.provider.getBlock('latest')).timestamp;
    await vault.connect(user).depositNative(
      operationId, targetChain, recipient.address, 90, now + 60, { value: 100 },
    );
    const destinationTxHash = ethers.utils.id('destination-payout');
    const finalizeSigs = await signatures(await vault.finalizeDigest(operationId, destinationTxHash));
    await expect(vault.finalizeDeposit(operationId, destinationTxHash, finalizeSigs))
      .to.emit(vault, 'DepositFinalized');
    expect(await vault.outstandingEscrow()).to.equal(0);
    await ethers.provider.send('evm_increaseTime', [61]);
    await ethers.provider.send('evm_mine', []);
    now = (await ethers.provider.getBlock('latest')).timestamp;
    await expect(vault.refundDeposit(operationId, now + 60, []))
      .to.be.revertedWith('Deposit not pending');

    const refundId = ethers.utils.id('refund-1');
    await vault.connect(user).depositNative(
      refundId, targetChain, recipient.address, 45, now + 30, { value: 50 },
    );
    await ethers.provider.send('evm_increaseTime', [31]);
    await ethers.provider.send('evm_mine', []);
    const refundExpiry = (await ethers.provider.getBlock('latest')).timestamp + 60;
    const refundSigs = await signatures(await vault.refundDigest(refundId, refundExpiry));
    await expect(vault.refundDeposit(refundId, refundExpiry, refundSigs))
      .to.emit(vault, 'DepositRefunded');
    expect((await vault.deposits(refundId)).state).to.equal(3);
    await expect(vault.finalizeDeposit(refundId, destinationTxHash, finalizeSigs))
      .to.be.revertedWith('Deposit not pending');
  });

  it('protects escrow from payout and governance withdrawal', async function () {
    await configure();
    const operationId = ethers.utils.id('reserved');
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    await vault.connect(user).depositNative(
      operationId, targetChain, recipient.address, 100, now + 600, { value: 100 },
    );
    const releaseId = ethers.utils.id('no-liquidity');
    const sourceTxHash = ethers.utils.id('no-liquidity-source');
    const request = releaseRequest(releaseId, sourceTxHash, now + 600, 1);
    const digest = await vault.releaseDigest(request);
    await expect(vault.releaseNative(request, await signatures(digest)))
      .to.be.revertedWith('Insufficient free liquidity');
    await vault.connect(guardian).pause();
    await expect(vault.withdrawLiquidity(owner.address, 1)).to.be.revertedWith('Escrow reserved');
  });

  it('enforces independent finite deposit and payout caps', async function () {
    await configure(100, 50);
    await vault.fundLiquidity({ value: 500 });
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    await vault.connect(user).depositNative(
      ethers.utils.id('cap-deposit-1'), targetChain, recipient.address, 90,
      now + 600, { value: 100 },
    );
    await expect(vault.connect(user).depositNative(
      ethers.utils.id('cap-deposit-2'), targetChain, recipient.address, 1,
      now + 600, { value: 1 },
    )).to.be.revertedWith('Deposit cap exceeded');

    const operationId = ethers.utils.id('cap-release');
    const sourceTxHash = ethers.utils.id('cap-source');
    const request = releaseRequest(operationId, sourceTxHash, now + 600, 51);
    const digest = await vault.releaseDigest(request);
    await expect(vault.releaseNative(request, await signatures(digest)))
      .to.be.revertedWith('Payout cap exceeded');
  });
});
