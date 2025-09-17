// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
/**
 * @title Barin Mineral Token (BARIN)
 * @author MerkleX
 * @notice ERC20 token representing the Barin Mineral Token with EIP-2612 support.
 * @dev Inherits from OpenZeppelin's ERC20 and ERC20Permit to enable standard ERC20 behavior and gasless approvals.
 */
contract MockERC20 is ERC20 {
    constructor() ERC20("MockERC20", "MERC20") {}
    function mint(address receiver, uint256 amount) public { 
        _mint(receiver, amount);
    }
}