// Offline design validator only. Caller-supplied policy/evidence is not authenticated
// by this module. A successful result never authorizes execution or advertises a route.
import { ethers } from 'ethers';

const KINDS = new Set(['wrap', 'swap', 'bridge', 'unwrap', 'native-release']);
const fail = message => { throw new Error(message); };
const text = (value, name) => typeof value === 'string' && value.trim() ? value : fail(`${name} required`);
const integer = (value, name) => Number.isSafeInteger(value) && value >= 0 ? value : fail(`${name} invalid`);
const amount = (value, name, zero = false) => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 78) fail(`${name} must be base-unit decimal string`);
  const n = BigInt(value);
  if ((!zero && n === 0n) || n >= 2n ** 256n) fail(`${name} out of range`);
  return n;
};
const evmAddress = value => {
  try { const a = ethers.getAddress(value); if (a !== ethers.ZeroAddress) return a; } catch { /* reject below */ }
  fail('invalid recipient or token address');
};

function asset(value) {
  if (!value || !Number.isSafeInteger(value.chainId) || value.chainId <= 0) fail('asset chain invalid');
  if (!Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 255) fail('asset decimals invalid');
  if (value.kind === 'native') {
    if (value.address !== undefined) fail('native asset cannot carry token address');
    return `eip155:${value.chainId}/native`;
  }
  if (value.kind !== 'erc20') fail('asset kind unsupported');
  return `eip155:${value.chainId}/erc20:${evmAddress(value.address).toLowerCase()}`;
}

function fresh(evidence, now, maxAge) {
  if (!evidence) fail('evidence required');
  text(evidence.reference, 'evidence reference');
  integer(evidence.observedAt, 'evidence observedAt');
  integer(evidence.validUntil, 'evidence validUntil');
  if (evidence.observedAt > now || now - evidence.observedAt > maxAge || evidence.validUntil <= now) fail('evidence stale or future');
}

export function validateNativeRouteProposal(quote, policy, now) {
  integer(now, 'now');
  if (quote?.schemaVersion !== 1 || policy?.schemaVersion !== 1 || policy.mode !== 'offline-design') fail('offline schema required');
  integer(policy.maxEvidenceAgeSeconds, 'max evidence age');
  integer(policy.maxQuoteLifetimeSeconds, 'max quote lifetime');
  if (!policy.maxEvidenceAgeSeconds || !policy.maxQuoteLifetimeSeconds) fail('positive time bounds required');
  if (!Array.isArray(policy.assets) || !Array.isArray(policy.edges)) fail('asset and edge registries required');
  const assets = new Map();
  for (const a of policy.assets) {
    text(a.id, 'asset id');
    const identity = asset(a);
    if (assets.has(a.id) || [...assets.values()].some(v => v.identity === identity)) fail('duplicate asset identity');
    assets.set(a.id, {...a, identity});
  }
  const edges = new Map();
  for (const edge of policy.edges) {
    text(edge.id, 'edge id');
    if (edges.has(edge.id)) fail('duplicate edge');
    const input = assets.get(edge.input), output = assets.get(edge.output);
    if (!input || !output || !KINDS.has(edge.kind) || edge.input === edge.output) fail('edge identity invalid');
    const crosses = input.chainId !== output.chainId;
    if (crosses !== (edge.kind === 'bridge')) fail('edge chain transition invalid');
    if (edge.kind === 'wrap' && (input.kind !== 'native' || output.kind !== 'erc20')) fail('wrap identity invalid');
    if (['unwrap','native-release'].includes(edge.kind) && (input.kind !== 'erc20' || output.kind !== 'native')) fail('native delivery identity invalid');
    if (edge.kind === 'swap' && (input.kind !== 'erc20' || output.kind !== 'erc20')) fail('swap requires explicit native adapters');
    // This design deliberately models bridge-native accounting as separate adapter steps.
    if (edge.kind === 'bridge' && (input.kind !== 'erc20' || output.kind !== 'erc20')) fail('bridge requires explicit native adapters');
    amount(edge.capacityBaseUnits, 'edge capacity');
    edges.set(edge.id, edge);
  }
  const input = assets.get(quote.inputAsset), output = assets.get(quote.outputAsset);
  if (!input || !output || input.kind !== 'native' || output.kind !== 'native' || input.chainId === output.chainId) fail('cross-chain native endpoints required');
  text(quote.id, 'quote id');
  evmAddress(quote.recipient);
  integer(quote.createdAt, 'quote createdAt'); integer(quote.expiresAt, 'quote expiresAt');
  if (quote.createdAt > now || quote.expiresAt <= now || quote.expiresAt - quote.createdAt > policy.maxQuoteLifetimeSeconds) fail('quote expired or lifetime invalid');
  if (quote.executionMode !== 'recoverable-requote' || quote.atomic !== false) fail('only non-atomic recoverable design supported');
  if (quote.recovery?.claimant !== quote.recipient || quote.recovery?.automaticTimeoutRefund !== false) fail('recovery claimant and no automatic refund required');
  text(quote.recovery?.policyReference, 'recovery policy');
  if (!Array.isArray(quote.fees) || quote.fees.length === 0) fail('explicit fee estimates required');
  const feeKeys = new Set();
  for (const fee of quote.fees) {
    const a = assets.get(fee.asset);
    if (!a || !['source-gas','destination-gas','bridge','protocol'].includes(fee.kind)) fail('fee identity invalid');
    if (feeKeys.has(fee.kind)) fail('duplicate fee category');
    feeKeys.add(fee.kind); amount(fee.amountBaseUnits, 'fee amount', true);
    if (!['separate','included-in-step-minimum'].includes(fee.accounting)) fail('fee accounting required');
    if (fee.kind.endsWith('-gas') && (fee.accounting !== 'separate' || a.kind !== 'native' || a.chainId !== (fee.kind === 'source-gas' ? input.chainId : output.chainId))) fail('gas fee chain/accounting invalid');
  }
  if (feeKeys.size !== 4) fail('all fee categories required (explicit zero allowed)');
  if (!Array.isArray(quote.steps) || !quote.steps.length || quote.steps.length > 12) fail('bounded steps required');
  let current = quote.inputAsset, currentAmount = amount(quote.inputAmountBaseUnits, 'input amount'), bridges = 0;
  const used = new Set();
  for (const step of quote.steps) {
    const edge = edges.get(step.edgeId);
    if (!edge || used.has(step.edgeId) || edge.input !== current) fail('route continuity or edge allowlist mismatch');
    used.add(step.edgeId);
    if (Object.keys(step).some(k => !['edgeId','inputAmountBaseUnits','minimumOutputBaseUnits','evidenceReference'].includes(k))) fail('unknown step field; execution payloads forbidden');
    if (amount(step.inputAmountBaseUnits, 'step input') !== currentAmount) fail('conservative amount continuity mismatch');
    if (currentAmount > amount(edge.capacityBaseUnits, 'capacity')) fail('insufficient evidenced capacity');
    fresh(edge.evidence, now, policy.maxEvidenceAgeSeconds);
    if (edge.evidence.reference !== step.evidenceReference) fail('step evidence binding mismatch');
    if (amount(edge.evidence.quotedInputBaseUnits, 'evidenced input') !== currentAmount ||
        amount(edge.evidence.minimumOutputBaseUnits, 'evidenced minimum') !== amount(step.minimumOutputBaseUnits, 'step minimum')) fail('step amounts not bound to evidence');
    text(edge.evidence.deploymentReference, 'deployment evidence');
    if (edge.kind === 'swap') text(edge.evidence.liquidityReference, 'liquidity evidence');
    if (edge.kind === 'bridge') {
      bridges++;
      text(edge.evidence.backingReference, 'backing evidence');
      text(edge.evidence.finalityPolicyReference, 'finality policy');
    }
    if (['wrap','unwrap','native-release'].includes(edge.kind)) text(edge.evidence.nativeAccountingReference, 'native accounting evidence');
    currentAmount = amount(step.minimumOutputBaseUnits, 'step minimum');
    current = edge.output;
  }
  if (bridges !== 1 || current !== quote.outputAsset) fail('one settlement edge and exact final asset required');
  if (amount(quote.minimumNativeOutputBaseUnits, 'native minimum') !== currentAmount) fail('final native minimum mismatch');
  return {status:'offline-design-valid', executable:false, evidenceAuthenticated:false,
    inputIdentity:input.identity, outputIdentity:output.identity, minimumNativeOutputBaseUnits:currentAmount.toString()};
}
