pragma solidity ^0.8.20;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol';
/**
 * @title Barin Mineral Token (BARIN)
 * @author MerkleX
 * @notice ERC20 token representing the Barin Mineral Token with EIP-2612 support.
 * @dev Inherits from OpenZeppelin's ERC20 and ERC20Permit to enable standard ERC20 behavior and gasless approvals.
 */
contract Barin is ERC20, ERC20Permit {
    constructor() ERC20("Barin Mineral Token", "BARIN") ERC20Permit("Barin Mineral Token") {
        _mint(msg.sender, 1_000_000_000 * 10 ** decimals());
    }
}