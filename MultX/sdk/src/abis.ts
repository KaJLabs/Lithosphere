/**
 * Solidity-style ABI fragments accepted by ethers v6 `Contract`.
 * Keep as `string[]` arrays for compactness — ethers parses them at construction.
 */

// ABI fragments verified against the deployed hardened MultXBridge
// (Kamet 0x3a896BDF3a1088287FA84aB5a43bB30e2535F263) — see
// contracts/contracts/MultXBridge.sol. These shapes match the on-chain
// contract exactly so consumers can decode logs and read state reliably;
// the pre-hardening guesses (isTokenSupported / getTokenBalance / indexed
// chain fields) were corrected.
export const bridgeAbi: readonly string[] = [
  'event SupportedTokenSet(address indexed token, bool supported)',
  // Writes
  'function lockTokens(address token, uint256 amount, uint256 targetChain) external returns (bytes32 txHash)',
  'function releaseTokens(address token, address user, uint256 amount, uint256 sourceChain, address sourceBridge, uint256 sourceNonce, bytes32 sourceTxHash, bytes[] calldata signatures) external',
  // Views — `supportedTokens` is the public mapping getter (there is NO
  // isTokenSupported on-chain). nonce / paused / daily-cap / validator getters
  // are exposed for richer pre-flight checks.
  'function supportedTokens(address token) external view returns (bool)',
  'function supportedRoutes(address token, uint256 targetChain) external view returns (bool)',
  'function nonce() external view returns (uint256)',
  'function paused() external view returns (bool)',
  'function signaturesRequired() external view returns (uint256)',
  'function getDailyRemaining(address token) external view returns (uint256)',
  'function getValidators() external view returns (address[] memory)',
  'function getValidatorCount() external view returns (uint256)',
  // Events — note `targetChain` / `sourceChain` are NOT indexed on-chain.
  'event TokensLocked(bytes32 indexed txHash, address indexed token, address indexed user, uint256 amount, uint256 targetChain, uint256 nonce)',
  'event TokensReleased(bytes32 indexed txHash, address indexed token, address indexed user, uint256 amount, uint256 sourceChain, address sourceBridge, address releasedBy)',
];

export const tokenAbi: readonly string[] = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];
