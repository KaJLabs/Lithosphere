const { expect } = require('chai');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ethers } = require('hardhat');

const SAFE = '0x1000000000000000000000000000000000000001';
const IMPLEMENTATION = '0x1000000000000000000000000000000000000002';
const FALLBACK = '0x1000000000000000000000000000000000000003';
const FACTORY = '0x1000000000000000000000000000000000000004';
const TIMELOCK = '0x1000000000000000000000000000000000000005';
const VAULT = '0x1000000000000000000000000000000000000006';
const DEX = ['0x1000000000000000000000000000000000000007', '0x1000000000000000000000000000000000000008', '0x1000000000000000000000000000000000000009'];
const OWNERS = ['0x2000000000000000000000000000000000000001', '0x2000000000000000000000000000000000000002', '0x2000000000000000000000000000000000000003'];
const SENTINEL = '0x0000000000000000000000000000000000000001';
const CODES = { proxy: '0x6001', implementation: '0x6002', fallback: '0x6003', factory: '0x6004', dex: '0x6005' };
const runtimeHash = value => crypto.createHash('sha256').update(Buffer.from(value.slice(2), 'hex')).digest('hex');
const blockHash = byte => `0x${byte.repeat(64)}`;
const slot = address => `0x${address.slice(2).padStart(64, '0')}`;
const iface = new ethers.utils.Interface([
  'function VERSION() view returns (string)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function getModulesPaginated(address,uint256) view returns (address[],address)',
]);

function block(hash) {
  return {
    number: '0x64', hash, parentHash: blockHash('b'), nonce: '0x0000000000000000',
    sha3Uncles: blockHash('c'), logsBloom: `0x${'00'.repeat(256)}`, transactionsRoot: blockHash('d'),
    stateRoot: blockHash('e'), receiptsRoot: blockHash('f'), miner: OWNERS[0], difficulty: '0x1',
    totalDifficulty: '0x1', extraData: '0x', size: '0x1', gasLimit: '0x1c9c380', gasUsed: '0x0',
    timestamp: '0x1', transactions: [], uncles: [], baseFeePerGas: '0x1',
  };
}

async function rpcServer(chainId, { reorg = false } = {}) {
  const seenTags = [];
  const anchor = blockHash(chainId === 1 ? '1' : chainId === 56 ? '2' : '3');
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const call = JSON.parse(body);
    const reply = result => response.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }));
    const fail = message => response.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, error: { code: -32000, message } }));
    try {
      if (call.method === 'eth_chainId') return reply(`0x${chainId.toString(16)}`);
      if (call.method === 'eth_getBlockByNumber') {
        return reply(block(call.params[0] === 'latest' || !reorg ? anchor : blockHash('9')));
      }
      if (['eth_getCode', 'eth_getStorageAt', 'eth_call'].includes(call.method)) {
        const tag = call.params[call.params.length - 1];
        seenTags.push(tag);
        if (tag !== '0x64') return fail('state read was not pinned to anchor block');
      }
      if (call.method === 'eth_getCode') {
        const target = call.params[0].toLowerCase();
        if (target === SAFE.toLowerCase()) return reply(CODES.proxy);
        if (target === IMPLEMENTATION.toLowerCase()) return reply(CODES.implementation);
        if (target === FALLBACK.toLowerCase()) return reply(CODES.fallback);
        if (target === FACTORY.toLowerCase()) return reply(CODES.factory);
        if (target === TIMELOCK.toLowerCase() || target === VAULT.toLowerCase()) return reply('0x');
        if (DEX.map(value => value.toLowerCase()).includes(target)) return reply(CODES.dex);
        return reply('0x');
      }
      if (call.method === 'eth_getStorageAt') {
        const position = call.params[1].toLowerCase();
        if (BigInt(position) === 0n) return reply(slot(IMPLEMENTATION));
        if (position === ethers.utils.id('fallback_manager.handler.address').toLowerCase()) return reply(slot(FALLBACK));
        return reply(slot(ethers.constants.AddressZero));
      }
      if (call.method === 'eth_call') {
        const parsed = iface.parseTransaction({ data: call.params[0].data });
        if (parsed.name === 'VERSION') return reply(iface.encodeFunctionResult('VERSION', ['1.4.1']));
        if (parsed.name === 'getOwners') return reply(iface.encodeFunctionResult('getOwners', [OWNERS]));
        if (parsed.name === 'getThreshold') return reply(iface.encodeFunctionResult('getThreshold', [2]));
        if (parsed.name === 'getModulesPaginated') return reply(iface.encodeFunctionResult('getModulesPaginated', [[], SENTINEL]));
      }
      fail(`unsupported method ${call.method}`);
    } catch (error) { fail(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, seenTags, url: `http://127.0.0.1:${server.address().port}` };
}

function plan() {
  const runtimeIdentities = {
    safeProxyRuntimeSha256: runtimeHash(CODES.proxy),
    safeImplementationRuntimeSha256: runtimeHash(CODES.implementation),
    fallbackHandlerRuntimeSha256: runtimeHash(CODES.fallback),
    deterministicFactoryRuntimeSha256: runtimeHash(CODES.factory),
  };
  return {
    status: 'REVIEW_CANDIDATE_DO_NOT_EXECUTE', enabled: false,
    governance: { safe: SAFE, safePolicy: { version: '1.4.1', owners: OWNERS, threshold: 2,
      guard: ethers.constants.AddressZero, fallbackHandler: FALLBACK } },
    deterministicDeployment: { factory: FACTORY, timelockAddress: TIMELOCK, vaultAddress: VAULT },
    chains: [1, 56, 8453].map(chainId => ({ chainId, safeImplementation: IMPLEMENTATION, runtimeIdentities,
      dex: { factory: DEX[0], router: DEX[1], pool: DEX[2] } })),
  };
}

function runPreflight(planPath, digest, urls) {
  const script = path.resolve(__dirname, '..', 'scripts', 'native-mesh', 'preflight-paused-deployment.cjs');
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script, '--plan', planPath, '--expected-plan-sha256', digest], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, MULTX_RPC_1: urls[0], MULTX_RPC_56: urls[1], MULTX_RPC_8453: urls[2] },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

describe('Native mesh preflight', function () {
  this.timeout(20000);
  let directory;
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-preflight-')); });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  async function withServers(options, action) {
    const servers = await Promise.all([rpcServer(options?.firstChainId || 1, options), rpcServer(56), rpcServer(8453)]);
    try { return await action(servers); }
    finally { await Promise.all(servers.map(item => new Promise(resolve => item.server.close(resolve)))); }
  }

  it('authenticates exact chain IDs and pins every state read to one block', async () => withServers({}, async servers => {
    const bytes = Buffer.from(`${JSON.stringify(plan(), null, 2)}\n`);
    const file = path.join(directory, 'plan.json'); fs.writeFileSync(file, bytes);
    const result = await runPreflight(file, crypto.createHash('sha256').update(bytes).digest('hex'), servers.map(item => item.url));
    expect(result.code, result.stderr).to.equal(0);
    expect(JSON.parse(result.stdout).checks).to.have.length(3);
    for (const server of servers) expect(server.seenTags.every(tag => tag === '0x64')).to.equal(true);
  }));

  it('rejects a wrong RPC chain identity', async () => withServers({ firstChainId: 2 }, async servers => {
    const bytes = Buffer.from(`${JSON.stringify(plan(), null, 2)}\n`);
    const file = path.join(directory, 'plan.json'); fs.writeFileSync(file, bytes);
    const result = await runPreflight(file, crypto.createHash('sha256').update(bytes).digest('hex'), servers.map(item => item.url));
    expect(result.code).to.equal(1);
    expect(result.stderr).to.include('RPC identity mismatch');
  }));

  it('rejects a block reorganization during verification', async () => withServers({ reorg: true }, async servers => {
    const bytes = Buffer.from(`${JSON.stringify(plan(), null, 2)}\n`);
    const file = path.join(directory, 'plan.json'); fs.writeFileSync(file, bytes);
    const result = await runPreflight(file, crypto.createHash('sha256').update(bytes).digest('hex'), servers.map(item => item.url));
    expect(result.code).to.equal(1);
    expect(result.stderr).to.include('anchor changed');
  }));

  it('rejects an altered plan digest and an incomplete chain set before RPC reads', async () => {
    const bytes = Buffer.from(`${JSON.stringify(plan(), null, 2)}\n`);
    const file = path.join(directory, 'plan.json'); fs.writeFileSync(file, bytes);
    let result = await runPreflight(file, '00'.repeat(32), ['', '', '']);
    expect(result.stderr).to.include('approved plan SHA-256 mismatch');
    const incomplete = plan(); incomplete.chains = [];
    const changed = Buffer.from(`${JSON.stringify(incomplete, null, 2)}\n`); fs.writeFileSync(file, changed);
    result = await runPreflight(file, crypto.createHash('sha256').update(changed).digest('hex'), ['', '', '']);
    expect(result.stderr).to.include('exact three-chain plan required');
  });
});
