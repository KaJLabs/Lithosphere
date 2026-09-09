const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultXBridge", function () {
  let bridge, token, owner, validator1, validator2, validator3, user;
  const SECP256K1_ORDER = ethers.BigNumber.from(
    "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"
  );

  // Helper: sort signatures by signer address (ascending) as required by contract
  async function getSortedSignatures(signers, msgHash) {
    const signed = [];
    for (const signer of signers) {
      const sig = await signer.signMessage(ethers.utils.arrayify(msgHash));
      signed.push({ address: signer.address, sig });
    }
    signed.sort((a, b) => a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1);
    return signed.map(s => s.sig);
  }

  function toHighSSignature(signature) {
    const split = ethers.utils.splitSignature(signature);
    const highS = SECP256K1_ORDER.sub(split.s);
    const flippedV = split.v === 27 ? 28 : 27;
    return ethers.utils.hexConcat([
      split.r,
      ethers.utils.hexZeroPad(highS.toHexString(), 32),
      ethers.utils.hexlify(flippedV),
    ]);
  }

  async function getReleaseHash(sourceTxHash, amount, sourceChain, sourceNonce, sourceBridge = owner.address) {
    const { chainId } = await ethers.provider.getNetwork();
    return ethers.utils.solidityKeccak256(
      ["bytes32", "address", "address", "address", "uint256", "uint256", "uint256", "uint256", "address"],
      [sourceTxHash, sourceBridge, token.address, user.address, amount, sourceChain, sourceNonce, chainId, bridge.address]
    );
  }

  beforeEach(async function () {
    [owner, validator1, validator2, validator3, user] = await ethers.getSigners();

    // Deploy MockERC20
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("Lithosphere", "LITHO", 18);
    await token.deployed();

    // Deploy MultXBridge
    const MultXBridge = await ethers.getContractFactory("MultXBridge");
    const validators = [validator1.address, validator2.address, validator3.address];
    bridge = await MultXBridge.deploy(validators, 2);
    await bridge.deployed();

    // Add token to supported list
    await bridge.addSupportedToken(token.address);
    await bridge.setSupportedRoute(token.address, 1, true);

    // Mint tokens to user
    await token.mint(user.address, ethers.utils.parseEther("1000"));
  });

  it("Rejects duplicate validators at deployment", async function () {
    const MultXBridge = await ethers.getContractFactory("MultXBridge");
    await expect(
      MultXBridge.deploy([validator1.address, validator1.address], 2)
    ).to.be.revertedWith("Duplicate validator address");
  });

  it("Rejects duplicate validators during rotation", async function () {
    await expect(
      bridge.setValidatorSet([validator1.address, validator1.address], 2)
    ).to.be.revertedWith("Duplicate validator address");
  });

  it("Should lock tokens", async function () {
    const amount = ethers.utils.parseEther("100");
    const targetChain = 1;

    await token.connect(user).approve(bridge.address, amount);

    const tx = await bridge.connect(user).lockTokens(token.address, amount, targetChain);
    const receipt = await tx.wait();

    const event = receipt.events.find(e => e.event === "TokensLocked");
    expect(event).to.exist;
    expect(event.args.token).to.equal(token.address);
    expect(event.args.user).to.equal(user.address);
    expect(event.args.amount).to.equal(amount);
    expect(event.args.targetChain).to.equal(targetChain);

    const bridgeBalance = await token.balanceOf(bridge.address);
    expect(bridgeBalance).to.equal(amount);
  });

  it("Rejects an unsupported token/target route on chain", async function () {
    const amount = ethers.utils.parseEther("1");
    await token.connect(user).approve(bridge.address, amount);
    await expect(
      bridge.connect(user).lockTokens(token.address, amount, 11155111)
    ).to.be.revertedWith("Route not supported");
  });

  it("Rejects fee-on-transfer tokens whose received balance differs from amount", async function () {
    const FeeToken = await ethers.getContractFactory("MockFeeOnTransferERC20");
    const feeToken = await FeeToken.deploy();
    await feeToken.deployed();
    const amount = ethers.utils.parseEther("100");
    await feeToken.transfer(user.address, amount);
    await bridge.addSupportedToken(feeToken.address);
    await bridge.setSupportedRoute(feeToken.address, 1, true);
    await feeToken.connect(user).approve(bridge.address, amount.mul(99).div(100));

    await expect(
      bridge.connect(user).lockTokens(feeToken.address, amount.mul(99).div(100), 1)
    ).to.be.revertedWith("Unsupported token transfer semantics");
  });

  it("Should release tokens with valid signatures", async function () {
    const amount = ethers.utils.parseEther("100");
    const targetChain = 1;

    // Lock tokens first
    await token.connect(user).approve(bridge.address, amount);
    const lockTx = await bridge.connect(user).lockTokens(token.address, amount, targetChain);
    const lockReceipt = await lockTx.wait();
    const lockEvent = lockReceipt.events.find(e => e.event === "TokensLocked");
    const sourceTxHash = lockEvent.args.txHash;
    const sourceNonce = lockEvent.args.nonce;
    const sourceChain = 1;

    // Create message hash
    const msgHash = await getReleaseHash(sourceTxHash, amount, sourceChain, sourceNonce);

    // Get sorted signatures from 2 validators
    const signatures = await getSortedSignatures([validator1, validator2], msgHash);

    // Release tokens
    const releaseTx = await bridge.releaseTokens(
      token.address,
      user.address,
      amount,
      sourceChain,
      owner.address,
      sourceNonce,
      sourceTxHash,
      signatures
    );
    const releaseReceipt = await releaseTx.wait();

    const releaseEvent = releaseReceipt.events.find(e => e.event === "TokensReleased");
    expect(releaseEvent).to.exist;
    expect(releaseEvent.args.token).to.equal(token.address);
    expect(releaseEvent.args.user).to.equal(user.address);

    const userBalance = await token.balanceOf(user.address);
    expect(userBalance).to.equal(ethers.utils.parseEther("1000"));
  });

  it("Should enforce the configured cap independently on releases", async function () {
    const cap = ethers.utils.parseEther("10");
    const firstAmount = ethers.utils.parseEther("6");
    const secondAmount = ethers.utils.parseEther("5");
    await bridge.setDailyCap(token.address, cap);
    await token.mint(bridge.address, firstAmount.add(secondAmount));

    const firstTxHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("release-cap-1"));
    const firstHash = await getReleaseHash(firstTxHash, firstAmount, 1, 501);
    const firstSigs = await getSortedSignatures([validator1, validator2], firstHash);
    await bridge.releaseTokens(
      token.address, user.address, firstAmount, 1, owner.address, 501, firstTxHash, firstSigs
    );

    expect(await bridge.releaseVolume(token.address)).to.equal(firstAmount);
    expect(await bridge.getDailyReleaseRemaining(token.address)).to.equal(cap.sub(firstAmount));

    const secondTxHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("release-cap-2"));
    const secondHash = await getReleaseHash(secondTxHash, secondAmount, 1, 502);
    const secondSigs = await getSortedSignatures([validator1, validator2], secondHash);
    await expect(
      bridge.releaseTokens(
        token.address, user.address, secondAmount, 1, owner.address, 502, secondTxHash, secondSigs
      )
    ).to.be.revertedWith("Release cap exceeded");
    expect(await bridge.processedNonces(1, owner.address, 502)).to.equal(false);
  });

  it("Should reject duplicate nonce", async function () {
    const amount = ethers.utils.parseEther("100");
    const targetChain = 1;

    // Lock tokens
    await token.connect(user).approve(bridge.address, amount.mul(2));
    const lockTx = await bridge.connect(user).lockTokens(token.address, amount, targetChain);
    const lockReceipt = await lockTx.wait();
    const lockEvent = lockReceipt.events.find(e => e.event === "TokensLocked");
    const sourceTxHash = lockEvent.args.txHash;
    const sourceNonce = lockEvent.args.nonce;
    const sourceChain = 1;

    const msgHash = await getReleaseHash(sourceTxHash, amount, sourceChain, sourceNonce);

    const signatures = await getSortedSignatures([validator1, validator2], msgHash);

    // Release tokens once
    await bridge.releaseTokens(
      token.address,
      user.address,
      amount,
      sourceChain,
      owner.address,
      sourceNonce,
      sourceTxHash,
      signatures
    );

    // Try to release again with same nonce
    await expect(
      bridge.releaseTokens(
        token.address,
        user.address,
        amount,
        sourceChain,
        owner.address,
        sourceNonce,
        sourceTxHash,
        signatures
      )
    ).to.be.revertedWith("Nonce already processed");
  });

  it("Namespaces replay protection by source bridge", async function () {
    const amount = ethers.utils.parseEther("1");
    const sourceChain = 1;
    const sourceNonce = 777;
    const sourceTxHashA = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("source-a"));
    const sourceTxHashB = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("source-b"));
    const sourceBridgeA = owner.address;
    const sourceBridgeB = validator3.address;
    await token.mint(bridge.address, amount.mul(2));

    const hashA = await getReleaseHash(sourceTxHashA, amount, sourceChain, sourceNonce, sourceBridgeA);
    const hashB = await getReleaseHash(sourceTxHashB, amount, sourceChain, sourceNonce, sourceBridgeB);
    const sigsA = await getSortedSignatures([validator1, validator2], hashA);
    const sigsB = await getSortedSignatures([validator1, validator2], hashB);

    await bridge.releaseTokens(token.address, user.address, amount, sourceChain, sourceBridgeA, sourceNonce, sourceTxHashA, sigsA);
    await bridge.releaseTokens(token.address, user.address, amount, sourceChain, sourceBridgeB, sourceNonce, sourceTxHashB, sigsB);
    expect(await bridge.processedNonces(sourceChain, sourceBridgeA, sourceNonce)).to.equal(true);
    expect(await bridge.processedNonces(sourceChain, sourceBridgeB, sourceNonce)).to.equal(true);
  });

  it("Should reject insufficient signatures", async function () {
    const amount = ethers.utils.parseEther("100");
    const targetChain = 1;

    await token.connect(user).approve(bridge.address, amount);
    const lockTx = await bridge.connect(user).lockTokens(token.address, amount, targetChain);
    const lockReceipt = await lockTx.wait();
    const lockEvent = lockReceipt.events.find(e => e.event === "TokensLocked");
    const sourceTxHash = lockEvent.args.txHash;
    const sourceNonce = lockEvent.args.nonce;
    const sourceChain = 1;

    const msgHash = await getReleaseHash(sourceTxHash, amount, sourceChain, sourceNonce);

    const sig1 = await validator1.signMessage(ethers.utils.arrayify(msgHash));

    await expect(
      bridge.releaseTokens(
        token.address,
        user.address,
        amount,
        sourceChain,
        owner.address,
        sourceNonce,
        sourceTxHash,
        [sig1]
      )
    ).to.be.revertedWith("Insufficient signatures");
  });

  it("Should reject a malleable high-s validator signature", async function () {
    const amount = ethers.utils.parseEther("10");
    const sourceTxHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("high-s-source"));
    const sourceChain = 1;
    const sourceNonce = 88;
    await token.mint(bridge.address, amount);

    const msgHash = await getReleaseHash(sourceTxHash, amount, sourceChain, sourceNonce);
    const signatures = await getSortedSignatures([validator1, validator2], msgHash);
    signatures[0] = toHighSSignature(signatures[0]);

    await expect(
      bridge.releaseTokens(
        token.address,
        user.address,
        amount,
        sourceChain,
        owner.address,
        sourceNonce,
        sourceTxHash,
        signatures
      )
    ).to.be.reverted;
  });

  it("Should reject signatures replayed on another destination bridge", async function () {
    const amount = ethers.utils.parseEther("10");
    const sourceTxHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("domain-replay"));
    const sourceChain = 9005;
    const sourceNonce = 44;
    const msgHash = await getReleaseHash(sourceTxHash, amount, sourceChain, sourceNonce);
    const signatures = await getSortedSignatures([validator1, validator2], msgHash);

    const MultXBridge = await ethers.getContractFactory("MultXBridge");
    const secondBridge = await MultXBridge.deploy(
      [validator1.address, validator2.address, validator3.address],
      2
    );
    await secondBridge.deployed();
    await token.transfer(secondBridge.address, amount);

    await expect(
      secondBridge.releaseTokens(
        token.address,
        user.address,
        amount,
        sourceChain,
        owner.address,
        sourceNonce,
        sourceTxHash,
        signatures
      )
    ).to.be.revertedWith("Invalid signer");
  });

  describe("Pause guardian", function () {
    it("Owner can set and clear the pause guardian", async function () {
      await expect(bridge.setPauseGuardian(validator1.address))
        .to.emit(bridge, "PauseGuardianUpdated")
        .withArgs(ethers.constants.AddressZero, validator1.address);
      expect(await bridge.pauseGuardian()).to.equal(validator1.address);

      await bridge.setPauseGuardian(ethers.constants.AddressZero);
      expect(await bridge.pauseGuardian()).to.equal(ethers.constants.AddressZero);
    });

    it("Non-owner cannot set the pause guardian", async function () {
      await expect(
        bridge.connect(user).setPauseGuardian(user.address)
      ).to.be.reverted;
    });

    it("Guardian can pause but NOT unpause", async function () {
      await bridge.setPauseGuardian(validator1.address);

      await bridge.connect(validator1).pause();
      expect(await bridge.paused()).to.equal(true);

      // Guardian cannot resume — that's owner-only.
      await expect(
        bridge.connect(validator1).unpause()
      ).to.be.reverted;

      // Owner resumes.
      await bridge.unpause();
      expect(await bridge.paused()).to.equal(false);
    });

    it("Owner can still pause and unpause", async function () {
      await bridge.pause();
      expect(await bridge.paused()).to.equal(true);
      await bridge.unpause();
      expect(await bridge.paused()).to.equal(false);
    });

    it("A random address (neither owner nor guardian) cannot pause", async function () {
      await bridge.setPauseGuardian(validator1.address);
      await expect(
        bridge.connect(user).pause()
      ).to.be.revertedWith("Not owner or guardian");
    });

    it("Guardian cannot touch config (setValidatorSet / setDailyCap)", async function () {
      await bridge.setPauseGuardian(validator1.address);
      await expect(
        bridge.connect(validator1).setDailyCap(token.address, 1)
      ).to.be.reverted;
      await expect(
        bridge.connect(validator1).setValidatorSet([validator1.address], 1)
      ).to.be.reverted;
    });

    it("A guardian pause halts lockTokens", async function () {
      await bridge.setPauseGuardian(validator1.address);
      await bridge.connect(validator1).pause();
      const amount = ethers.utils.parseEther("1");
      await token.connect(user).approve(bridge.address, amount);
      await expect(
        bridge.connect(user).lockTokens(token.address, amount, 700777)
      ).to.be.revertedWithCustomError(bridge, "EnforcedPause");
    });
  });
});
