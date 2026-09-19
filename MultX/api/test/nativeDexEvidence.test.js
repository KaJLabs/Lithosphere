import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { transactionTokenCredit } from '../src/services/nativeDexExecution.js';

const transfer = new ethers.Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);

function transferLog(token, from, to, amount) {
  const event = transfer.encodeEventLog(transfer.getEvent('Transfer'), [from, to, amount]);
  return { address: token, topics: event.topics, data: event.data };
}

test('DEX evidence counts only output credited by the assigned transaction', () => {
  const token = ethers.Wallet.createRandom().address;
  const recipient = ethers.Wallet.createRandom().address;
  const other = ethers.Wallet.createRandom().address;
  const logs = [
    transferLog(token, ethers.ZeroAddress, recipient, 25n),
    transferLog(token, ethers.ZeroAddress, other, 1_000_000n),
    transferLog(other, ethers.ZeroAddress, recipient, 1_000_000n),
  ];
  assert.equal(transactionTokenCredit({ logs }, token, recipient), 25n);
});
