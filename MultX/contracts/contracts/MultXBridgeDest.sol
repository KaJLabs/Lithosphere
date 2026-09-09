// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Destination-chain MultX bridge.
///
/// Mirrors MultXBridge.sol's validator + signature machinery exactly. The only
/// behavioral difference:
///   - releaseTokens MINTS wrapped tokens to the user (via WrappedLEP100.bridgeMint)
///     instead of transferring from the bridge's own balance
///   - lockTokens BURNS the user's wrapped tokens (via ERC20Burnable.burnFrom)
///     instead of holding them on the bridge
///
/// Same signature scheme as MultXBridge.sol so the same validator service can
/// sign attestations for both directions without code changes.
/// @notice Mint/burn interface the destination bridge calls on a WrappedLEP100 token.
interface IWrappedLEP100 {
    /// @dev Mint `amount` wrapped tokens to `to` (caller must be the immutable bridge).
    function bridgeMint(address to, uint256 amount) external;
    /// @dev Burn `amount` of `account`'s wrapped tokens (requires prior approval).
    function burnFrom(address account, uint256 amount) external;
}

/// @title MultXBridgeDest — destination-chain MultX bridge (mint/burn wrapped tokens)
/// @notice Forward releases MINT wrapped tokens to the user; reverse locks BURN the
///         user's wrapped tokens. Shares MultXBridge's validator + signature scheme
///         exactly, so one validator service signs both directions. See the file
///         header for the behavioral differences vs the source-chain bridge.
/// @dev Same security model as MultXBridge: owner-only config, guardian may only
///      pause, replay-guarded + reentrancy-guarded releases, non-upgradeable.
contract MultXBridgeDest is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @notice Monotonic counter of successful locks; component of each lock's txHash.
    uint256 public nonce;
    /// @notice Whether an address is in the current validator set.
    mapping(address => bool) public isValidator;
    /// @notice The current validator set (enumerable copy of `isValidator`).
    address[] public validators;
    /// @notice Number of distinct validator signatures required to release funds.
    uint256 public signaturesRequired;
    /// @notice Whether a wrapped token may be bridged through this contract.
    mapping(address => bool) public supportedTokens;
    /// @notice Whether a wrapped token may be routed to a specific destination chain.
    mapping(address => mapping(uint256 => bool)) public supportedRoutes;
    /// @notice Replay guard namespaced by the exact source bridge instance.
    mapping(uint256 => mapping(address => mapping(uint256 => bool))) public processedNonces;

    /// @notice Per-token fixed-window 24h cap applied independently to locks and releases (0 = unlimited).
    mapping(address => uint256) public dailyCap;
    /// @notice Per-token volume locked in the current fixed 24h window.
    mapping(address => uint256) public dailyVolume;
    /// @notice Per-token timestamp at which the current lock window started.
    mapping(address => uint256) public lastCapReset;
    /// @notice Per-token volume released in the current fixed 24h window.
    mapping(address => uint256) public releaseVolume;
    /// @notice Per-token timestamp at which the current release window started.
    mapping(address => uint256) public lastReleaseCapReset;

    /// @notice Fast emergency-pause role, separate from the owner.
    /// The guardian can pause() but NOT unpause(), and cannot touch any config.
    /// This lets a low-latency ops key halt the bridge instantly while the owner
    /// (e.g. a Timelock behind a multisig) keeps exclusive resume/config rights.
    address public pauseGuardian;

    /// @notice Emitted when wrapped tokens are burned/locked for transfer to `targetChain`.
    event TokensLocked(
        bytes32 indexed txHash,
        address indexed token,
        address indexed user,
        uint256 amount,
        uint256 targetChain,
        uint256 nonce
    );

    /// @notice Emitted when wrapped tokens are minted/released to `user` on validator quorum.
    event TokensReleased(
        bytes32 indexed txHash,
        address indexed token,
        address indexed user,
        uint256 amount,
        uint256 sourceChain,
        address sourceBridge,
        address releasedBy
    );

    /// @notice Emitted when the validator set and/or quorum threshold changes.
    event ValidatorSetUpdated(address[] validators, uint256 signaturesRequired);
    /// @notice Emitted when a token's daily lock cap is set.
    event DailyCapSet(address indexed token, uint256 cap);
    /// @notice Emitted when token support is enabled or disabled.
    event SupportedTokenSet(address indexed token, bool supported);
    /// @notice Emitted when a token/destination route is enabled or disabled.
    event SupportedRouteSet(address indexed token, uint256 indexed targetChain, bool supported);
    /// @notice Emitted when the fast pause guardian is set or cleared.
    event PauseGuardianUpdated(address indexed previousGuardian, address indexed newGuardian);

    /// @notice Deploy the destination bridge with an initial validator set and quorum.
    /// @param _validators Initial validator addresses (must be non-empty, unique, and non-zero).
    /// @param _signaturesRequired Quorum size; must be in [1, _validators.length].
    constructor(address[] memory _validators, uint256 _signaturesRequired) Ownable(msg.sender) {
        require(_validators.length > 0, "At least one validator required");
        require(_signaturesRequired > 0 && _signaturesRequired <= _validators.length, "Invalid signatures required");

        uint256 vlen = _validators.length;
        for (uint256 i = 0; i < vlen; i++) {
            require(_validators[i] != address(0), "Invalid validator address");
            require(!isValidator[_validators[i]], "Duplicate validator address");
            isValidator[_validators[i]] = true;
            validators.push(_validators[i]);
        }

        signaturesRequired = _signaturesRequired;
        nonce = 0;
    }

    // ── Admin: token support ────────────────────────────────────────────────────

    /// @notice Allow `token` to be bridged through this contract. Owner-only.
    /// @param token Wrapped token address to enable.
    function addSupportedToken(address token) external onlyOwner {
        require(token != address(0), "Invalid token address");
        supportedTokens[token] = true;
        emit SupportedTokenSet(token, true);
    }

    /// @notice Disallow new locks of `token` (in-flight releases unaffected). Owner-only.
    /// @param token Wrapped token address to disable.
    function removeSupportedToken(address token) external onlyOwner {
        supportedTokens[token] = false;
        emit SupportedTokenSet(token, false);
    }

    /// @notice Enable or disable an explicit token/destination route. Owner-only.
    function setSupportedRoute(address token, uint256 targetChain, bool supported) external onlyOwner {
        require(token != address(0), "Invalid token address");
        require(targetChain > 0, "Invalid target chain");
        require(targetChain != block.chainid, "Target chain cannot be current chain");
        if (supported) require(supportedTokens[token], "Token not supported");
        supportedRoutes[token][targetChain] = supported;
        emit SupportedRouteSet(token, targetChain, supported);
    }

    // ── Admin: pause ────────────────────────────────────────────────────────────

    /// @notice Halt locks and releases. Callable by the owner OR the pause guardian.
    function pause() external {
        require(msg.sender == owner() || msg.sender == pauseGuardian, "Not owner or guardian");
        _pause();
    }
    /// @notice Resume the bridge. Owner-only (the guardian can halt but never resume).
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Set (or clear, with address(0)) the fast pause guardian. Owner-only.
    /// @param guardian New guardian address, or address(0) to remove the role.
    function setPauseGuardian(address guardian) external onlyOwner {
        emit PauseGuardianUpdated(pauseGuardian, guardian);
        pauseGuardian = guardian;
    }

    // ── Admin: validator set rotation ───────────────────────────────────────────

    /// @notice Replace the entire validator set and quorum threshold atomically. Owner-only.
    /// @param _validators New validator addresses (non-empty, unique, and non-zero).
    /// @param _signaturesRequired New quorum size; must be in [1, _validators.length].
    function setValidatorSet(address[] calldata _validators, uint256 _signaturesRequired) external onlyOwner {
        require(_validators.length > 0, "At least one validator required");
        require(_signaturesRequired > 0 && _signaturesRequired <= _validators.length, "Invalid signatures required");

        uint256 oldLen = validators.length;
        for (uint256 i = 0; i < oldLen; i++) {
            isValidator[validators[i]] = false;
        }
        delete validators;

        uint256 newLen = _validators.length;
        for (uint256 i = 0; i < newLen; i++) {
            require(_validators[i] != address(0), "Invalid validator address");
            require(!isValidator[_validators[i]], "Duplicate validator address");
            isValidator[_validators[i]] = true;
            validators.push(_validators[i]);
        }

        signaturesRequired = _signaturesRequired;
        emit ValidatorSetUpdated(_validators, _signaturesRequired);
    }

    // ── Admin: daily cap ────────────────────────────────────────────────────────

    /// @notice Set a token's fixed-window 24h lock and release cap (0 = unlimited). Owner-only.
    /// @param token Token to cap.
    /// @param cap Maximum cumulative amount in each independent lock/release window.
    function setDailyCap(address token, uint256 cap) external onlyOwner {
        dailyCap[token] = cap;
        emit DailyCapSet(token, cap);
    }

    // ── Bridge: lock (reverse direction — user burns wrapped, gets original back) ─

    /// @notice Burn `amount` of the user's wrapped `token` to transfer back to `targetChain`.
    /// @dev Reverts if paused, token unsupported, amount is 0, target is this chain,
    ///      or the daily cap would be exceeded. Burns via burnFrom (caller must approve).
    /// @param token Supported wrapped token to burn/lock.
    /// @param amount Amount to lock (must be > 0).
    /// @param targetChain Destination chain id (must differ from this chain).
    /// @return txHash Canonical lock hash emitted in `TokensLocked`.
    function lockTokens(
        address token,
        uint256 amount,
        uint256 targetChain
    ) external nonReentrant whenNotPaused returns (bytes32) {
        require(supportedTokens[token], "Token not supported");
        require(amount > 0, "Amount must be greater than 0");
        require(targetChain != block.chainid, "Target chain cannot be current chain");
        require(supportedRoutes[token][targetChain], "Route not supported");

        if (dailyCap[token] > 0) {
            if (block.timestamp >= lastCapReset[token] + 1 days) {
                dailyVolume[token] = 0;
                lastCapReset[token] = block.timestamp;
            }
            require(dailyVolume[token] + amount <= dailyCap[token], "Daily cap exceeded");
            dailyVolume[token] += amount;
        }

        // Reserve the nonce before the external burn (checks-effects-interactions).
        // A failed burn reverts this increment with the rest of the transaction.
        nonce++;

        // Burn the user's wrapped tokens. Requires prior approve() so the bridge
        // can call burnFrom — standard ERC20Burnable pattern.
        IWrappedLEP100(token).burnFrom(msg.sender, amount);

        bytes32 txHash = keccak256(
            abi.encodePacked(token, msg.sender, amount, targetChain, nonce, block.chainid, address(this))
        );

        emit TokensLocked(txHash, token, msg.sender, amount, targetChain, nonce);
        return txHash;
    }

    // ── Bridge: release (forward direction — mint wrapped from attested Kamet lock) ─

    /// @notice Mint wrapped `token` to `user` on proof of a validator quorum.
    /// @dev Same verification as MultXBridge.releaseTokens (distinct ascending
    ///      validator signatures over the canonical EIP-191 message hash, single-use
    ///      (sourceChain, sourceBridge, sourceNonce), checks-effects-interactions, nonReentrant) —
    ///      but mints via bridgeMint instead of transferring escrow.
    /// @param token Wrapped token to mint.
    /// @param user Recipient of the minted funds.
    /// @param amount Amount to mint (must be > 0).
    /// @param sourceChain Chain id where the corresponding lock occurred.
    /// @param sourceBridge Bridge address where the corresponding lock occurred.
    /// @param sourceNonce Lock nonce on the source chain (replay key).
    /// @param sourceTxHash Lock txHash on the source chain (bound into the signed message).
    /// @param signatures Validator signatures, ascending by signer address.
    function releaseTokens(
        address token,
        address user,
        uint256 amount,
        uint256 sourceChain,
        address sourceBridge,
        uint256 sourceNonce,
        bytes32 sourceTxHash,
        bytes[] calldata signatures
    ) external nonReentrant whenNotPaused {
        require(sourceBridge != address(0), "Invalid source bridge");
        require(!processedNonces[sourceChain][sourceBridge][sourceNonce], "Nonce already processed");
        require(signatures.length >= signaturesRequired, "Insufficient signatures");
        require(amount > 0, "Amount must be greater than 0");

        // Bind the quorum to this exact destination chain and bridge. Without
        // these fields, a valid release could be replayed on another deployed
        // bridge that shares the validator set and token address.
        bytes32 msgHash = keccak256(
            abi.encodePacked(
                sourceTxHash,
                sourceBridge,
                token,
                user,
                amount,
                sourceChain,
                sourceNonce,
                block.chainid,
                address(this)
            )
        );

        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash)
        );

        address lastSigner = address(0);
        uint256 validSignatures = 0;
        uint256 sigLen = signatures.length;

        for (uint256 i = 0; i < sigLen; i++) {
            address signer = ECDSA.recover(ethSignedHash, signatures[i]);

            require(isValidator[signer], "Invalid signer");
            require(signer > lastSigner, "Signatures must be in ascending order");

            lastSigner = signer;
            validSignatures++;

            if (validSignatures >= signaturesRequired) {
                break;
            }
        }

        require(validSignatures >= signaturesRequired, "Insufficient valid signatures");

        // Apply the configured cap to outbound minting in a separate fixed
        // 24-hour window. This limits a compromised quorum instead of only
        // rate-limiting reverse-bridge burns.
        _consumeReleaseCap(token, amount);

        processedNonces[sourceChain][sourceBridge][sourceNonce] = true;

        // Mint directly to the user. The wrapped token must bind its immutable
        // bridge address to this exact contract at deployment time.
        IWrappedLEP100(token).bridgeMint(user, amount);

        emit TokensReleased(sourceTxHash, token, user, amount, sourceChain, sourceBridge, msg.sender);
    }

    function _consumeReleaseCap(address token, uint256 amount) internal {
        if (dailyCap[token] == 0) return;
        if (block.timestamp >= lastReleaseCapReset[token] + 1 days) {
            releaseVolume[token] = 0;
            lastReleaseCapReset[token] = block.timestamp;
        }
        require(releaseVolume[token] + amount <= dailyCap[token], "Release cap exceeded");
        releaseVolume[token] += amount;
    }

    // ── Views ───────────────────────────────────────────────────────────────────

    /// @notice Return the current validator set.
    function getValidators() external view returns (address[] memory) { return validators; }
    /// @notice Return the size of the current validator set.
    function getValidatorCount() external view returns (uint256) { return validators.length; }
    /// @notice Remaining lockable volume for `token` in the current 24h window
    ///         (type(uint256).max when uncapped).
    function getDailyRemaining(address token) external view returns (uint256) {
        if (dailyCap[token] == 0) return type(uint256).max;
        uint256 vol = (block.timestamp >= lastCapReset[token] + 1 days) ? 0 : dailyVolume[token];
        return dailyCap[token] > vol ? dailyCap[token] - vol : 0;
    }

    /// @notice Remaining releasable volume in the current fixed 24h window.
    function getDailyReleaseRemaining(address token) external view returns (uint256) {
        if (dailyCap[token] == 0) return type(uint256).max;
        uint256 vol = (block.timestamp >= lastReleaseCapReset[token] + 1 days) ? 0 : releaseVolume[token];
        return dailyCap[token] > vol ? dailyCap[token] - vol : 0;
    }
}
