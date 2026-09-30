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
    enum DepositState { None, Pending, Finalized, Refunded }

    struct Deposit {
        address depositor;
        address recipient;
        uint256 amount;
        uint256 targetChain;
        uint256 quotedOutput;
        uint64 quoteExpiry;
        DepositState state;
    }

    struct ReleaseRequest {
        bytes32 operationId;
        uint256 sourceChain;
        address sourceVault;
        bytes32 sourceTxHash;
        uint256 sourceAmount;
        address payable recipient;
        uint256 outputAmount;
        uint64 authorizationExpiry;
    }

    bytes32 private constant RELEASE_ACTION = keccak256("MULTX_NATIVE_RELEASE_V1");
    bytes32 private constant FINALIZE_ACTION = keccak256("MULTX_NATIVE_FINALIZE_V1");
    bytes32 private constant REFUND_ACTION = keccak256("MULTX_NATIVE_REFUND_V1");

    mapping(address => bool) public isValidator;
    address[] public validators;
    uint256 public constant signaturesRequired = 3;

    mapping(uint256 => bool) public supportedChains;
    mapping(uint256 => address) public sourceVaults;
    uint256 public activeChainCount;
    mapping(bytes32 => Deposit) public deposits;
    mapping(bytes32 => bool) public processedReleases;

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
    event LiquidityFunded(address indexed funder, uint256 amount);
    event LiquidityWithdrawn(address indexed recipient, uint256 amount);
    event RouteSet(uint256 indexed chainId, address indexed sourceVault, bool supported);
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
        bytes32 operationId,
        uint256 targetChain,
        address recipient,
        uint256 quotedOutput,
        uint64 quoteExpiry
    ) external payable nonReentrant whenNotPaused {
        require(operationId != bytes32(0), "Invalid operation");
        require(deposits[operationId].state == DepositState.None, "Operation exists");
        require(supportedChains[targetChain], "Route not supported");
        require(recipient != address(0), "Invalid recipient");
        require(msg.value > 0 && quotedOutput > 0, "Invalid amount");
        require(quoteExpiry > block.timestamp, "Quote expired");

        _consumeDepositCap(msg.value);
        deposits[operationId] = Deposit({
            depositor: msg.sender,
            recipient: recipient,
            amount: msg.value,
            targetChain: targetChain,
            quotedOutput: quotedOutput,
            quoteExpiry: quoteExpiry,
            state: DepositState.Pending
        });
        outstandingEscrow += msg.value;
        emit NativeDeposited(operationId, msg.sender, recipient, msg.value, targetChain, quotedOutput, quoteExpiry);
    }

    function releaseNative(ReleaseRequest calldata request, bytes[] calldata signatures)
        external nonReentrant whenNotPaused
    {
        require(request.operationId != bytes32(0) && !processedReleases[request.operationId], "Operation processed");
        require(supportedChains[request.sourceChain], "Route not supported");
        require(request.sourceVault == sourceVaults[request.sourceChain] && request.sourceTxHash != bytes32(0), "Invalid source");
        require(request.recipient != address(0), "Invalid recipient");
        require(request.sourceAmount > 0 && request.outputAmount > 0, "Invalid amount");
        require(request.authorizationExpiry >= block.timestamp, "Authorization expired");
        require(availableLiquidity() >= request.outputAmount, "Insufficient free liquidity");

        _verifyQuorum(releaseDigest(request), signatures);
        _consumePayoutCap(request.outputAmount);
        processedReleases[request.operationId] = true;

        (bool sent,) = request.recipient.call{value: request.outputAmount}("");
        require(sent, "Native payout failed");
        emit NativeReleased(
            request.operationId, request.sourceChain, request.recipient,
            request.sourceAmount, request.outputAmount, request.sourceTxHash,
            request.sourceVault
        );
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

    function refundDeposit(
        bytes32 operationId,
        uint64 authorizationExpiry,
        bytes[] calldata signatures
    ) external nonReentrant {
        Deposit storage item = deposits[operationId];
        require(item.state == DepositState.Pending, "Deposit not pending");
        require(block.timestamp > item.quoteExpiry, "Quote still active");
        require(authorizationExpiry >= block.timestamp, "Authorization expired");
        _verifyQuorum(refundDigest(operationId, authorizationExpiry), signatures);

        item.state = DepositState.Refunded;
        outstandingEscrow -= item.amount;
        (bool sent,) = payable(item.depositor).call{value: item.amount}("");
        require(sent, "Native refund failed");
        emit DepositRefunded(operationId, item.depositor, item.amount);
    }

    function releaseDigest(ReleaseRequest calldata request) public view returns (bytes32) {
        return keccak256(abi.encode(
            RELEASE_ACTION, request.operationId, request.sourceChain,
            request.sourceVault, request.sourceTxHash, request.sourceAmount,
            block.chainid, address(this), request.recipient,
            request.outputAmount, request.authorizationExpiry
        ));
    }

    function finalizeDigest(bytes32 operationId, bytes32 destinationTxHash) public view returns (bytes32) {
        return keccak256(abi.encode(
            FINALIZE_ACTION, operationId, destinationTxHash, block.chainid, address(this)
        ));
    }

    function refundDigest(bytes32 operationId, uint64 authorizationExpiry) public view returns (bytes32) {
        Deposit storage item = deposits[operationId];
        return keccak256(abi.encode(
            REFUND_ACTION, operationId, item.depositor, item.amount,
            item.targetChain, item.recipient, item.quotedOutput, item.quoteExpiry,
            authorizationExpiry, block.chainid, address(this)
        ));
    }

    function availableLiquidity() public view returns (uint256) {
        return address(this).balance - outstandingEscrow;
    }

    function setRoute(uint256 chainId, address sourceVault) external onlyOwner whenPaused {
        require(chainId > 0 && chainId != block.chainid, "Invalid chain");
        bool supported = sourceVault != address(0);
        if (supported != supportedChains[chainId]) {
            supportedChains[chainId] = supported;
            activeChainCount = supported ? activeChainCount + 1 : activeChainCount - 1;
        }
        sourceVaults[chainId] = sourceVault;
        emit RouteSet(chainId, sourceVault, supported);
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
