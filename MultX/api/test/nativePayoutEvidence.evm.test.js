import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { reviewDestinationRpc } from './helpers/reviewLab.js';
import { verifyDirectNativePayout } from '../src/services/nativePayoutEvidence.js';

test('actual same-block recipient spend does not invalidate a direct payout',
  { skip: process.env.MULTX_PAYOUT_LOCAL_EVM !== '1' }, async () => {
    const provider = new ethers.JsonRpcProvider(reviewDestinationRpc(), undefined, { cacheTimeout: -1 });
    assert.match(await provider.send('web3_clientVersion', []), /Hardhat/i);
    const chainId = Number((await provider.getNetwork()).chainId);
    assert.equal(chainId, 9005);
    const snapshot = await provider.send('evm_snapshot', []);
    const sender = ethers.Wallet.createRandom().connect(provider);
    const recipient = ethers.Wallet.createRandom().connect(provider);
    const other = ethers.Wallet.createRandom().address;
    const payout = ethers.parseEther('1');
    try {
      await provider.send('hardhat_setBalance', [sender.address, ethers.toBeHex(ethers.parseEther('5'))]);
      await provider.send('hardhat_setBalance', [recipient.address, ethers.toBeHex(ethers.parseEther('1'))]);
      await provider.send('evm_setAutomine', [false]);
      const payment = await sender.sendTransaction({ to: recipient.address, value: payout, gasLimit: 21000 });
      const spend = await recipient.sendTransaction({ to: other, value: ethers.parseEther('0.25'), gasLimit: 21000 });
      await provider.send('evm_mine', []);
      const paymentReceipt = await provider.getTransactionReceipt(payment.hash);
      const spendReceipt = await provider.getTransactionReceipt(spend.hash);
      assert.equal(paymentReceipt.status, 1);
      assert.equal(spendReceipt.status, 1);
      assert.equal(paymentReceipt.blockHash, spendReceipt.blockHash);
      const before = await provider.getBalance(recipient.address, paymentReceipt.blockNumber - 1);
      const after = await provider.getBalance(recipient.address, paymentReceipt.blockNumber);
      assert(after - before < payout, 'whole-block balance must undercount the valid payout');
      await provider.send('hardhat_mine', ['0x2', '0x0']);
      const proof = await verifyDirectNativePayout(provider, {
        mode: 'direct-native', swapId: 'same-block-spend', chainId,
        confirmations: 2, nonce: payment.nonce, transactionHash: payment.hash,
        sender: sender.address, recipient: recipient.address,
        minimumOutputBaseUnits: payout.toString(),
      });
      assert.equal(proof.amountBaseUnits, payout.toString());
      assert.equal(proof.verification, 'direct-native-transfer');
    } finally {
      await provider.send('evm_setAutomine', [true]);
      await provider.send('evm_revert', [snapshot]);
      provider.destroy();
    }
  });
