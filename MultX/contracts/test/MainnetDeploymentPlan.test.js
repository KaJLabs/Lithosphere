const { governance } = require('./governance-fixture');
const { expect } = require('chai');
const { validateDeploymentPlan } = require('../scripts/mainnet/validate-deployment-plan');

const addresses = Array.from({ length: 20 }, (_, index) =>
  `0x${(index + 1).toString(16).padStart(40, '0')}`
);

const validPlan = () => ({
  schemaVersion: 1,
  status: 'approved-for-deployment',
  release: {
    auditedTag: 'multx-audited-release-v1.0.0',
    commit: 'a'.repeat(40),
    auditReportUrl: 'https://evidence.example/audit',
    fixReviewUrl: 'https://evidence.example/fix-review',
    bytecodeEvidenceSha256: 'b'.repeat(64),
    sourceBridgeRuntimeSha256: 'c'.repeat(64),
    destinationBridgeRuntimeSha256: 'd'.repeat(64),
    govTimelockRuntimeSha256: 'f'.repeat(64), wrappedTokenNormalizedRuntimeSha256: 'e'.repeat(64),
  },
  changeWindow: {
    startUtc: '2026-09-01T10:00:00Z',
    endUtc: '2026-09-01T11:00:00Z',
    approvalRecordUrl: 'https://evidence.example/change-window',
  },
  bridgeSignerSet: {
    threshold: 5,
    addresses: addresses.slice(0, 7),
    acceptanceRecords: Array.from({ length: 7 }, (_, index) => `https://evidence.example/signer-${index}`),
  },
  chains: [9005, 1, 56, 8453].map((chainId, index) => ({
    chainId,
    name: `Chain ${chainId}`,
    expectedBridgeAddress: addresses[7 + index * 3],
    bridgeKind: chainId === 9005 ? 'source' : 'destination',
    rpcHttps: `https://rpc-${chainId}.example`,
    rpcWss: `wss://rpc-${chainId}.example/ws`,
    confirmations: 12,
    safe: addresses[7 + index * 3],
    timelock: addresses[8 + index * 3],
    pauseGuardian: addresses[9 + index * 3],
    deployer: addresses[7 + index * 3],
    feePayer: addresses[7 + index * 3],
    timelockDelaySeconds: 172800,
    governance: governance(addresses[7 + index * 3], addresses[8 + index * 3], addresses[7 + index * 3]),
  })),
  assets: [{
    symbol: 'ASSET',
    name: 'Approved Asset',
    decimals: 18,
    originChainId: 9005,
    originToken: addresses[0],
    destinationChainIds: [1, 56, 8453],
    dailyCapBaseUnits: {
      9005: '1000000000000000000',
      1: '1000000000000000000',
      56: '1000000000000000000',
      8453: '1000000000000000000',
    },
    destinationTokenAddresses: { 1: addresses[16], 56: addresses[17], 8453: addresses[18] },
    approvalRecordUrl: 'https://evidence.example/asset',
  }],
});

describe('mainnet deployment plan', () => {
  it('accepts a complete four-chain 5-of-7 approval plan', () => {
    expect(() => validateDeploymentPlan(validPlan())).not.to.throw();
  });

  it('rejects draft placeholders', () => {
    const plan = validPlan();
    plan.release.auditReportUrl = 'REPLACE_WITH_AUDIT';
    expect(() => validateDeploymentPlan(plan)).to.throw('placeholder');
  });

  it('rejects duplicate signer identities', () => {
    const plan = validPlan();
    plan.bridgeSignerSet.addresses[6] = plan.bridgeSignerSet.addresses[0];
    expect(() => validateDeploymentPlan(plan)).to.throw('must be unique');
  });

  it('rejects missing mainnet chains and routes', () => {
    const plan = validPlan();
    plan.chains.pop();
    expect(() => validateDeploymentPlan(plan)).to.throw('chains must contain');
    const second = validPlan();
    second.assets[0].destinationChainIds = [1, 56];
    expect(() => validateDeploymentPlan(second)).to.throw('must contain 1, 56 and 8453');
  });

  it('rejects unsafe governance separation and short timelocks', () => {
    const plan = validPlan();
    plan.chains[0].pauseGuardian = plan.chains[0].timelock;
    expect(() => validateDeploymentPlan(plan)).to.throw('must be distinct');
    const second = validPlan();
    second.chains[0].timelockDelaySeconds = 3600;
    expect(() => validateDeploymentPlan(second)).to.throw('at least 172800');
  });

  it('rejects zero caps, wrong origin and non-HTTPS evidence', () => {
    const plan = validPlan();
    plan.assets[0].dailyCapBaseUnits['1'] = '0';
    expect(() => validateDeploymentPlan(plan)).to.throw('positive base-unit');
    const second = validPlan();
    second.assets[0].originChainId = 900523;
    expect(() => validateDeploymentPlan(second)).to.throw('must be 9005');
    const third = validPlan();
    third.release.auditReportUrl = 'http://evidence.example/audit';
    expect(() => validateDeploymentPlan(third)).to.throw('credential-free HTTPS');
  });
});
