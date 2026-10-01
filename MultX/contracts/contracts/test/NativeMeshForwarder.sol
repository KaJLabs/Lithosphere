// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Disposable integration fixture for contract-wallet and contract-relayer calls.
contract NativeMeshForwarder {
    function forward(address target, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory result) = target.call{value: msg.value}(data);
        if (!ok) assembly { revert(add(result, 32), mload(result)) }
        return result;
    }

    receive() external payable {}
}
