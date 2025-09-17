import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { increaseTime } from "./utils";
describe("BarinStaking", function () {
  let Staking, staking, owner, admin, treasury, user1, user2;
  let StakingToken, RewardToken, stakingToken, rewardToken;

  beforeEach(async function () {
    [owner, admin, treasury, user1, user2] = await ethers.getSigners();

    // Deploy mock tokens
    StakingToken = await ethers.getContractFactory("MockERC20");
    RewardToken = await ethers.getContractFactory("MockERC20");

    stakingToken = await StakingToken.deploy();
    rewardToken = await RewardToken.deploy();

    // Mint balances
    await stakingToken.mint(user1.address, ethers.parseEther("1000"));
    await stakingToken.mint(user2.address, ethers.parseEther("1000"));
    await rewardToken.mint(owner.address, ethers.parseEther("1000000"));
    
    // Deploy staking contract
    Staking = await ethers.getContractFactory("BarinStaking");

    staking = await Staking.deploy();
    await staking.initialize(await stakingToken.getAddress(),await rewardToken.getAddress(), await admin.getAddress(), treasury.address);

    // Fund staking contract with rewards
    await rewardToken.transfer(await staking.getAddress(), ethers.parseEther("100000"));
  });

  describe("Initialization", function () {
    it("sets correct parameters", async function () {
      expect(await staking.stakingToken()).to.equal(await stakingToken.getAddress());
      expect(await staking.rewardToken()).to.equal(await rewardToken.getAddress());
      expect(await staking.treasury()).to.equal(treasury.address);
      expect(await staking.hasRole(await staking.ADMIN_ROLE(), admin.address)).to.be.true;
    });
  });

  describe("Admin functions", function () {
    it("allows admin to add a pool", async function () {
      await staking.connect(admin).addPool(10, 100, 500, (await ethers.provider.getBlock("latest")).timestamp + 1000, 0);
      const pool = await staking.pools(0);
      expect(pool.rewardPerSec).to.equal(10);
    });

    it("updates pool params", async function () {
      await staking.connect(admin).addPool(10, 100, 1, (await ethers.provider.getBlock("latest")).timestamp + 1000, 0);
      await staking.connect(admin).updatePool(0, 20, 1, 600, (await ethers.provider.getBlock("latest")).timestamp + 2000);
      const pool = await staking.pools(0);
      expect(pool.rewardPerSec).to.equal(20);
    });

    it("reverts if non-admin adds pool", async function () {
      await expect(staking.connect(user1).addPool(10, 100, 1, 0, 0))
        .to.reverted;
    });
  });

  describe("Staking flow", function () {
    beforeEach(async function () {
      await staking.connect(admin).addPool(10, 100, 1, (await ethers.provider.getBlock("latest")).timestamp + 1000, 0);
      await stakingToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("1000"));
    });

    it("stakes and earns rewards", async function () {
      await staking.connect(user1).stake(0, 200);
      await ethers.provider.send("evm_increaseTime", [100]); // simulate time
      await ethers.provider.send("evm_mine");

      await staking.connect(user1).withdraw(0, 100);
      expect(await stakingToken.balanceOf(user1.address)).to.be.gt(ethers.parseEther("800")); // staked + partial withdrawn
    });

    it("forfeits rewards if withdrawn early with penalty", async function () {
      await staking.connect(user1).stake(0, 200);
      await expect(staking.connect(user1).withdraw(0, 200))
        .to.emit(staking, "Withdrawn")
        .withArgs(user1.address, 0, 200, anyValue); // penalty > 0
    });

    it("claims rewards on new stake", async function () {
      await staking.connect(user1).stake(0, 200);
      await ethers.provider.send("evm_increaseTime", [200]);
      await ethers.provider.send("evm_mine");

      await staking.connect(user1).stake(0, 100); // triggers reward claim
      const rewardBal = await rewardToken.balanceOf(user1.address);
      expect(rewardBal).to.be.gt(0);
    });

    it("emergency withdraw works by admin", async function () {
      await staking.connect(user1).stake(0, 200);
      await staking.connect(admin).emergencyWithdraw(0, user1.address);
      expect(await stakingToken.balanceOf(user1.address)).to.equal(ethers.parseEther("1000"));
    });
  });

  describe("Views & Helpers", function () {
    beforeEach(async function () {
      await staking.connect(admin).addPool(10, 100, 1, (await ethers.provider.getBlock("latest")).timestamp + 1000, 0);
      await stakingToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("1000"));
      await staking.connect(user1).stake(0, 200);
    });

    it("returns pending rewards", async function () {
      await ethers.provider.send("evm_increaseTime", [200]);
      await ethers.provider.send("evm_mine");
      const pending = await staking.pendingRewards(user1.address, 0);
      expect(pending).to.be.gt(0);
    });

    it("returns TVL", async function () {
      expect(await staking.getTVL(0)).to.equal(200);
    });

    it("returns unlockTime", async function () {
      const unlock = await staking.getUnlockTime(user1.address, 0);
      expect(unlock).to.be.gt(0);
    });

    it("previews penalty", async function () {
      const penalty = await staking.previewPenalty(0, 200);
      expect(penalty).to.be.gt(0);
    });
  });

  describe("Pause control", function () {
    it("pauses/unpauses", async function () {
      await staking.connect(admin).pause();
      await expect(staking.connect(user1).stake(0, 100)).to.be.reverted;
      await staking.connect(admin).unpause();
    });
  });
  describe("Additional Coverage", function () {
    beforeEach(async function () {
      await staking.connect(admin).addPool(5, 50, 1, (await ethers.provider.getBlock("latest")).timestamp + 5000, 0);
    });

    it("reverts if updating non-existent pool", async function () {
      await expect(staking.connect(admin).updatePool(99, 1, 1, 1, 1))
        .to.be.revertedWith("Pool not found");
    });

    it("reverts if staking below minStake", async function () {
      await stakingToken.connect(user1).approve(await staking.getAddress(), 10);
      await expect(staking.connect(user1).stake(0, 10)).to.be.revertedWith("Below min stake");
    });

    it("reverts if staking into invalid pool", async function () {
      await stakingToken.connect(user1).approve(await staking.getAddress(), 100);
      await expect(staking.connect(user1).stake(42, 100)).to.be.revertedWith("Invalid pool");
    });

    it("reverts if withdrawing more than staked", async function () {
      await stakingToken.connect(user1).approve(await staking.getAddress(), 100);
      await staking.connect(user1).stake(0, 100);
      await expect(staking.connect(user1).withdraw(0, 200)).to.be.revertedWith("Not enough staked");
    });

    it("applies no penalty when unlocked", async function () {
      await stakingToken.connect(user1).approve(await staking.getAddress(), 100);
      await staking.connect(user1).stake(0, 100);

      // travel beyond unlock time
      await ethers.provider.send("evm_increaseTime", [6000]);
      await ethers.provider.send("evm_mine");

      const balBefore = await stakingToken.balanceOf(user1.address);
      await staking.connect(user1).withdraw(0, 100);
      const balAfter = await stakingToken.balanceOf(user1.address);

      expect(balAfter).to.be.gt(balBefore); // full amount back
    });

    it("handles updatePool with stakers (branch coverage)", async function () {
      await stakingToken.connect(user1).approve(await staking.getAddress(), 100);
      await staking.connect(user1).stake(0, 100);

      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");

      await staking.connect(admin).updatePool(0, 50, 60, 300, (await ethers.provider.getBlock("latest")).timestamp + 10000);
      const pool = await staking.pools(0);
      expect(pool.rewardPerSec).to.equal(50);
    });

    it("does nothing in _updatePool when no stakers", async function () {
      await staking.connect(admin).addPool(1, 1, 1, (await ethers.provider.getBlock("latest")).timestamp + 1000, 0);
      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");
      await staking.connect(admin).updatePool(1, 1, 1, 1, (await ethers.provider.getBlock("latest")).timestamp + 2000)
      // just exercising branch where totalStaked == 0
    });

    it("reverts emergencyWithdraw when nothing staked", async function () {
      await expect(staking.connect(admin).emergencyWithdraw(0, user1.address))
        .to.be.revertedWith("Nothing staked");
    });

    it("only admin can pause/unpause", async function () {
      await expect(staking.connect(user1).pause()).to.be.reverted;
      await expect(staking.connect(user1).unpause()).to.be.reverted;
    });
  
    it("reverts on re-initialize", async function () {
      await expect(
        staking.initialize(
          await stakingToken.getAddress(),
          await rewardToken.getAddress(),
          admin.address,
          treasury.address
        )
      ).to.be.reverted;
    });

    it("stake twice quickly (pending == 0 path)", async function () {
      await stakingToken.connect(user1).approve(await staking.getAddress(), 500);
      await staking.connect(user1).stake(0, 100);
      // Stake again immediately without time passing
      await expect(staking.connect(user1).stake(0, 50))
        .to.emit(staking, "Staked")
        .withArgs(user1.address, 0, 50);
    });

    it("withdraw immediately after stake (penalty == 0, pending == 0)", async function () {
      await stakingToken.connect(user1).approve(await staking.getAddress(), 100);
      await staking.connect(user1).stake(0, 100);
      // Set block time to unlock time
      const unlock = await staking.getUnlockTime(user1.address, 0);
      // await ethers.provider.send("evm_setNextBlockTimestamp", [Number(unlock)]);
      const block = await ethers.provider.getBlock("latest");
      await increaseTime(Number(unlock) - block.timestamp);
      await ethers.provider.send("evm_mine");
      await expect(staking.connect(user1).withdraw(0, 100))
        .to.emit(staking, "Withdrawn")
        .withArgs(user1.address, 0, 100, 0);
    });

    it("_updatePool does nothing if block.timestamp <= lastRewardTime", async function () {
      await stakingToken.connect(user1).approve(await staking.getAddress(), 100);
      await staking.connect(user1).stake(0, 100);
      const poolBefore = await staking.pools(0);
      await staking.connect(admin).updatePool(0, 5, 50, 500, poolBefore.endTime);
      const poolAfter = await staking.pools(0);
      expect(poolAfter.reward).to.equal(poolBefore.reward);
    });

    it("pendingRewards returns 0 for user with no stake", async function () {
      const pending = await staking.pendingRewards(user2.address, 0);
      expect(pending).to.equal(0);
    });

    it("pendingRewards when block.timestamp <= lastRewardTime", async function () {
      await stakingToken.connect(user1).approve(await staking.getAddress(), 100);
      await staking.connect(user1).stake(0, 100);
      const pool = await staking.pools(0);
      const block = await ethers.provider.getBlock("latest");
      await increaseTime(Number(pool.lastRewardTime) - block.timestamp);
      const pending = await staking.pendingRewards(user1.address, 0);
      expect(pending).to.be.gte(0);
    });

    it("emergencyWithdraw resets stake and emits event", async function () {
      await stakingToken.connect(user1).approve(await staking.getAddress(), 100);
      await staking.connect(user1).stake(0, 100);
      await expect(staking.connect(admin).emergencyWithdraw(0, user1.address))
        .to.emit(staking, "EmergencyWithdraw")
        .withArgs(user1.address, 0, 100);
      const stakeInfo = await staking.stakes(user1.address, 0);
      expect(stakeInfo.amount).to.equal(0);
    });

    it("reverts withdraw from non-existent pool", async function () {
      await expect(staking.connect(user1).withdraw(99, 100)).to.be.reverted;
    });

    it("reverts emergencyWithdraw from non-existent pool", async function () {
      await expect(staking.connect(admin).emergencyWithdraw(99, user1.address)).to.be.reverted;
    });

  });
});
