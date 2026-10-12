const { expect } = require('chai');
const { ethers, network } = require('hardhat');
const { auditVaultHistory, auditOperations } = require('../scripts/native-mesh/configured-history.cjs');
const { canonicalLogs, ReadOnlyProvider } = require('../scripts/native-mesh/verify-configured-state.cjs');

describe('O-27 configured-state evidence', function () {
  let vault, timelock, plan, expected, anchor, vaultLogs, timelockLogs, unpause;
  before(async function () {
    const [owner, ...signers] = await ethers.getSigners();
    const validators = signers.slice(0, 5).map(x => x.address);
    timelock = await (await ethers.getContractFactory('GovTimelock')).deploy(172800, [owner.address], [owner.address], ethers.constants.AddressZero);
    await timelock.deployed();
    vault = await (await ethers.getContractFactory('NativeLiquidityVault')).deploy(timelock.address, validators);
    await vault.deployed();
    const targets = Array(4).fill(vault.address), values = [0, 0, 0, 0];
    const payloads = [vault.interface.encodeFunctionData('setPauseGuardian', [owner.address]),
      vault.interface.encodeFunctionData('setRoute', [56, vault.address, 3600]),
      vault.interface.encodeFunctionData('setRoute', [8453, vault.address, 3600]),
      vault.interface.encodeFunctionData('setDailyCaps', [100, 100])];
    const zero = ethers.constants.HashZero, salt = ethers.utils.id('configuration');
    const id = await timelock.hashOperationBatch(targets, values, payloads, zero, salt);
    const schedule = await (await timelock.scheduleBatch(targets, values, payloads, zero, salt, 172800)).wait();
    await network.provider.send('evm_increaseTime', [172801]); await network.provider.send('evm_mine');
    const execute = await (await timelock.executeBatch(targets, values, payloads, zero, salt)).wait();
    const fund = await (await vault.fundLiquidity({ value: 50 })).wait();
    unpause = { data: vault.interface.encodeFunctionData('unpause'), salt: ethers.utils.id('unpause') };
    unpause.id = await timelock.hashOperation(vault.address, 0, unpause.data, id, unpause.salt);
    const queued = await (await timelock.schedule(vault.address, 0, unpause.data, id, unpause.salt, 172800)).wait();
    plan = { deterministicDeployment: { vaultAddress: vault.address, timelockAddress: timelock.address, factory: owner.address },
      governance: { safe: owner.address }, bridgeSignerSet: { addresses: validators } };
    expected = { timelockTxHash: timelock.deployTransaction.hash, vaultTxHash: vault.deployTransaction.hash,
      configurationTxHash: execute.transactionHash, depositCapWei: '100', payoutCapWei: '100',
      funding: [{ transactionHash: fund.transactionHash, funder: owner.address, amountWei: '50' }],
      operations: [{ id, scheduleTxHash: schedule.transactionHash, executionTxHash: execute.transactionHash },
        { id: unpause.id, scheduleTxHash: queued.transactionHash }] };
    anchor = await ethers.provider.getBlock('latest');
    vaultLogs = await canonicalLogs(ethers.provider, vault.address, 0, anchor.number);
    timelockLogs = await canonicalLogs(ethers.provider, timelock.address, 0, anchor.number);
  });
  it('reconciles constructor, exact configuration and funding on real deployed contracts', function () {
    expect(auditVaultHistory(vaultLogs, expected, plan, 1)).to.deep.equal({ events: 8, fundingWei: '50', noDeposits: true });
  });
  it('enumerates executed batch and pending unpause with exact calldata hashes', async function () {
    const result = await auditOperations(timelockLogs, timelock, anchor, expected);
    expect(result.map(x => x.state)).to.deep.equal(['DONE', 'WAITING']);
    expect(result[1].calls[0].calldataHash).to.equal(ethers.utils.keccak256(unpause.data));
    expect(result.every(x => x.unpauseAuthorized === false)).to.equal(true);
  });
  it('rejects a missing constructor/configuration/funding log', function () {
    for (let i = 0; i < vaultLogs.length; i++) expect(() => auditVaultHistory(vaultLogs.filter((_, j) => i !== j), expected, plan, 1)).to.throw();
  });
  it('rejects an additional vault event', function () {
    expect(() => auditVaultHistory([...vaultLogs, vaultLogs[0]], expected, plan, 1)).to.throw();
  });
  it('rejects changed caps, funding recipient binding and funding amount', function () {
    for (const change of [{ depositCapWei: '101' }, { funding: [{ ...expected.funding[0], amountWei: '51' }] },
      { funding: [{ ...expected.funding[0], funder: vault.address }] }]) {
      expect(() => auditVaultHistory(vaultLogs, { ...expected, ...change }, plan, 1)).to.throw();
    }
  });
  it('rejects substituted configuration transaction', function () {
    expect(() => auditVaultHistory(vaultLogs, { ...expected, configurationTxHash: ethers.constants.HashZero }, plan, 1)).to.throw();
  });
  it('requires every recorded operation to be present', async function () {
    let failed = false;
    try { await auditOperations([], timelock, anchor, expected); } catch { failed = true; }
    expect(failed).to.equal(true);
  });
  it('marks an unrecognized pending operation for independent review', async function () {
    const result = await auditOperations(timelockLogs, timelock, anchor, { ...expected, operations: expected.operations.slice(0, 1) });
    expect(result[1].requiresIndependentReview).to.equal(true);
  });
  it('rejects a supposedly executed unpause without an execution', async function () {
    let failed = false;
    try { await auditOperations(timelockLogs, timelock, anchor, { ...expected,
      operations: expected.operations.map(x => ({ ...x, executionTxHash: x.executionTxHash || ethers.constants.HashZero })) }); } catch { failed = true; }
    expect(failed).to.equal(true);
  });
  it('rejects history/state timestamp disagreement', async function () {
    let failed = false;
    try { await auditOperations(timelockLogs, { getTimestamp: async () => ethers.BigNumber.from(0) }, anchor, expected); } catch { failed = true; }
    expect(failed).to.equal(true);
  });
  it('rejects duplicate RPC logs', async function () {
    const log = vaultLogs[0]; let failed = false;
    const provider = { getLogs: async () => [log, log], getTransactionReceipt: hash => ethers.provider.getTransactionReceipt(hash),
      getBlock: n => ethers.provider.getBlock(n) };
    try { await canonicalLogs(provider, vault.address, 0, anchor.number); } catch { failed = true; }
    expect(failed).to.equal(true);
  });
  it('refuses transaction and wallet RPC methods before contacting any host', async function () {
    const provider = new ReadOnlyProvider('http://127.0.0.1:1');
    for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'personal_unlockAccount', 'eth_sign']) {
      let message; try { await provider.send(method, []); } catch (e) { message = e.message; }
      expect(message).to.equal('RPC_METHOD_NOT_READ_ONLY');
    }
  });
  it('pins current state reads to the finalized block hash with no numeric fallback', async function () {
    const http = require('http'), requests = [];
    const server = http.createServer((request, response) => {
      let body = ''; request.on('data', b => { body += b; });
      request.on('end', () => {
        const input = JSON.parse(body); requests.push(input);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ jsonrpc: '2.0', id: input.id,
          result: input.method === 'eth_chainId' ? '0x1' : '0x' }));
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const provider = new ReadOnlyProvider(`http://127.0.0.1:${server.address().port}`, { name: 'test', chainId: 1 });
      provider.anchor = { number: 100, hash: ethers.utils.id('finalized') };
      for (const [method, params, index] of [
        ['eth_call', [{ to: vault.address, data: '0x' }, '0x64'], 1],
        ['eth_getCode', [vault.address, '0x64'], 1],
        ['eth_getBalance', [vault.address, '0x64'], 1],
        ['eth_getStorageAt', [vault.address, '0x0', '0x64'], 2],
      ]) {
        await provider.send(method, params);
        expect(requests.find(x => x.method === method).params[index]).to.deep.equal({
          blockHash: provider.anchor.hash, requireCanonical: true,
        });
      }
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});
