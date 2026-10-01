// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title MultX Native Liquidity Vault
/// @notice Escrows native input and pays native output after a 3-of-5 MultX
///         signer quorum attests the corresponding source deposit.
/// @dev The vault starts paused and is deployed with the reviewed 48-hour
///      Timelock as its initial owner.
contract NativeLiquidityVault is Ownable, Pausable, ReentrancyGuard {
    uint64 public constant MAX_QUOTE_LIFETIME_SECONDS = 3600;
    enum DepositState { None, Pending, Finalized, Refunded }
    enum ReleaseState { None, Released, Cancelled }

    struct Deposit {
        address depositor;
        address recipient;
        uint256 amount;
        uint256 targetChain;
        uint256 quotedOutput;
        uint64 quoteExpiry;
        address targetVault;
        uint64 finalityDelaySeconds;
        DepositState state;
    }

    struct ReleaseRequest {
        bytes32 operationId;
        uint256 sourceChain;
        address sourceVault;
        address sourceDepositor;
        uint256 sourceNonce;
        bytes32 clientReference;
        bytes32 sourceTxHash;
        uint256 sourceAmount;
        address payable recipient;
        uint256 outputAmount;
        uint64 sourceQuoteExpiry;
        uint64 releaseDeadline;
        uint64 authorizationExpiry;
    }

    struct CancelRequest {
        bytes32 operationId;
        uint256 sourceChain;
        address sourceVault;
        address sourceDepositor;
        uint256 sourceNonce;
        bytes32 clientReference;
        bytes32 sourceTxHash;
        uint64 sourceQuoteExpiry;
        uint64 releaseDeadline;
        uint64 authorizationExpiry;
    }

    struct RefundRequest {
        bytes32 operationId;
        bytes32 cancellationTxHash;
        bytes32 cancellationBlockHash;
        uint256 cancellationBlockNumber;
        uint64 authorizationExpiry;
    }

    bytes32 private constant RELEASE_ACTION = keccak256("MULTX_NATIVE_RELEASE_V1");
    bytes32 private constant FINALIZE_ACTION = keccak256("MULTX_NATIVE_FINALIZE_V1");
    bytes32 private constant REFUND_ACTION = keccak256("MULTX_NATIVE_REFUND_V1");
    bytes32 private constant CANCEL_ACTION = keccak256("MULTX_NATIVE_CANCEL_V1");

    mapping(address => bool) public isValidator;
    address[] public validators;
    uint256 public constant signaturesRequired = 3;

    mapping(uint256 => bool) public supportedChains;
    mapping(uint256 => address) public sourceVaults;
    mapping(uint256 => uint64) public routeFinalityDelaySeconds;
    uint256 public activeChainCount;
    mapping(address => uint256) public depositNonces;
    mapping(bytes32 => Deposit) public deposits;
    mapping(bytes32 => ReleaseState) public releaseStates;

    uint256 public outstandingEscrow;
    uint256 public dailyDepositCap;
    uint256 public dailyPayoutCap;
    uint256 public depositVolume;
    uint256 public payoutVolume;
    uint64 public depositWindowStart;
    uint64 public payoutWindowStart;
    address public pauseGuardian;

    event NativeDeposited(
        bytes32 indexed operationId,
        address indexed depositor,
        address indexed recipient,
        uint256 amount,
        uint256 targetChain,
        uint256 quotedOutput,
        uint64 quoteExpiry
    );
    event NativeReleased(
        bytes32 indexed operationId,
        uint256 indexed sourceChain,
        address indexed recipient,
        uint256 sourceAmount,
        uint256 outputAmount,
        bytes32 sourceTxHash,
        address sourceVault
    );
    event DepositFinalized(bytes32 indexed operationId, bytes32 indexed destinationTxHash);
    event DepositRefunded(bytes32 indexed operationId, address indexed depositor, uint256 amount);
    event ReleaseCancelled(bytes32 indexed operationId, uint256 indexed sourceChain, bytes32 indexed sourceTxHash);
    event LiquidityFunded(address indexed funder, uint256 amount);
    event LiquidityWithdrawn(address indexed recipient, uint256 amount);
    event RouteSet(uint256 indexed chainId, address indexed sourceVault, uint64 finalityDelaySeconds, bool supported);
    event DailyCapsSet(uint256 depositCap, uint256 payoutCap);
    event ValidatorSetUpdated(address[] validators);
    event PauseGuardianUpdated(address indexed previousGuardian, address indexed newGuardian);

    constructor(address initialOwner, address[] memory initialValidators) Ownable(initialOwner) {
        require(initialOwner != address(0), "Owner required");
        _setValidatorSet(initialValidators);
        _pause();
    }

    receive() external payable {
        emit LiquidityFunded(msg.sender, msg.value);
    }

    function fundLiquidity() external payable {
        require(msg.value > 0, "Funding required");
        emit LiquidityFunded(msg.sender, msg.value);
    }

    function depositNative(
        bytes32 clientReference,
        uint256 targetChain,
        address recipient,
        uint256 quotedOutput,
        uint64 quoteExpiry
    ) external payable nonReentrant whenNotPaused {
        require(supportedChains[targetChain], "Route not supported");
        require(recipient != address(0), "Invalid recipient");
        require(msg.value > 0 && quotedOutput > 0, "Invalid amount");
        require(quoteExpiry > block.timestamp, "Quote expired");
        require(quoteExpiry <= block.timestamp + MAX_QUOTE_LIFETIME_SECONDS, "Quote lifetime too long");

        uint256 sourceNonce = depositNonces[msg.sender]++;
        bytes32 operationId = deriveOperationId(msg.sender, sourceNonce, clientReference);
        _consumeDepositCap(msg.value);
        deposits[operationId] = Deposit({
            depositor: msg.sender,
            recipient: recipient,
            amount: msg.value,
            targetChain: targetChain,
            quotedOutput: quotedOutput,
            quoteExpiry: quoteExpiry,
            targetVault: sourceVaults[targetChain],
            finalityDelaySeconds: routeFinalityDelaySeconds[targetChain],
            state: DepositState.Pending
        });
        outstandingEscrow += msg.value;
        emit NativeDeposited(operationId, msg.sender, recipient, msg.value, targetChain, quotedOutput, quoteExpiry);
    }

    function releaseNative(ReleaseRequest calldata request, bytes[] calldata signatures)
        external nonReentrant whenNotPaused
    {
        require(request.operationId == deriveSourceOperationId(
            request.sourceChain, request.sourceVault, request.sourceDepositor,
            request.sourceNonce, request.clientReference
        ), "Invalid operation identity");
        require(releaseStates[request.operationId] == ReleaseState.None, "Operation terminal");
        require(supportedChains[request.sourceChain], "Route not supported");
        require(request.sourceVault == sourceVaults[request.sourceChain] && request.sourceTxHash != bytes32(0), "Invalid source");
        require(request.recipient != address(0), "Invalid recipient");
        require(request.sourceAmount > 0 && request.outputAmount > 0, "Invalid amount");
        require(request.releaseDeadline <= request.sourceQuoteExpiry, "Release exceeds source quote");
        require(request.releaseDeadline >= block.timestamp, "Release deadline passed");
        require(request.authorizationExpiry >= block.timestamp && request.authorizationExpiry <= request.releaseDeadline, "Invalid authorization window");
        require(availableLiquidity() >= request.outputAmount, "Insufficient free liquidity");

        _verifyQuorum(releaseDigest(request), signatures);
        _consumePayoutCap(request.outputAmount);
        releaseStates[request.operationId] = ReleaseState.Released;

        (bool sent,) = request.recipient.call{value: request.outputAmount}("");
        require(sent, "Native payout failed");
        emit NativeReleased(
            request.operationId, request.sourceChain, request.recipient,
            request.sourceAmount, request.outputAmount, request.sourceTxHash,
            request.sourceVault
        );
    }

    /// @notice Establishes a destination-side terminal state after every
    ///         release certificate for the operation has expired. A source
    ///         refund may only be signed after this cancellation is finalized.
    function cancelRelease(CancelRequest calldata request, bytes[] calldata signatures) external nonReentrant {
        require(request.operationId == deriveSourceOperationId(
            request.sourceChain, request.sourceVault, request.sourceDepositor,
            request.sourceNonce, request.clientReference
        ), "Invalid operation identity");
        require(releaseStates[request.operationId] == ReleaseState.None, "Operation terminal");
        require(supportedChains[request.sourceChain] && request.sourceVault == sourceVaults[request.sourceChain], "Invalid source");
        require(request.sourceTxHash != bytes32(0), "Invalid source");
        require(request.releaseDeadline <= request.sourceQuoteExpiry, "Release exceeds source quote");
        require(block.timestamp > request.releaseDeadline, "Release window active");
        require(request.authorizationExpiry >= block.timestamp, "Authorization expired");
        _verifyQuorum(cancelDigest(request), signatures);
        releaseStates[request.operationId] = ReleaseState.Cancelled;
        emit ReleaseCancelled(request.operationId, request.sourceChain, request.sourceTxHash);
    }

    function finalizeDeposit(
        bytes32 operationId,
        bytes32 destinationTxHash,
        bytes[] calldata signatures
    ) external nonReentrant {
        Deposit storage item = deposits[operationId];
        require(item.state == DepositState.Pending, "Deposit not pending");
        require(destinationTxHash != bytes32(0), "Invalid destination proof");
        _verifyQuorum(finalizeDigest(operationId, destinationTxHash), signatures);
        item.state = DepositState.Finalized;
        outstandingEscrow -= item.amount;
        emit DepositFinalized(operationId, destinationTxHash);
    }

    function refundDeposit(RefundRequest calldata request, bytes[] calldata signatures) external nonReentrant {
        Deposit storage item = deposits[request.operationId];
        require(item.state == DepositState.Pending, "Deposit not pending");
        require(block.timestamp > uint256(item.quoteExpiry) + item.finalityDelaySeconds, "Cancellation not final");
        require(request.cancellationTxHash != bytes32(0) && request.cancellationBlockHash != bytes32(0) && request.cancellationBlockNumber > 0, "Cancellation proof required");
        require(request.authorizationExpiry >= block.timestamp, "Authorization expired");
        _verifyQuorum(refundDigest(request), signatures);

        item.state = DepositState.Refunded;
        outstandingEscrow -= item.amount;
        (bool sent,) = payable(item.depositor).call{value: item.amount}("");
        require(sent, "Native refund failed");
        emit DepositRefunded(request.operationId, item.depositor, item.amount);
    }

    function releaseDigest(ReleaseRequest calldata request) public view returns (bytes32) {
        return keccak256(abi.encode(
            RELEASE_ACTION, keccak256(abi.encode(request)), block.chainid, address(this)
        ));
    }

    function cancelDigest(CancelRequest calldata request) public view returns (bytes32) {
        return keccak256(abi.encode(
            CANCEL_ACTION, keccak256(abi.encode(request)), block.chainid, address(this)
        ));
    }

    function finalizeDigest(bytes32 operationId, bytes32 destinationTxHash) public view returns (bytes32) {
        return keccak256(abi.encode(
            FINALIZE_ACTION, operationId, destinationTxHash, block.chainid, address(this)
        ));
    }

    function refundDigest(RefundRequest calldata request) public view returns (bytes32) {
        Deposit storage item = deposits[request.operationId];
        bytes32 depositHash = keccak256(abi.encode(
            item.depositor, item.recipient, item.amount, item.targetChain,
            item.quotedOutput, item.quoteExpiry, item.targetVault,
            item.finalityDelaySeconds
        ));
        return keccak256(abi.encode(
            REFUND_ACTION, request.operationId, depositHash,
            keccak256(abi.encode(request)), block.chainid, address(this)
        ));
    }

    function deriveOperationId(address depositor, uint256 sourceNonce, bytes32 clientReference) public view returns (bytes32) {
        return deriveSourceOperationId(block.chainid, address(this), depositor, sourceNonce, clientReference);
    }

    function deriveSourceOperationId(
        uint256 sourceChain, address sourceVault, address depositor,
        uint256 sourceNonce, bytes32 clientReference
    ) public pure returns (bytes32) {
        require(sourceChain > 0 && sourceVault != address(0) && depositor != address(0), "Invalid source identity");
        return keccak256(abi.encode(sourceChain, sourceVault, depositor, sourceNonce, clientReference));
    }

    function availableLiquidity() public view returns (uint256) {
        return address(this).balance - outstandingEscrow;
    }

    function setRoute(uint256 chainId, address sourceVault, uint64 finalityDelaySeconds) external onlyOwner whenPaused {
        require(chainId > 0 && chainId != block.chainid, "Invalid chain");
        bool supported = sourceVault != address(0);
        require(!supported || finalityDelaySeconds > 0, "Finality delay required");
        if (supported != supportedChains[chainId]) {
            supportedChains[chainId] = supported;
            activeChainCount = supported ? activeChainCount + 1 : activeChainCount - 1;
        }
        sourceVaults[chainId] = sourceVault;
        routeFinalityDelaySeconds[chainId] = supported ? finalityDelaySeconds : 0;
        emit RouteSet(chainId, sourceVault, routeFinalityDelaySeconds[chainId], supported);
    }

    function setDailyCaps(uint256 depositCap, uint256 payoutCap) external onlyOwner whenPaused {
        require(depositCap > 0 && payoutCap > 0, "Finite caps required");
        dailyDepositCap = depositCap;
        dailyPayoutCap = payoutCap;
        emit DailyCapsSet(depositCap, payoutCap);
    }

    function setPauseGuardian(address guardian) external onlyOwner {
        require(guardian != owner(), "Guardian must be separate");
        emit PauseGuardianUpdated(pauseGuardian, guardian);
        pauseGuardian = guardian;
    }

    function setValidatorSet(address[] calldata newValidators) external onlyOwner whenPaused {
        _setValidatorSet(newValidators);
    }

    function pause() external {
        require(msg.sender == owner() || msg.sender == pauseGuardian, "Not owner or guardian");
        _pause();
    }

    function unpause() external onlyOwner {
        require(activeChainCount > 0, "No routes configured");
        require(dailyDepositCap > 0 && dailyPayoutCap > 0, "Caps not configured");
        require(pauseGuardian != address(0), "Guardian not configured");
        _unpause();
    }

    function withdrawLiquidity(address payable recipient, uint256 amount) external onlyOwner whenPaused nonReentrant {
        require(recipient != address(0) && amount > 0, "Invalid withdrawal");
        require(amount <= availableLiquidity(), "Escrow reserved");
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "Withdrawal failed");
        emit LiquidityWithdrawn(recipient, amount);
    }

    function getValidators() external view returns (address[] memory) {
        return validators;
    }

    function _setValidatorSet(address[] memory newValidators) internal {
        require(newValidators.length == 5, "Exactly five validators required");
        for (uint256 i = 0; i < validators.length; i++) isValidator[validators[i]] = false;
        delete validators;
        for (uint256 i = 0; i < newValidators.length; i++) {
            address validator = newValidators[i];
            require(validator != address(0) && !isValidator[validator], "Invalid validator");
            isValidator[validator] = true;
            validators.push(validator);
        }
        emit ValidatorSetUpdated(newValidators);
    }

    function _verifyQuorum(bytes32 digest, bytes[] calldata signatures) internal view {
        require(signatures.length == signaturesRequired, "Exactly three signatures required");
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        address previous;
        for (uint256 i = 0; i < signaturesRequired; i++) {
            address signer = ECDSA.recover(ethSignedHash, signatures[i]);
            require(isValidator[signer], "Invalid signer");
            require(signer > previous, "Signatures not ordered");
            previous = signer;
        }
    }

    function _consumeDepositCap(uint256 amount) internal {
        if (block.timestamp >= uint256(depositWindowStart) + 1 days) {
            depositWindowStart = uint64(block.timestamp);
            depositVolume = 0;
        }
        require(depositVolume + amount <= dailyDepositCap, "Deposit cap exceeded");
        depositVolume += amount;
    }

    function _consumePayoutCap(uint256 amount) internal {
        if (block.timestamp >= uint256(payoutWindowStart) + 1 days) {
            payoutWindowStart = uint64(block.timestamp);
            payoutVolume = 0;
        }
        require(payoutVolume + amount <= dailyPayoutCap, "Payout cap exceeded");
        payoutVolume += amount;
    }
}
