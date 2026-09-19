// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract MockNativeWrapper is ERC20 {
 constructor() ERC20("Local wrapped native", "LWN") {}
 function deposit() external payable { _mint(msg.sender,msg.value); }
 function withdraw(uint256 amount) external {
  _burn(msg.sender,amount);
  (bool ok,)=msg.sender.call{value:amount}("");
  require(ok,"native withdrawal failed");
 }
}
