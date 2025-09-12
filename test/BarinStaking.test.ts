import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { BarinStaking, BarinToken } from "../typechain-types";
import { Signer } from "ethers";

describe("BarinStaking", function () {
  let staking: BarinStaking;
  let BarinToken: BarinToken;
  let admin: Signer, treasury: Signer, user1: Signer, user2: Signer;

  beforeEach(async () => {
    [admin, treasury, user1, user2] = await ethers.getSigners();

    const Barin = await ethers.getContractFactory("BarinToken");
    BarinToken = await Barin.deploy();

    // await BarinToken.initialize("Stake Token", "STK");
    // await BarinToken.initialize("Reward Token", "RWD");

    const Staking = await ethers.getContractFactory("BarinStaking");
    staking = (await upgrades.deployProxy(
      Staking,
      [await BarinToken.getAddress(), await BarinToken.getAddress(), await admin.getAddress(), await treasury.getAddress()],
      { initializer: "initialize" }
    )) as BarinStaking;

    // mint tokens
    await BarinToken.transfer(await user1.getAddress(), ethers.parseEther("1000"));
    await BarinToken.transfer(await staking.getAddress(), ethers.parseEther("10000"));
  });

  describe("Initialization", () => {
    it("sets tokens and roles correctly", async () => {
      expect(await staking.rewardToken()).to.equal(await BarinToken.getAddress());
      expect(await staking.stakingToken()).to.equal(await BarinToken.getAddress());
      expect(await staking.hasRole(await staking.ADMIN_ROLE(), await admin.getAddress())).to.be.true;
    });
  });

  describe("Pool Management", () => {
    it("allows admin to add pool", async () => {
      await staking.addPool(
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        500,
        (await ethers.provider.getBlock("latest")).timestamp + 90 * 24 * 3600,
        0
      );
      const pool = await staking.pools(0);
      expect(pool.exists).to.be.true;
    });

    it("allows admin to update pool", async () => {
      await staking.addPool(1, 1, 100, 200, 0);
      await staking.updatePool(0, 2, 2, 200, 500);
      const pool = await staking.pools(0);
      expect(pool.rewardPerSec).to.equal(2);
      expect(pool.penaltyBps).to.equal(200);
    });

    it("reverts if non-admin tries to add pool", async () => {
      await expect(
        staking.connect(user1).addPool(1, 1, 100, 200, 0)
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Staking & Rewards", () => {
    beforeEach(async () => {
      await staking.addPool(
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        500,
        (await ethers.provider.getBlock("latest")).timestamp + 90 * 24 * 3600,
        0
      );
      await BarinToken.connect(user1).approve(await staking.getAddress(), ethers.parseEther("1000"));
    });

    it("allows user to stake and updates balances", async () => {
      await staking.connect(user1).stake(0, ethers.parseEther("100"));
      const stakeInfo = await staking.stakes(await user1.getAddress(), 0);
      expect(stakeInfo.amount).to.equal(ethers.parseEther("100"));
    });

    it("accumulates rewards over time", async () => {
      await staking.connect(user1).stake(0, ethers.parseEther("100"));
      await ethers.provider.send("evm_increaseTime", [1000]);
      await ethers.provider.send("evm_mine", []);
      const pending = await staking.pendingRewards(await user1.getAddress(), 0);
      expect(pending).to.be.gt(0);
    });

    it("lets user claim rewards when staking again", async () => {
      await staking.connect(user1).stake(0, ethers.parseEther("100"));
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine", []);
      await expect(() =>
        staking.connect(user1).stake(0, ethers.parseEther("50"))
      ).to.changeTokenBalances(
        BarinToken,
        [await user1.getAddress()],
        [ethers.parseEther("-39")] // approx
      );
    });

    it("applies penalty on early withdraw", async () => {
      await staking.connect(user1).stake(0, ethers.parseEther("100"));
      await expect(() =>
        staking.connect(user1).withdraw(0, ethers.parseEther("50"))
      ).to.changeTokenBalance(
        BarinToken,
        await treasury.getAddress(),
        (bal) => bal.gt(0) // penalty goes to treasury
      );
    });

    it("lets user withdraw without penalty after unlock", async () => {
      await staking.connect(user1).stake(0, ethers.parseEther("100"));
      const pool = await staking.pools(0);
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(pool.endTime) + 1]);
      await ethers.provider.send("evm_mine", []);
      await expect(() =>
        staking.connect(user1).withdraw(0, ethers.parseEther("100"))
      ).to.changeTokenBalance(BarinToken, await user1.getAddress(), ethers.parseEther("100"));
    });
  });

  describe("Emergency Withdraw", () => {
    it("admin can emergency withdraw user funds", async () => {
      await staking.addPool(1, 1, 100, 200, 0);
      await BarinToken.connect(user1).approve(await staking.getAddress(), 100);
      await staking.connect(user1).stake(0, 100);
      await staking.emergencyWithdraw(0, await user1.getAddress());
      const stakeInfo = await staking.stakes(await user1.getAddress(), 0);
      expect(stakeInfo.amount).to.equal(0);
    });
  });

  describe("Pause", () => {
    it("pauses and prevents staking", async () => {
      await staking.addPool(1, 1, 100, 200, 0);
      await staking.pause();
      await expect(staking.connect(user1).stake(0, 1)).to.be.revertedWith("Pausable: paused");
    });

    it("unpauses and allows staking", async () => {
      await staking.addPool(1, 1, 100, 200, 0);
      await staking.pause();
      await staking.unpause();
      await BarinToken.connect(user1).approve(await staking.getAddress(), 100);
      await expect(staking.connect(user1).stake(0, 1)).to.not.be.reverted;
    });
  });

  describe("UUPS Upgrade", () => {
    it("only admin can upgrade", async () => {
      const StakingV2 = await ethers.getContractFactory("BarinStaking");
      await expect(
        upgrades.upgradeProxy(await staking.getAddress(), StakingV2.connect(user1))
      ).to.be.revertedWith("AccessControl:");
    });
  });
});
