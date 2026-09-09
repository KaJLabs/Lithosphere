import { Contract, JsonRpcProvider, getAddress } from 'ethers';

const ABI = ['event TokensLocked(bytes32 indexed txHash,address indexed token,address indexed user,uint256 amount,uint256 targetChain,uint256 nonce)'];
const bytes32 = value => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);

// Kept identical in the API and signer so each standalone image can verify
// independently without accessing the other service's filesystem.
export function createSourceEvidenceClient(source) {
  const provider = new JsonRpcProvider(source.rpcUrl, undefined, { cacheTimeout: -1 });
  return { provider, contract: new Contract(source.bridgeAddress, ABI, provider) };
}

export async function verifySourceEvidence(source, lock, client) {
  const height = Number(lock.sourceBlock);
  const confirmations = Number(source.confirmations);
  if (!Number.isSafeInteger(height) || height <= 0 ||
      !Number.isSafeInteger(confirmations) || confirmations <= 0) {
    throw new Error('Source height and confirmation policy must be explicit positive integers');
  }
  if (!bytes32(lock.sourceBlockHash)) throw new Error('Source block hash is required');
  if (Number(source.chainId) !== Number(lock.sourceChain) ||
      getAddress(source.bridgeAddress) !== getAddress(lock.sourceBridge)) {
    throw new Error('Source chain/bridge does not match configured policy');
  }
  const { provider, contract } = client;
  if (Number((await provider.getNetwork()).chainId) !== Number(source.chainId)) {
    throw new Error('Source RPC chain ID mismatch');
  }
  async function checkpoint() {
    const tip = await provider.getBlockNumber();
    const block = await provider.getBlock(height);
    if (!Number.isSafeInteger(tip) || tip - height + 1 < confirmations) {
      throw new Error('Source lock has insufficient confirmations');
    }
    if (!block?.hash || block.hash.toLowerCase() !== lock.sourceBlockHash.toLowerCase()) {
      throw new Error('Source block is missing or no longer canonical; reconciliation required');
    }
  }
  await checkpoint();
  const events = await contract.queryFilter(contract.filters.TokensLocked(lock.sourceTxHash), height, height);
  if (events.length !== 1) throw new Error('Source lock event is missing or ambiguous');
  const event = events[0], a = event.args;
  if (event.removed || event.blockNumber !== height ||
      !bytes32(event.blockHash) || event.blockHash.toLowerCase() !== lock.sourceBlockHash.toLowerCase() ||
      getAddress(event.address) !== getAddress(source.bridgeAddress) || !a ||
      String(a.txHash).toLowerCase() !== String(lock.sourceTxHash).toLowerCase() ||
      getAddress(a.token) !== getAddress(lock.sourceToken) ||
      getAddress(a.user) !== getAddress(lock.user) ||
      String(a.amount) !== String(lock.amount) || String(a.targetChain) !== String(lock.targetChain) ||
      String(a.nonce) !== String(lock.sourceNonce)) {
    throw new Error('Source lock event is removed or does not match release evidence');
  }
  await checkpoint();
}
