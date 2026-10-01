const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const hre = require('hardhat');
const { ethers } = require('ethers');

const MNEMONIC = 'test test test test test test test test test test test junk';
const signerRoot = path.resolve(__dirname, '..', '..', 'signer');
const quoteModule = pathToFileURL(path.join(signerRoot, 'src', 'nativeEvidence.js')).href;
const wallet = index => ethers.Wallet.fromMnemonic(MNEMONIC, `m/44'/60'/0'/0/${index}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
async function ready(check, child, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`${label} exited with ${child.exitCode}`);
    try { if (await check()) return; } catch {}
    await sleep(100);
  }
  throw new Error(`${label} did not become ready`);
}
async function mine(provider, blocks = 2) {
  for (let i = 0; i < blocks; i++) await provider.send('evm_mine', []);
}
async function post(port, token, pathName, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathName}`, {
    method: 'POST', headers: {
      'content-type': 'application/json', 'x-forwarded-proto': 'https', authorization: `Bearer ${token}`,
    }, body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, 200, `${pathName}: ${JSON.stringify(result)}`);
  return result;
}
const ordered = signatures => signatures.sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()))
  .map(item => item.signature);

describe('Native mesh service on two disposable EVM nodes', function () {
  this.timeout(120000);

  it('pays once, finalizes, then recovers an expired unused certificate with the same signer journals', async function () {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multx-native-e2e-'));
    const children = [];
    try {
      const [sourcePort, targetPort, ...signerPorts] = await Promise.all(Array.from({ length: 5 }, freePort));
      const hardhatCli = require.resolve('hardhat/internal/cli/cli.js');
      const startNode = (chainId, port) => {
        const child = spawn(process.execPath, [hardhatCli, 'node', '--hostname', '127.0.0.1', '--port', String(port)], {
          cwd: path.resolve(__dirname, '..'),
          env: { ...process.env, NATIVE_MESH_TEST_CHAIN_ID: String(chainId) },
          stdio: 'ignore', windowsHide: true,
        });
        children.push(child);
        return child;
      };
      const sourceChild = startNode(101, sourcePort), targetChild = startNode(202, targetPort);
      const sourceProvider = new ethers.providers.JsonRpcProvider(`http://127.0.0.1:${sourcePort}`);
      const targetProvider = new ethers.providers.JsonRpcProvider(`http://127.0.0.1:${targetPort}`);
      await Promise.all([
        ready(async () => (await sourceProvider.getNetwork()).chainId === 101, sourceChild, 'source node'),
        ready(async () => (await targetProvider.getNetwork()).chainId === 202, targetChild, 'destination node'),
      ]);

      const artifact = await hre.artifacts.readArtifact('NativeLiquidityVault');
      const forwarderArtifact = await hre.artifacts.readArtifact('NativeMeshForwarder');
      const validators = [3, 4, 5, 6, 7].map(index => wallet(index).address);
      const deploy = async provider => {
        const owner = wallet(0).connect(provider);
        const vault = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner)
          .deploy(owner.address, validators);
        await vault.deployed();
        return vault;
      };
      const sourceVault = await deploy(sourceProvider), targetVault = await deploy(targetProvider);
      const deployForwarder = async provider => {
        const result = await new ethers.ContractFactory(forwarderArtifact.abi,
          forwarderArtifact.bytecode, wallet(0).connect(provider)).deploy();
        await result.deployed();
        return result;
      };
      const sourceForwarder = await deployForwarder(sourceProvider);
      const targetForwarder = await deployForwarder(targetProvider);
      const setup = async (vault, remoteChain, remoteVault) => {
        await (await vault.setRoute(remoteChain, remoteVault, 1)).wait();
        await (await vault.setDailyCaps(ethers.utils.parseEther('10'), ethers.utils.parseEther('10'))).wait();
        await (await vault.setPauseGuardian(wallet(1).address)).wait();
        await (await vault.unpause()).wait();
      };
      await setup(sourceVault, 202, targetVault.address);
      await setup(targetVault, 101, sourceVault.address);
      await (await targetVault.fundLiquidity({ value: ethers.utils.parseEther('1') })).wait();
      await mine(sourceProvider);
      await mine(targetProvider);

      const quoteAuthority = wallet(9);
      const nativeModule = await import(quoteModule);
      const policy = {
        quoteSigner: quoteAuthority.address, authorityEpoch: ethers.utils.id('local-test-epoch'),
        chains: [
          { chainId: 101, rpcUrl: `http://127.0.0.1:${sourcePort}`, vault: sourceVault.address,
            confirmations: 3, finalityDelaySeconds: 1 },
          { chainId: 202, rpcUrl: `http://127.0.0.1:${targetPort}`, vault: targetVault.address,
            confirmations: 3, finalityDelaySeconds: 1 },
        ],
      };
      const token = crypto.randomBytes(32).toString('hex');
      for (let i = 0; i < 3; i++) {
        const file = path.join(directory, `key-${i}`);
        fs.writeFileSync(file, wallet(i + 3).privateKey, { mode: 0o600 });
        const child = spawn(process.execPath, [path.join(signerRoot, 'src', 'index.js')], {
          cwd: signerRoot, env: {
            ...process.env, AWS_REGION: '', SIGNER_KMS_KEY_ARN: '', SIGNER_DYNAMODB_TABLE: '',
            NODE_ENV: 'test', SIGNER_TRANSPORT: 'proxy-http', SIGNER_BEHIND_TLS_PROXY: 'true',
            SIGNER_BEARER_TOKEN: token, SIGNER_PRIVATE_KEY_FILE: file,
            SIGNER_RELEASE_SIGNING_ENABLED: 'false', SIGNER_NATIVE_SIGNING_ENABLED: 'true',
            SIGNER_NATIVE_POLICY_JSON: JSON.stringify({ ...policy, signerAddress: wallet(i + 3).address }),
            SIGNER_STATE_FILE: path.join(directory, `legacy-${i}.jsonl`),
            SIGNER_NATIVE_STATE_FILE: path.join(directory, `native-${i}.jsonl`),
            SIGNER_PORT: String(signerPorts[i]),
          }, stdio: 'ignore', windowsHide: true,
        });
        children.push(child);
        await ready(async () => (await fetch(`http://127.0.0.1:${signerPorts[i]}/health`)).ok,
          child, `signer ${i}`);
      }

      const signThree = async (pathName, input) => ordered(await Promise.all(signerPorts.map(async (port, index) => ({
        address: wallet(index + 3).address,
        signature: (await post(port, token, pathName, input)).signature,
      }))));
      const destination = { chainId: 202, vault: targetVault.address };
      const depositor = wallet(2).connect(sourceProvider), recipient = wallet(8).address;
      const makeDeposit = async (name, lifetime, signedQuote = true) => {
        const clientReference = ethers.utils.id(name);
        const nonce = (await sourceVault.depositNonces(sourceForwarder.address)).toNumber();
        const operationId = await sourceVault.deriveOperationId(sourceForwarder.address, nonce, clientReference);
        const expiry = Math.floor(Date.now() / 1000) + lifetime;
        const depositCall = sourceVault.interface.encodeFunctionData('depositNative',
          [clientReference, 202, recipient, ethers.utils.parseEther('0.08'), expiry]);
        const tx = await sourceForwarder.connect(depositor).forward(sourceVault.address,
          depositCall, { value: ethers.utils.parseEther('0.1') });
        const receipt = await tx.wait();
        await mine(sourceProvider);
        const request = {
          operationId, sourceChain: 101, sourceVault: sourceVault.address,
          sourceDepositor: sourceForwarder.address, sourceNonce: nonce, clientReference,
          sourceTxHash: receipt.transactionHash, sourceAmount: ethers.utils.parseEther('0.1').toString(),
          recipient, outputAmount: ethers.utils.parseEther('0.08').toString(),
          sourceQuoteExpiry: expiry, releaseDeadline: expiry, authorizationExpiry: expiry - 1,
        };
        const quoteSignature = signedQuote
          ? await quoteAuthority.signMessage(ethers.utils.arrayify(nativeModule.quoteDigest(request, destination)))
          : undefined;
        return { request, evidence: {
          sourceBlockNumber: receipt.blockNumber, sourceBlockHash: receipt.blockHash,
          ...(quoteSignature ? { quoteSignature } : {}),
        } };
      };

      const first = await makeDeposit('paid', 90);
      const release = await signThree('/v1/native/sign-release', {
        request: first.request, destinationChain: 202, destinationVault: targetVault.address,
        evidence: first.evidence,
      });
      const beforeBalance = await targetProvider.getBalance(recipient);
      const paidCall = targetVault.interface.encodeFunctionData('releaseNative', [first.request, release]);
      const paidReceipt = await (await targetForwarder.forward(targetVault.address, paidCall)).wait();
      assert.equal((await targetProvider.getBalance(recipient)).sub(beforeBalance).toString(),
        ethers.utils.parseEther('0.08').toString());
      await mine(targetProvider);
      const finalization = await signThree('/v1/native/sign-finalization', {
        operation: first.request, destinationTxHash: paidReceipt.transactionHash,
        sourceChain: 101, sourceVault: sourceVault.address,
        destinationChain: 202, destinationVault: targetVault.address,
        evidence: { destinationTxHash: paidReceipt.transactionHash,
          destinationBlockNumber: paidReceipt.blockNumber, destinationBlockHash: paidReceipt.blockHash },
      });
      await (await sourceVault.finalizeDeposit(first.request.operationId,
        paidReceipt.transactionHash, finalization)).wait();
      assert.equal(Number((await sourceVault.deposits(first.request.operationId)).state), 2);

      const second = await makeDeposit('expired-unpaid', 15);
      await signThree('/v1/native/sign-release', {
        request: second.request, destinationChain: 202, destinationVault: targetVault.address,
        evidence: second.evidence,
      });
      const waitSeconds = second.request.releaseDeadline - Math.floor(Date.now() / 1000) + 3;
      if (waitSeconds > 0) await sleep(waitSeconds * 1000);
      await targetProvider.send('evm_setNextBlockTimestamp', [second.request.releaseDeadline + 2]);
      await mine(targetProvider, 3);
      const cancelRequest = {
        operationId: second.request.operationId, sourceChain: second.request.sourceChain,
        sourceVault: second.request.sourceVault, sourceDepositor: second.request.sourceDepositor,
        sourceNonce: second.request.sourceNonce, clientReference: second.request.clientReference,
        sourceTxHash: second.request.sourceTxHash, sourceQuoteExpiry: second.request.sourceQuoteExpiry,
        releaseDeadline: second.request.releaseDeadline,
        authorizationExpiry: Math.floor(Date.now() / 1000) + 5,
      };
      await signThree('/v1/native/sign-cancellation', {
        request: cancelRequest, operation: second.request,
        destinationChain: 202, destinationVault: targetVault.address, evidence: second.evidence,
      });
      await sleep((cancelRequest.authorizationExpiry - Math.floor(Date.now() / 1000) + 1) * 1000);
      const renewedCancel = { ...cancelRequest, authorizationExpiry: Math.floor(Date.now() / 1000) + 120 };
      const cancellation = await signThree('/v1/native/sign-cancellation', {
        request: renewedCancel, operation: second.request,
        destinationChain: 202, destinationVault: targetVault.address, evidence: second.evidence,
      });
      const cancelCall = targetVault.interface.encodeFunctionData('cancelRelease', [renewedCancel, cancellation]);
      const cancelledReceipt = await (await targetForwarder.forward(targetVault.address, cancelCall)).wait();
      await targetProvider.send('evm_increaseTime', [2]);
      await mine(targetProvider, 3);
      await sourceProvider.send('evm_setNextBlockTimestamp', [second.request.releaseDeadline + 2]);
      await mine(sourceProvider, 3);
      const refundRequest = {
        operationId: second.request.operationId,
        cancellationTxHash: cancelledReceipt.transactionHash,
        cancellationBlockHash: cancelledReceipt.blockHash,
        cancellationBlockNumber: cancelledReceipt.blockNumber,
        authorizationExpiry: Math.floor(Date.now() / 1000) + 5,
      };
      await signThree('/v1/native/sign-refund', {
        request: refundRequest, identity: second.request,
        sourceChain: 101, sourceVault: sourceVault.address,
        destinationChain: 202, destinationVault: targetVault.address, evidence: {},
      });
      await sleep((refundRequest.authorizationExpiry - Math.floor(Date.now() / 1000) + 1) * 1000);
      const renewedRefund = { ...refundRequest, authorizationExpiry: Math.floor(Date.now() / 1000) + 120 };
      const refunds = await signThree('/v1/native/sign-refund', {
        request: renewedRefund, identity: second.request,
        sourceChain: 101, sourceVault: sourceVault.address,
        destinationChain: 202, destinationVault: targetVault.address, evidence: {},
      });
      await (await sourceVault.refundDeposit(renewedRefund, refunds)).wait();
      assert.equal(Number((await sourceVault.deposits(second.request.operationId)).state), 3);
      assert.equal(Number(await targetVault.releaseStates(second.request.operationId)), 2);

      const unquoted = await makeDeposit('unquoted-direct', 6, false);
      const unquotedWait = unquoted.request.releaseDeadline - Math.floor(Date.now() / 1000) + 2;
      if (unquotedWait > 0) await sleep(unquotedWait * 1000);
      const targetHead = await targetProvider.getBlock('latest');
      await targetProvider.send('evm_setNextBlockTimestamp',
        [Math.max(targetHead.timestamp + 1, unquoted.request.releaseDeadline + 2)]);
      await mine(targetProvider, 3);
      const unquotedCancel = {
        operationId: unquoted.request.operationId, sourceChain: unquoted.request.sourceChain,
        sourceVault: unquoted.request.sourceVault, sourceDepositor: unquoted.request.sourceDepositor,
        sourceNonce: unquoted.request.sourceNonce, clientReference: unquoted.request.clientReference,
        sourceTxHash: unquoted.request.sourceTxHash, sourceQuoteExpiry: unquoted.request.sourceQuoteExpiry,
        releaseDeadline: unquoted.request.releaseDeadline,
        authorizationExpiry: Math.floor(Date.now() / 1000) + 120,
      };
      const unquotedCancellation = await signThree('/v1/native/sign-cancellation', {
        request: unquotedCancel, operation: unquoted.request,
        destinationChain: 202, destinationVault: targetVault.address, evidence: unquoted.evidence,
      });
      const unquotedReceipt = await (await targetVault.cancelRelease(unquotedCancel, unquotedCancellation)).wait();
      await mine(targetProvider, 3);
      const sourceHead = await sourceProvider.getBlock('latest');
      await sourceProvider.send('evm_setNextBlockTimestamp',
        [Math.max(sourceHead.timestamp + 1, unquoted.request.releaseDeadline + 2)]);
      await mine(sourceProvider, 3);
      const unquotedRefund = {
        operationId: unquoted.request.operationId,
        cancellationTxHash: unquotedReceipt.transactionHash,
        cancellationBlockHash: unquotedReceipt.blockHash,
        cancellationBlockNumber: unquotedReceipt.blockNumber,
        authorizationExpiry: Math.floor(Date.now() / 1000) + 120,
      };
      const unquotedRefundSignatures = await signThree('/v1/native/sign-refund', {
        request: unquotedRefund, identity: unquoted.request,
        sourceChain: 101, sourceVault: sourceVault.address,
        destinationChain: 202, destinationVault: targetVault.address, evidence: {},
      });
      await (await sourceVault.refundDeposit(unquotedRefund, unquotedRefundSignatures)).wait();
      assert.equal(Number((await sourceVault.deposits(unquoted.request.operationId)).state), 3);
    } finally {
      for (const child of children) child.kill();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
