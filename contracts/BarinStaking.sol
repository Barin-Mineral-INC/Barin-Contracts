// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/**
 * @title MultiPoolStakingUpgradeable
 * @notice Upgradable staking contract with multiple pools (flexible/locked),
 *         BARIN reward token, rewardPerSec emissions, early withdrawal penalties,
 *         and admin-controlled parameters.
 */
contract MultiPoolStakingUpgradeable is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    uint256 public constant MULTIPLIER = 1e12;

    IERC20 public stakingToken;   // BARIN staking token
    IERC20 public rewardToken;    // BARIN reward token

    struct Pool {
        uint256 rewardPerSec;
        uint256 minStake;      
        uint256 penaltyBps;     
        uint256 endTime;     
        uint256 totalStaked;     
        uint256 accRewardPerShare;
        uint256 lastRewardTime;
        bool exists;
    }

    struct Stake {
        uint256 amount;
        uint256 rewardDebt;
        uint256 unlockTime;
    }

    uint256 public poolCount;
    address public treasury;
    mapping(uint256 => Pool) public pools;
    mapping(address => mapping(uint256 => Stake)) public stakes;

    // ---------------- EVENTS ----------------
    event PoolAdded(uint256 indexed poolId, uint256 rewardPerSec);
    event PoolUpdated(uint256 indexed poolId, uint256 rewardPerSec);
    event Staked(address indexed user, uint256 indexed poolId, uint256 amount);
    event Withdrawn(address indexed user, uint256 indexed poolId, uint256 amount, uint256 penalty);
    event RewardClaimed(address indexed user, uint256 indexed poolId, uint256 reward);
    event EmergencyWithdraw(address indexed user, uint256 indexed poolId, uint256 amount);

    // ---------------- INITIALIZER ----------------
    function initialize(
        ERC20Upgradeable _stakingToken,
        ERC20Upgradeable _rewardToken,
        address _admin,
        address _treasury
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        stakingToken = _stakingToken;
        rewardToken  = _rewardToken;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        treasury = _treasury;
    }

    // ---------------- UUPS ----------------
    function _authorizeUpgrade(address newImpl) internal override onlyRole(ADMIN_ROLE) {}

    // ---------------- ADMIN METHODS ----------------
    function addPool(
        uint256 rewardPerSec,
        uint256 minStake,
        uint256 penaltyBps,
        uint256 endTime,
        uint256 accRewardPerShare
    ) external onlyRole(ADMIN_ROLE) {
        pools[poolCount] = Pool({
            rewardPerSec: rewardPerSec,
            minStake: minStake,
            penaltyBps: penaltyBps,
            endTime: endTime,
            totalStaked: 0,
            accRewardPerShare: accRewardPerShare,
            lastRewardTime: block.timestamp,
            exists: true
        });

        emit PoolAdded(poolCount, rewardPerSec);
        poolCount++;
    }

    function updatePool(
        uint256 poolId,
        uint256 rewardPerSec,
        uint256 minStake,
        uint256 penaltyBps,
        uint256 endTime
    ) external onlyRole(ADMIN_ROLE) {
        require(pools[poolId].exists, "Pool not found");
        _updatePool(poolId);

        Pool storage p = pools[poolId];
        p.rewardPerSec = rewardPerSec;
        p.minStake = minStake;
        p.penaltyBps = penaltyBps;
        p.endTime = endTime;
        emit PoolUpdated(poolId, rewardPerSec);
    }

    // ---------------- USER METHODS ----------------
    function stake(uint256 poolId, uint256 amount) external nonReentrant whenNotPaused {
        Pool storage p = pools[poolId];
        require(p.exists, "Invalid pool");
        require(amount >= p.minStake, "Below min stake");
        // require(amount + stakes[msg.sender][poolId].amount <= p.maxStake, "Exceeds max stake");
        // require(p.totalStaked + amount <= p.cap, "Pool cap exceeded");

        _updatePool(poolId);

        Stake storage s = stakes[msg.sender][poolId];
        if (s.amount > 0) {
            uint256 pending = (s.amount * p.accRewardPerShare) / MULTIPLIER - s.rewardDebt;
            if (pending > 0) {
                rewardToken.transfer(msg.sender, pending);
                emit RewardClaimed(msg.sender, poolId, pending);
            }
        }

        stakingToken.transferFrom(msg.sender, address(this), amount);

        s.amount += amount;
        s.unlockTime = p.endTime;
        s.rewardDebt = (s.amount * p.accRewardPerShare) / MULTIPLIER;

        p.totalStaked += amount;
        emit Staked(msg.sender, poolId, amount);
    }

    function withdraw(uint256 poolId, uint256 amount) external nonReentrant {
        Stake storage s = stakes[msg.sender][poolId];
        Pool storage p = pools[poolId];
        require(s.amount >= amount, "Not enough staked");

        _updatePool(poolId);

        uint256 pending = (s.amount * p.accRewardPerShare) / MULTIPLIER - s.rewardDebt;

        uint256 penalty;
        if (block.timestamp < s.unlockTime) {
            // Early withdrawal -> apply penalty, forfeit rewards
            penalty = (amount * p.penaltyBps) * (s.unlockTime - block.timestamp) / 10000;
            pending = 0; // all unclaimed rewards forfeited
        }

        s.amount -= amount;
        s.rewardDebt = (s.amount * p.accRewardPerShare) / MULTIPLIER;
        p.totalStaked -= amount;

        stakingToken.transfer(msg.sender, amount - penalty);
        if (penalty > 0) {
            stakingToken.transfer(treasury, penalty); // treasury
        }

        if (pending > 0) {
            rewardToken.transfer(msg.sender, pending);
            emit RewardClaimed(msg.sender, poolId, pending);
        }

        emit Withdrawn(msg.sender, poolId, amount, penalty);
    }

    function emergencyWithdraw(uint256 poolId, address user) external nonReentrant onlyRole(ADMIN_ROLE)  {
        Stake storage s = stakes[user][poolId];
        uint256 amount = s.amount;
        require(amount > 0, "Nothing staked");

        s.amount = 0;
        s.rewardDebt = 0;
        pools[poolId].totalStaked -= amount;

        stakingToken.transfer(user, amount);

        emit EmergencyWithdraw(user, poolId, amount);
    }

    // ---------------- INTERNAL REWARD LOGIC ----------------
    function _updatePool(uint256 poolId) internal {
        Pool storage p = pools[poolId];
        if (block.timestamp <= p.lastRewardTime) return;
        if (p.totalStaked == 0) {
            p.lastRewardTime = block.timestamp;
            return;
        }
        uint256 duration = block.timestamp - p.lastRewardTime;
        uint256 reward = duration * p.rewardPerSec;
        p.accRewardPerShare += (reward * MULTIPLIER) / p.totalStaked;
        p.lastRewardTime = block.timestamp;
    }

    // ---------------- VIEWS ----------------
    function pendingRewards(address user, uint256 poolId) public view returns (uint256) {
        Pool storage p = pools[poolId];
        Stake storage s = stakes[user][poolId];

        uint256 accRewardPerShare = p.accRewardPerShare;
        if (block.number > p.lastRewardTime && p.totalStaked != 0) {
            uint256 blocks = block.number - p.lastRewardTime;
            uint256 reward = blocks * p.rewardPerSec;
            accRewardPerShare += (reward * MULTIPLIER) / p.totalStaked;
        }
        return (s.amount * accRewardPerShare) / MULTIPLIER - s.rewardDebt;
    }

    function getTVL(uint256 poolId) external view returns (uint256) {
        return pools[poolId].totalStaked;
    }

    function getUnlockTime(address user, uint256 poolId) external view returns (uint256) {
        return stakes[user][poolId].unlockTime;
    }

    function previewPenalty(uint256 poolId, uint256 amount) external view returns (uint256) {
        Pool storage p = pools[poolId];
        return (amount * p.penaltyBps) * (p.endTime - block.timestamp) / 10000;
    }

    // ---------------- PAUSE CONTROL ----------------
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
}
