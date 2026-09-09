const { expect } = require('chai');
const { validateDeploymentManifest } = require('../scripts/mainnet/validate-deployment-manifest');

const address = (index) => `0x${index.toString(16).padStart(40, '0')}`;
const validators = Array.from({ length: 7 }, (_, index) => address(index + 1));

const validManifest = () => ({
  schemaVersion: 1,
  status: 'deployed-paused-verified',
  release: {
    auditedTag: 'multx-audited-release-v1.0.0',
    commit: 'a'.repeat(40),
    deploymentPlanSha256: 'b'.repeat(64),
    bytecodeEvidenceSha256: 'f'.repeat(64),
    deploymentApprovalUrl: 'https://evidence.example/deployment',
    deployedAtUtc: '2026-09-01T10:30:00Z',
    sourceBridgeRuntimeSha256: 'c'.repeat(64),
    destinationBridgeRuntimeSha256: 'e'.repeat(64),
    govTimelockRuntimeSha256: 'f'.repeat(64), wrappedTokenNormalizedRuntimeSha256: 'd'.repeat(64),
  },
  chains: [9005, 1, 56, 8453].map((chainId, index) => ({
    chainId,
    name: `Chain ${chainId}`,
    rpcHttps: `https://rpc-${chainId}.example`,
    bridgeKind: chainId === 9005 ? 'source' : 'destination',
    governance: { timelockDeploymentTxHash:'0x'+'9'.repeat(64), timelockDeploymentBlock:10 }, bridge: {
      address: address(20 + index),
      deploymentTxHash: `0x${String(index + 1).padStart(64, '0')}`,
      deploymentBlock: 100 + index,
      runtimeSha256: (chainId === 9005 ? 'c' : 'e').repeat(64),
      owner: address(30 + index * 2),
      governanceSafe: address(90 + index),
      pauseGuardian: address(31 + index * 2),
      paused: true,
      signaturesRequired: 5,
      validators: [...validators],
      explorerUrl: `https://explorer.example/${chainId}/bridge`,
      sourceVerified: true,
    },
    assets: [{
      kind: chainId === 9005 ? 'canonical' : 'wrapped',
      symbol: 'ASSET',
      address: address(40 + index),
      targetChainIds: chainId === 9005 ? [1, 56, 8453] : [9005],
      dailyCapBaseUnits: '1000000000000000000',
      runtimeSha256: 'd'.repeat(64),
      ...(chainId === 9005 ? {} : {
        originChainId: 9005,
        originToken: address(40),
        deploymentTxHash: `0x${String(index + 10).padStart(64, '0')}`,
        deploymentBlock: 200 + index,
        explorerUrl: `https://explorer.example/${chainId}/asset`,
        sourceVerified: true,
      }),
    }],
  })),
});

describe('mainnet deployment manifest', () => {
  it('accepts a complete paused and verified four-chain manifest', () => {
    expect(() => validateDeploymentManifest(validManifest())).not.to.throw();
  });

  it('rejects an unpaused bridge', () => {
    const manifest = validManifest();
    manifest.chains[1].bridge.paused = false;
    expect(() => validateDeploymentManifest(manifest)).to.throw('paused must be true');
  });

  it('rejects signer-set drift across chains', () => {
    const manifest = validManifest();
    manifest.chains[2].bridge.validators[6] = address(99);
    expect(() => validateDeploymentManifest(manifest)).to.throw('does not match');
  });

  it('rejects missing asset parity and unverified source', () => {
    const manifest = validManifest();
    manifest.chains[3].assets[0].symbol = 'OTHER';
    expect(() => validateDeploymentManifest(manifest)).to.throw('symbol set');
    const second = validManifest();
    second.chains[1].assets[0].sourceVerified = false;
    expect(() => validateDeploymentManifest(second)).to.throw('sourceVerified must be true');
  });

  it('rejects placeholders and invalid evidence hashes', () => {
    const manifest = validManifest();
    manifest.release.auditedTag = 'REPLACE_WITH_TAG';
    expect(() => validateDeploymentManifest(manifest)).to.throw('placeholder');
    const second = validManifest();
    second.chains[0].bridge.runtimeSha256 = 'abc';
    expect(() => validateDeploymentManifest(second)).to.throw('SHA-256');
  });

  it('rejects bridge bytecode not bound to the audited release', () => {
    const manifest = validManifest();
    manifest.chains[2].bridge.runtimeSha256 = 'f'.repeat(64);
    expect(() => validateDeploymentManifest(manifest)).to.throw('does not match the audited release');
  });

  it('requires the independently supplied bytecode evidence digest', () => {
    const manifest = validManifest();
    delete manifest.release.bytecodeEvidenceSha256;
    expect(() => validateDeploymentManifest(manifest)).to.throw('bytecodeEvidenceSha256');
  });

  it('rejects an incomplete or extra on-chain route declaration', () => {
    const manifest = validManifest();
    manifest.chains[0].assets[0].targetChainIds = [1, 56];
    expect(() => validateDeploymentManifest(manifest)).to.throw('targetChainIds');
  });
});
