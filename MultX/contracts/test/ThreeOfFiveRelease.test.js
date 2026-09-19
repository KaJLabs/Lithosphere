const { expect } = require('chai');
const { ethers } = require('hardhat');

for (const kind of ['MultXBridge', 'MultXBridgeDest']) {
  describe(`${kind} candidate 3-of-5 release`, function () {
    let bridge, token, validators, recipient, outsider, sourceBridge;
    const sourceChain = 1;
    const sourceHash = ethers.utils.id('synthetic-three-of-five-lock');
    beforeEach(async function () {
      const accounts = await ethers.getSigners();
      validators = accounts.slice(1, 6);
      recipient = accounts[6]; outsider = accounts[7]; sourceBridge = accounts[8].address;
      bridge = await (await ethers.getContractFactory(kind)).deploy(validators.map(v => v.address), 3);
      await bridge.deployed();
      if (kind === 'MultXBridge') {
        token = await (await ethers.getContractFactory('MockERC20')).deploy('Test', 'TST', 18);
        await token.deployed();
        await token.transfer(bridge.address, 100);
      } else {
        token = await (await ethers.getContractFactory('WrappedLEP100')).deploy('Wrapped', 'WT', 18, bridge.address, accounts[9].address, sourceChain);
        await token.deployed();
      }
      await bridge.addSupportedToken(token.address);
      await bridge.setSupportedRoute(token.address, sourceChain, true);
    });
    async function signatures(signers, amount = 10) {
      const { chainId } = await ethers.provider.getNetwork();
      const hash = ethers.utils.solidityKeccak256(
        ['bytes32','address','address','address','uint256','uint256','uint256','uint256','address'],
        [sourceHash,sourceBridge,token.address,recipient.address,amount,sourceChain,1,chainId,bridge.address]);
      const signed = await Promise.all(signers.map(async s => ({address:s.address.toLowerCase(), signature:await s.signMessage(ethers.utils.arrayify(hash))})));
      signed.sort((a,b)=>a.address.localeCompare(b.address));
      return signed.map(s=>s.signature);
    }
    const release = sigs => bridge.releaseTokens(token.address, recipient.address, 10, sourceChain, sourceBridge, 1, sourceHash, sigs);
    it('requires three distinct validators, then rejects replay', async function () {
      expect(await bridge.signaturesRequired()).to.equal(3);
      expect(await bridge.getValidatorCount()).to.equal(5);
      await expect(release(await signatures(validators.slice(0,2)))).to.be.reverted;
      expect(await token.balanceOf(recipient.address)).to.equal(0);
      await release(await signatures(validators.slice(0,3)));
      expect(await token.balanceOf(recipient.address)).to.equal(10);
      await expect(release(await signatures(validators))).to.be.reverted;
      expect(await token.balanceOf(recipient.address)).to.equal(10);
    });
    it('rejects duplicate, outsider and wrong-message signatures without consumption', async function () {
      for (const sigs of [
        await signatures([validators[0],validators[0],validators[1]]),
        await signatures([validators[0],validators[1],outsider]),
        await signatures(validators.slice(0,3),11),
      ]) {
        await expect(release(sigs)).to.be.reverted;
        expect(await token.balanceOf(recipient.address)).to.equal(0);
      }
      await release(await signatures(validators));
      expect(await token.balanceOf(recipient.address)).to.equal(10);
    });
  });
}
