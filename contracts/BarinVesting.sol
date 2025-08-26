// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Barin Vesting Contract
 * @author MerkleX
 * @notice Manages multiple vesting schedules for BARIN token allocations across team, marketing, liquidity, and other categories.
 * @dev Uses OpenZeppelin’s Ownable and ReentrancyGuard. 
 *      Schedules are created with a cliff period, total duration, linear vesting, and optional revocability.
 *      Beneficiaries can claim vested tokens, and owner can revoke unvested portions if allowed.
 */

contract BarinVesting is Ownable(msg.sender), ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct VestingSchedule {
        uint256 totalAmount;
        uint256 cliffDuration;     // in seconds
        uint256 vestingDuration;   // in seconds
        uint256 startTime;
        uint256 withdrawnAmount;
        address beneficiary;
        bool revocable;
    }

    IERC20 public immutable token;
    // uint256 public immutable vestingStart;

    // track how many tokens are fully allocated vs. how many have been released
    uint256 private _totalAllocated;
    uint256 private _totalReleased;

    // simple nonce to avoid duplicate IDs
    uint256 private _nonce;

    mapping(bytes32 => VestingSchedule) private _schedules;
    mapping(address => bytes32[]) private _beneficiarySchedules;

    event VestingScheduleCreated(bytes32 indexed scheduleId, address indexed beneficiary, uint256 amount);
    event TokensReleased(bytes32 indexed scheduleId, address indexed beneficiary, uint256 amount);
    event VestingRevoked(bytes32 indexed scheduleId, uint256 unvested);
    event EmergencyWithdraw(address indexed tokenAddress, uint256 amount);

    error InvalidSchedule();
    error CliffLongerThanDuration();
    error NothingToRelease();
    error NotBeneficiary();
    error ScheduleNotRevocable();
    error InsufficientBalance();
    error Underflow();

    constructor(address _token) {
        if (_token == address(0)) revert InvalidSchedule();
        token = IERC20(_token);
        // vestingStart = _vestingStart > 0 ? _vestingStart : block.timestamp;
    }

    /**
     * @dev Creates a new vesting schedule
     * @param beneficiary Address of the beneficiary
     * @param totalAmount Total amount to be vested
     * @param cliffDuration Cliff period in seconds
     * @param vestingDuration Total vesting duration in seconds
     * @param revocable Whether the schedule can be revoked
     */
    function createVestingSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 cliffDuration,
        uint256 vestingDuration,
        bool revocable
    ) external onlyOwner returns (bytes32 scheduleId) {
        return _createVestingSchedule(beneficiary, totalAmount, cliffDuration, vestingDuration, revocable);
    }

    /**
     * @dev Batch create multiple vesting schedules (gas efficient)
     */
    function batchCreateSchedules(
        address[] calldata beneficiaries,
        uint256[] calldata amounts,
        uint256[] calldata cliffDurations,
        uint256[] calldata vestingDurations,
        bool[] calldata revocables
    ) external onlyOwner {
        uint256 length = beneficiaries.length;
        if (
            length != amounts.length ||
            length != cliffDurations.length ||
            length != vestingDurations.length ||
            length != revocables.length
        ) {
            revert InvalidSchedule();
        }

        for (uint256 i = 0; i < length; i++) {
            _createVestingSchedule(
                beneficiaries[i],
                amounts[i],
                cliffDurations[i],
                vestingDurations[i],
                revocables[i]
            );
        }
    }

    /**
     * @dev Internal function to create vesting schedule
     */
    function _createVestingSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 cliffDuration,
        uint256 vestingDuration,
        bool revocable
    ) internal returns (bytes32 scheduleId) {
        if (beneficiary == address(0) || totalAmount == 0 || vestingDuration == 0) {
            revert InvalidSchedule();
        }
        if (cliffDuration > vestingDuration) {
            revert CliffLongerThanDuration();
        }

        // compute how many tokens are already “owed” by existing schedules
        uint256 owed = _totalAllocated - _totalReleased;
        uint256 available = token.balanceOf(address(this)) - owed;
        if (available < totalAmount) {
            revert InsufficientBalance();
        }

        _totalAllocated += totalAmount;

        // include a nonce to avoid duplicate IDs in the same block
        scheduleId = keccak256(
            abi.encodePacked(beneficiary, block.timestamp, totalAmount, _nonce++)
        );

        _schedules[scheduleId] = VestingSchedule({
            totalAmount: totalAmount,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            startTime: block.timestamp,
            withdrawnAmount: 0,
            beneficiary: beneficiary,
            revocable: revocable
        });

        _beneficiarySchedules[beneficiary].push(scheduleId);

        emit VestingScheduleCreated(scheduleId, beneficiary, totalAmount);
    }

    /**
     * @dev Release vested tokens for a specific schedule
     */
    function release(bytes32 scheduleId) public nonReentrant {
        VestingSchedule storage schedule = _schedules[scheduleId];

        if (schedule.beneficiary != msg.sender && msg.sender != owner()) {
            revert NotBeneficiary();
        }

        uint256 vested = _vestedAmount(scheduleId);
        uint256 withdrawn = schedule.withdrawnAmount;
        if (vested < withdrawn) {
            revert Underflow();
        }

        uint256 releasable = vested - withdrawn;
        if (releasable == 0) {
            revert NothingToRelease();
        }

        schedule.withdrawnAmount = withdrawn + releasable;
        _totalReleased += releasable;

        token.safeTransfer(schedule.beneficiary, releasable);

        emit TokensReleased(scheduleId, schedule.beneficiary, releasable);
    }

    /**
     * @dev Batch release for multiple schedules
     */
    function batchRelease(bytes32[] calldata scheduleIds) external {
        for (uint256 i = 0; i < scheduleIds.length; i++) {
            bytes32 sid = scheduleIds[i];
            uint256 vested = _vestedAmount(sid);
            uint256 withdrawn = _schedules[sid].withdrawnAmount;
            if (vested > withdrawn) {
                release(sid);
            }
        }
    }

    /**
     * @dev Revoke a vesting schedule (if revocable)
     */
    function revoke(bytes32 scheduleId) external onlyOwner {
        VestingSchedule storage schedule = _schedules[scheduleId];

        if (!schedule.revocable) {
            revert ScheduleNotRevocable();
        }

        uint256 vested = _vestedAmount(scheduleId);
        uint256 unvestedAmount = schedule.totalAmount - vested;

        schedule.totalAmount = vested;
        schedule.revocable = false;
        
        // Adjust total allocated
        _totalAllocated -= unvestedAmount;

        if (unvestedAmount > 0) {
            token.safeTransfer(owner(), unvestedAmount);
            emit VestingRevoked(scheduleId, unvestedAmount);
        }
    }

    /**
     * @dev Calculate releasable amount for a schedule
     */
    function _releasableAmount(bytes32 scheduleId) private view returns (uint256) {
        uint256 vested = _vestedAmount(scheduleId);
        uint256 withdrawn = _schedules[scheduleId].withdrawnAmount;
        return vested > withdrawn ? (vested - withdrawn) : 0;
    }

    /**
     * @dev Calculate vested amount for a schedule
     */
    function _vestedAmount(bytes32 scheduleId) private view returns (uint256) {
        VestingSchedule memory schedule = _schedules[scheduleId];
        if (schedule.beneficiary == address(0)) return 0;

        uint256 elapsed = block.timestamp - schedule.startTime;
        if (elapsed < schedule.cliffDuration) {
            return 0;
        }
        if (elapsed >= schedule.vestingDuration) {
            return schedule.totalAmount;
        }
        return (schedule.totalAmount * elapsed) / schedule.vestingDuration;
    }

    // View functions
    function getSchedule(bytes32 scheduleId) external view returns (VestingSchedule memory) {
        return _schedules[scheduleId];
    }

    function releasableAmount(bytes32 scheduleId) external view returns (uint256) {
        return _releasableAmount(scheduleId);
    }

    function vestedAmount(bytes32 scheduleId) external view returns (uint256) {
        return _vestedAmount(scheduleId);
    }

    function getBeneficiarySchedules(address beneficiary) external view returns (bytes32[] memory) {
        return _beneficiarySchedules[beneficiary];
    }

    /**
     * @dev Emergency function to recover accidentally sent tokens
     */
    function emergencyWithdraw(address tokenAddress, uint256 amount) external onlyOwner {
        IERC20(tokenAddress).safeTransfer(owner(), amount);
        emit EmergencyWithdraw(tokenAddress, amount);
    }
}