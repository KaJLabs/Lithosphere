const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('NativeLiquidityVault', function () {
  let owner, guardian, user, recipient, outsider, validators, vault;
  const remoteChain = 1;
  const finalityDelay = 120;

  async function deploy() {
    [owner, guardian, user, recipient, outsider, ...validators] = await ethers.getSigners();
    validators = validators.slice(0, 5);
    vault = await (await ethers.getContractFactory('NativeLiquidityVault'))
      .deploy(owner.address, validators.map(signer => signer.address));
    await vault.deployed();
  }

  async function configure(depositCap = 1000, payoutCap = 1000) {
    await vault.setRoute(remoteChain, outsider.address, finalityDelay);
    await vault.setDailyCaps(depositCap, payoutCap);
    await vault.setPauseGuardian(guardian.address);
    await vault.unpause();
  }

  async function signatures(digest, signers = validators.slice(0, 3)) {
    const values = await Promise.all(signers.map(async signer => ({
      address: signer.address.toLowerCase(),
      signature: await signer.signMessage(ethers.utils.arrayify(digest)),
    })));
    return values.sort((a, b) => a.address.localeCompare(b.address)).map(value => value.signature);
  }

  async function deposit(clientReference, amount = 100, output = 90, lifetime = 60) {
    const nonce = await vault.depositNonces(user.address);
    const operationId = await vault.deriveOperationId(user.address, nonce, clientReference);
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    const quoteExpiry = now + lifetime;
    await vault.connect(user).depositNative(
      clientReference, remoteChain, recipient.address, output, quoteExpiry, { value: amount },
    );
    return { operationId, nonce, quoteExpiry };
  }

  function releaseRequest(operationId, sourceNonce, releaseDeadline, overrides = {}) {
    return {
      operationId,
      sourceChain: remoteChain,
      sourceVault: outsider.address,
      sourceDepositor: user.address,
      sourceNonce,
      clientReference: ethers.utils.id('remote-client'),
      sourceTxHash: ethers.utils.id('source-tx'),
      sourceAmount: 100,
      recipient: recipient.address,
      outputAmount: 90,
      sourceQuoteExpiry: releaseDeadline,
      releaseDeadline,
      authorizationExpiry: releaseDeadline,
      ...overrides,
    };
  }

  function cancelRequest(request, authorizationExpiry) {
    return {
      operationId: request.operationId,
      sourceChain: request.sourceChain,
      sourceVault: request.sourceVault,
      sourceDepositor: request.sourceDepositor,
      sourceNonce: request.sourceNonce,
      clientReference: request.clientReference,
      sourceTxHash: request.sourceTxHash,
      sourceQuoteExpiry: request.sourceQuoteExpiry,
      releaseDeadline: request.releaseDeadline,
      authorizationExpiry,
    };
  }

  function refundRequest(operationId, authorizationExpiry) {
    return {
      operationId,
      cancellationTxHash: ethers.utils.id('cancel-tx'),
      cancellationBlockHash: ethers.utils.id('cancel-block'),
      cancellationBlockNumber: 123,
      authorizationExpiry,
    };
  }

  beforeEach(deploy);

  it('starts paused with exact 3-of-5 policy', async function () {
    expect(await vault.paused()).to.equal(true);
    expect(await vault.signaturesRequired()).to.equal(3);
    const factory = await ethers.getContractFactory('NativeLiquidityVault');
    await expect(factory.deploy(owner.address, validators.slice(0, 4).map(v => v.address)))
      .to.be.revertedWith('Exactly five validators required');
  });

  it('requires routes, finite caps, finality delay and a separate guardian', async function () {
    await expect(vault.setRoute(remoteChain, outsider.address, 0)).to.be.revertedWith('Finality delay required');
    await vault.setRoute(remoteChain, outsider.address, finalityDelay);
    await expect(vault.unpause()).to.be.revertedWith('Caps not configured');
    await expect(vault.setDailyCaps(0, 1)).to.be.revertedWith('Finite caps required');
    await vault.setDailyCaps(100, 100);
    await expect(vault.setPauseGuardian(owner.address)).to.be.revertedWith('Guardian must be separate');
  });

  it('derives depositor-namespaced operation IDs and prevents reference squatting', async function () {
    await configure();
    const reference = ethers.utils.id('shared-client-reference');
    const userId = await vault.deriveOperationId(user.address, 0, reference);
    const outsiderId = await vault.deriveOperationId(outsider.address, 0, reference);
    expect(userId).not.to.equal(outsiderId);
    await vault.connect(outsider).depositNative(reference, remoteChain, recipient.address, 1, 9999999999, { value: 1 });
    await expect(vault.connect(user).depositNative(reference, remoteChain, recipient.address, 90, 9999999999, { value: 100 }))
      .to.emit(vault, 'NativeDeposited').withArgs(userId, user.address, recipient.address, 100, remoteChain, 90, 9999999999);
  });

  it('escrows source funds separately from payout liquidity', async function () {
    await configure();
    await vault.fundLiquidity({ value: 500 });
    await deposit(ethers.utils.id('escrow'));
    expect(await vault.outstandingEscrow()).to.equal(100);
    expect(await vault.availableLiquidity()).to.equal(500);
  });

  it('binds release identity and enforces its deadline', async function () {
    await configure();
    await vault.fundLiquidity({ value: 500 });
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    const request = releaseRequest(
      await vault.deriveSourceOperationId(remoteChain, outsider.address, user.address, 0, ethers.utils.id('remote-client')),
      0, now + 60,
    );
    await expect(vault.releaseNative({ ...request, sourceNonce: 1 }, []))
      .to.be.revertedWith('Invalid operation identity');
    await expect(vault.releaseNative({ ...request, authorizationExpiry: now + 61 }, []))
      .to.be.revertedWith('Invalid authorization window');
    await expect(vault.releaseNative({ ...request, sourceQuoteExpiry: now + 59 }, []))
      .to.be.revertedWith('Release exceeds source quote');
    const digest = await vault.releaseDigest(request);
    await expect(vault.releaseNative(request, await signatures(digest))).to.emit(vault, 'NativeReleased');
    expect(await vault.releaseStates(request.operationId)).to.equal(1);
    await expect(vault.releaseNative(request, await signatures(digest))).to.be.revertedWith('Operation terminal');
  });

  it('requires exactly three distinct ordered validator signatures', async function () {
    await configure();
    await vault.fundLiquidity({ value: 500 });
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    const request = releaseRequest(
      await vault.deriveSourceOperationId(remoteChain, outsider.address, user.address, 0, ethers.utils.id('remote-client')),
      0, now + 60,
    );
    const digest = await vault.releaseDigest(request);
    await expect(vault.releaseNative(request, await signatures(digest, validators.slice(0, 2))))
      .to.be.revertedWith('Exactly three signatures required');
    await expect(vault.releaseNative(request, await signatures(digest, [validators[0], validators[0], validators[1]])))
      .to.be.revertedWith('Signatures not ordered');
    await expect(vault.releaseNative(request, await signatures(digest, [validators[0], validators[1], outsider])))
      .to.be.revertedWith('Invalid signer');
  });

  it('makes cancellation and payout mutually exclusive', async function () {
    await configure();
    await vault.fundLiquidity({ value: 500 });
    let now = (await ethers.provider.getBlock('latest')).timestamp;
    const request = releaseRequest(
      await vault.deriveSourceOperationId(remoteChain, outsider.address, user.address, 0, ethers.utils.id('remote-client')),
      0, now + 30,
    );
    let cancel = cancelRequest(request, now + 120);
    await expect(vault.cancelRelease(cancel, [])).to.be.revertedWith('Release window active');
    await ethers.provider.send('evm_increaseTime', [31]);
    await ethers.provider.send('evm_mine', []);
    now = (await ethers.provider.getBlock('latest')).timestamp;
    cancel = { ...cancel, authorizationExpiry: now + 60 };
    await expect(vault.cancelRelease(cancel, await signatures(await vault.cancelDigest(cancel))))
      .to.emit(vault, 'ReleaseCancelled');
    expect(await vault.releaseStates(request.operationId)).to.equal(2);
    await expect(vault.releaseNative(request, await signatures(await vault.releaseDigest(request))))
      .to.be.revertedWith('Operation terminal');
  });

  it('refuses cancellation after payout, including while paused', async function () {
    await configure();
    await vault.fundLiquidity({ value: 500 });
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    const request = releaseRequest(
      await vault.deriveSourceOperationId(remoteChain, outsider.address, user.address, 0, ethers.utils.id('remote-client')),
      0, now + 30,
    );
    await vault.releaseNative(request, await signatures(await vault.releaseDigest(request)));
    await vault.connect(guardian).pause();
    await ethers.provider.send('evm_increaseTime', [31]);
    await ethers.provider.send('evm_mine', []);
    const cancel = cancelRequest(request, now + 120);
    await expect(vault.cancelRelease(cancel, await signatures(await vault.cancelDigest(cancel))))
      .to.be.revertedWith('Operation terminal');
  });

  it('requires finalized destination cancellation evidence before refund', async function () {
    await configure();
    const { operationId, quoteExpiry } = await deposit(ethers.utils.id('refund'));
    await ethers.provider.send('evm_setNextBlockTimestamp', [quoteExpiry + 1]);
    await ethers.provider.send('evm_mine', []);
    let now = (await ethers.provider.getBlock('latest')).timestamp;
    let request = refundRequest(operationId, now + 300);
    await expect(vault.refundDeposit(request, [])).to.be.revertedWith('Cancellation not final');
    await ethers.provider.send('evm_setNextBlockTimestamp', [quoteExpiry + finalityDelay + 1]);
    await ethers.provider.send('evm_mine', []);
    now = (await ethers.provider.getBlock('latest')).timestamp;
    request = { ...request, authorizationExpiry: now + 60 };
    await expect(vault.refundDeposit({ ...request, cancellationTxHash: ethers.constants.HashZero }, []))
      .to.be.revertedWith('Cancellation proof required');
    await expect(vault.refundDeposit(request, await signatures(await vault.refundDigest(request))))
      .to.emit(vault, 'DepositRefunded');
    expect((await vault.deposits(operationId)).state).to.equal(3);
  });

  it('retains the approved finality delay when a route is later changed', async function () {
    await configure();
    const { operationId, quoteExpiry } = await deposit(ethers.utils.id('fixed-finality'));
    await vault.connect(guardian).pause();
    await vault.setRoute(remoteChain, outsider.address, 1);
    await vault.unpause();
    await ethers.provider.send('evm_setNextBlockTimestamp', [quoteExpiry + 2]);
    await ethers.provider.send('evm_mine', []);
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    await expect(vault.refundDeposit(refundRequest(operationId, now + 300), []))
      .to.be.revertedWith('Cancellation not final');
  });

  it('finalize and refund remain mutually exclusive', async function () {
    await configure();
    const { operationId } = await deposit(ethers.utils.id('finalize'), 100, 90, 300);
    const destinationTxHash = ethers.utils.id('destination-payout');
    await vault.finalizeDeposit(operationId, destinationTxHash, await signatures(await vault.finalizeDigest(operationId, destinationTxHash)));
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    await expect(vault.refundDeposit(refundRequest(operationId, now + 60), []))
      .to.be.revertedWith('Deposit not pending');
  });

  it('protects escrow from payout and governance withdrawal', async function () {
    await configure();
    await deposit(ethers.utils.id('reserved'));
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    const request = releaseRequest(
      await vault.deriveSourceOperationId(remoteChain, outsider.address, user.address, 0, ethers.utils.id('remote-client')),
      0, now + 60, { outputAmount: 1 },
    );
    await expect(vault.releaseNative(request, await signatures(await vault.releaseDigest(request))))
      .to.be.revertedWith('Insufficient free liquidity');
    await vault.connect(guardian).pause();
    await expect(vault.withdrawLiquidity(owner.address, 1)).to.be.revertedWith('Escrow reserved');
  });

  it('enforces independent finite deposit and payout caps', async function () {
    await configure(100, 50);
    await vault.fundLiquidity({ value: 500 });
    await deposit(ethers.utils.id('cap-deposit'), 100, 90, 600);
    await expect(vault.connect(user).depositNative(
      ethers.utils.id('cap-extra'), remoteChain, recipient.address, 1, 9999999999, { value: 1 },
    )).to.be.revertedWith('Deposit cap exceeded');
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    const request = releaseRequest(
      await vault.deriveSourceOperationId(remoteChain, outsider.address, user.address, 0, ethers.utils.id('remote-client')),
      0, now + 60, { outputAmount: 51 },
    );
    await expect(vault.releaseNative(request, await signatures(await vault.releaseDigest(request))))
      .to.be.revertedWith('Payout cap exceeded');
  });
});
