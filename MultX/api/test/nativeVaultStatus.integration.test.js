import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { reviewSourceRpc, reviewDestinationRpc } from './helpers/reviewLab.js';
import { createNativeVaultStatusApplication } from '../src/nativeVaultStatusApplication.js';

const runtimeHash = code => createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex');
const artifact = () => JSON.parse(readFileSync(new URL('../../contracts/artifacts/contracts/NativeLiquidityVault.sol/NativeLiquidityVault.json', import.meta.url), 'utf8'));
const funded = async provider => {
  const wallet = ethers.Wallet.createRandom().connect(provider);
  await provider.send('hardhat_setBalance', [wallet.address, ethers.toBeHex(ethers.parseEther('10'))]);
  return wallet;
};
const mine = async (provider, count = 2) => provider.send('hardhat_mine', [ethers.toBeHex(count), '0x0']);

test('read-only HTTP status tracks direct vault deposit, payout, finalization and refund on two chains',
  { skip: process.env.MULTX_CROSS_CHAIN_TEST !== '1' }, async () => {
    const source = new ethers.JsonRpcProvider(reviewSourceRpc(), undefined, { cacheTimeout: -1 });
    const destination = new ethers.JsonRpcProvider(reviewDestinationRpc(), undefined, { cacheTimeout: -1 });
    assert.equal(Number((await source.getNetwork()).chainId), 31337);
    assert.equal(Number((await destination.getNetwork()).chainId), 9005);
    const sourceSnapshot = await source.send('evm_snapshot', []);
    const destinationSnapshot = await destination.send('evm_snapshot', []);
    let server;
    try {
      const ownerSource = await funded(source), ownerDestination = await funded(destination);
      const depositor = await funded(source);
      const validators = Array.from({ length: 5 }, () => ethers.Wallet.createRandom())
        .sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
      const build = artifact();
      const deploy = async (owner) => {
        const vault = await new ethers.ContractFactory(build.abi, build.bytecode, owner)
          .deploy(owner.address, validators.map(item => item.address));
        await vault.waitForDeployment();
        return vault;
      };
      const sourceVault = await deploy(ownerSource), destinationVault = await deploy(ownerDestination);
      const sourceAddress = await sourceVault.getAddress(), destinationAddress = await destinationVault.getAddress();
      for (const [vault, remoteChain, remoteVault] of [
        [sourceVault, 9005, destinationAddress], [destinationVault, 31337, sourceAddress],
      ]) {
        await (await vault.setRoute(remoteChain, remoteVault, 1)).wait();
        await (await vault.setDailyCaps(ethers.parseEther('10'), ethers.parseEther('10'))).wait();
        await (await vault.setPauseGuardian(depositor.address)).wait();
        await (await vault.unpause()).wait();
      }
      await (await destinationVault.fundLiquidity({ value: ethers.parseEther('1') })).wait();
      await Promise.all([mine(source), mine(destination)]);
      const app = createNativeVaultStatusApplication({
        routes: [{ sourceChainId: 31337, destinationChainId: 9005,
          sourceVault: sourceAddress, destinationVault: destinationAddress,
          sourceConfirmations: 2, destinationConfirmations: 2,
          sourceRuntimeSha256: runtimeHash(await source.getCode(sourceAddress)),
          destinationRuntimeSha256: runtimeHash(await destination.getCode(destinationAddress)) }],
        providers: new Map([[31337, source], [9005, destination]]),
        allowedOrigins: ['http://127.0.0.1:4178'],
      });
      await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
      const base = `http://127.0.0.1:${server.address().port}/native-vault/operations/31337/9005/`;
      const get = async id => fetch(base + id).then(async response => ({ status: response.status, body: await response.json() }));
      const sign = async digest => Promise.all(validators.slice(0, 3).map(wallet => wallet.signMessage(ethers.getBytes(digest))));
      const amount = ethers.parseEther('0.1'), output = ethers.parseEther('0.08');

      const deposit = async label => {
        const clientReference = ethers.id(label);
        const sourceNonce = await sourceVault.depositNonces(depositor.address);
        const operationId = await sourceVault.deriveOperationId(depositor.address, sourceNonce, clientReference);
        const expiry = (await source.getBlock('latest')).timestamp + 300;
        assert.equal((await get(operationId)).status, 404);
        const receipt = await (await sourceVault.connect(depositor).depositNative(
          clientReference, 9005, depositor.address, output, expiry, { value: amount })).wait();
        await Promise.all([mine(source), mine(destination)]);
        assert.equal((await get(operationId)).body.status, 'awaiting_destination');
        return { operationId, sourceNonce, clientReference, expiry, receipt };
      };

      const paid = await deposit('native-paid');
      const request = { operationId: paid.operationId, sourceChain: 31337, sourceVault: sourceAddress,
        sourceDepositor: depositor.address, sourceNonce: paid.sourceNonce, clientReference: paid.clientReference,
        sourceTxHash: paid.receipt.hash, sourceAmount: amount, recipient: depositor.address, outputAmount: output,
        sourceQuoteExpiry: paid.expiry, releaseDeadline: paid.expiry, authorizationExpiry: paid.expiry - 1 };
      const releaseReceipt = await (await destinationVault.releaseNative(request,
        await sign(await destinationVault.releaseDigest(request)))).wait();
      await mine(destination);
      assert.equal((await get(paid.operationId)).body.status, 'payout_observed');
      await (await sourceVault.finalizeDeposit(paid.operationId, releaseReceipt.hash,
        await sign(await sourceVault.finalizeDigest(paid.operationId, releaseReceipt.hash)))).wait();
      await mine(source);
      assert.equal((await get(paid.operationId)).body.status, 'completed');

      const unpaid = await deposit('native-refunded');
      await destination.send('evm_setNextBlockTimestamp', [unpaid.expiry + 2]);
      await mine(destination);
      const cancellation = { operationId: unpaid.operationId, sourceChain: 31337, sourceVault: sourceAddress,
        sourceDepositor: depositor.address, sourceNonce: unpaid.sourceNonce,
        clientReference: unpaid.clientReference, sourceTxHash: unpaid.receipt.hash,
        sourceQuoteExpiry: unpaid.expiry, releaseDeadline: unpaid.expiry,
        authorizationExpiry: unpaid.expiry + 120 };
      const cancelReceipt = await (await destinationVault.cancelRelease(cancellation,
        await sign(await destinationVault.cancelDigest(cancellation)))).wait();
      await mine(destination);
      assert.equal((await get(unpaid.operationId)).body.status, 'cancellation_observed');
      await source.send('evm_setNextBlockTimestamp', [unpaid.expiry + 3]);
      await mine(source);
      const refund = { operationId: unpaid.operationId, cancellationTxHash: cancelReceipt.hash,
        cancellationBlockHash: cancelReceipt.blockHash, cancellationBlockNumber: cancelReceipt.blockNumber,
        authorizationExpiry: unpaid.expiry + 120 };
      await (await sourceVault.refundDeposit(refund, await sign(await sourceVault.refundDigest(refund)))).wait();
      await mine(source);
      assert.equal((await get(unpaid.operationId)).body.status, 'refunded');
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      await source.send('evm_revert', [sourceSnapshot]);
      await destination.send('evm_revert', [destinationSnapshot]);
      source.destroy(); destination.destroy();
    }
  });
