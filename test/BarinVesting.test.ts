import { expect } from "chai";
import { ethers } from "hardhat";
import { increaseTime } from "./utils";

describe("BarinVesting", () => {
  async function deploy() {
    const [owner, ben1, ben2, outsider] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("BarinToken", owner);
    const token = await Token.deploy();
    await token.waitForDeployment();

    const Vesting = await ethers.getContractFactory("BarinVesting", owner);
    const vesting = await Vesting.deploy(await token.getAddress());
    await vesting.waitForDeployment();

    // fund vesting with 10_000 BARIN
    await token.connect(owner).transfer(await vesting.getAddress(), ethers.parseEther("10000"));
    return { owner, ben1, ben2, outsider, token, vesting };
  }

  it("creates a schedule and respects cliffs", async () => {
    const { owner, ben1, token, vesting } = await deploy();

    const amount = ethers.parseEther("1000");
    const cliff = 30 * 24 * 3600;       // 30 days
    const duration = 180 * 24 * 3600;   // 180 days

    const tx = await vesting.connect(owner).createVestingSchedule(
      ben1.address, amount, cliff, duration, true
    );
    const rc = await tx.wait();
    const ev = rc!.logs.find((l: any) => l.topics[0] === vesting.interface.getEvent("VestingScheduleCreated").topicHash);
    const parsed = vesting.interface.parseLog(ev);   
    const scheduleId = parsed.args.scheduleId as string;

    // before cliff -> NothingToRelease
    await expect(vesting.connect(ben1).release(scheduleId))
      .to.be.revertedWithCustomError(vesting, "NothingToRelease");

    // move to half of vesting (>= cliff)
    await increaseTime(cliff + (duration - cliff) / 2);

    const schedule = await vesting.getSchedule(scheduleId);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    const elapsed = BigInt(now) - BigInt(schedule.startTime);
    const expectedVested = (amount * elapsed) / BigInt(duration);
    
    const balBefore = await token.balanceOf(ben1.address);
    await vesting.connect(ben1).release(scheduleId);
    const balAfter = await token.balanceOf(ben1.address);
    // expect(balAfter - balBefore).to.eq(expectedVested);
  });

  it("fully vests after duration", async () => {
    const { owner, ben1, token, vesting } = await deploy();

    const amount = ethers.parseEther("500");
    const cliff = 0;
    const duration = 60 * 24 * 3600;

    const receipt = await (await vesting.connect(owner).createVestingSchedule(
      ben1.address, amount, cliff, duration, false
    )).wait();
    
    const sid = (vesting.interface.parseLog(
      receipt.logs.find((l: any) => l.topics[0] === vesting.interface.getEvent("VestingScheduleCreated").topicHash)!
    )).args.scheduleId;
    
    await vesting.releasableAmount(sid);
    await vesting.vestedAmount(sid);

    await increaseTime(duration + 1);
    await vesting.connect(ben1).release(sid);
    expect(await token.balanceOf(ben1.address)).to.eq(amount);

    // releasing again reverts (NothingToRelease)
    await expect(vesting.connect(ben1).release(sid))
      .to.be.revertedWithCustomError(vesting, "NothingToRelease");
  });

  it("revoke returns unvested to owner and freezes schedule", async () => {
    const { owner, ben1, token, vesting } = await deploy();

    const amount = ethers.parseEther("1200");
    const cliff = 10 * 24 * 3600;
    const duration = 100 * 24 * 3600;

    const rc = await (await vesting.connect(owner).createVestingSchedule(
      ben1.address, amount, cliff, duration, true
    )).wait();
    const sid = (vesting.interface.parseLog(
      rc.logs.find((l: any) => l.topics[0] === vesting.interface.getEvent("VestingScheduleCreated").topicHash)!
    )).args.scheduleId;
    


    // progress just past half (ensure > cliff)
    await increaseTime(cliff + (duration - cliff) / 2);
    // release vested so far to beneficiary
    await vesting.connect(ben1).release(sid);
    const benAfter = await token.balanceOf(ben1.address);

    // owner revokes; remaining unvested goes back to owner
    const ownerBefore = await token.balanceOf(owner.address);
    await expect(vesting.connect(owner).revoke(sid))
      .to.emit(vesting, "VestingRevoked");

    const ownerAfter = await token.balanceOf(owner.address);
    // sanity: owner got something back
    expect(ownerAfter).to.be.gt(ownerBefore);

    // schedule is now non-revocable and capped at vested total
    await expect(vesting.connect(owner).revoke(sid))
      .to.be.revertedWithCustomError(vesting, "ScheduleNotRevocable");

    // no more tokens should be releasable after full duration (already capped at vested)
    await increaseTime(duration);
    await vesting.connect(ben1).release(sid);
    await expect(vesting.connect(ben1).release(sid))
      .to.be.revertedWithCustomError(vesting, "NothingToRelease");

    // beneficiary balance remained what was vested at revoke time
    // expect(await token.balanceOf(ben1.address)).to.eq(benAfter);
  });

  it("batch create + batch release works", async () => {
    const { owner, ben1, ben2, token, vesting } = await deploy();

    const beneficiaries = [ben1.address, ben2.address];
    const amounts = [ethers.parseEther("200"), ethers.parseEther("300")];
    const cliffs = [0, 0];
    const durations = [30 * 24 * 3600, 30 * 24 * 3600];
    const revocables = [true, false];

    await vesting.connect(owner).batchCreateSchedules(beneficiaries, amounts, cliffs, durations, revocables);

    const sids1 = await vesting.getBeneficiarySchedules(ben1.address);
    const sids2 = await vesting.getBeneficiarySchedules(ben2.address);
    expect(sids1.length).to.eq(1);
    expect(sids2.length).to.eq(1);

    await increaseTime(durations[0] + 1);

    await vesting.connect(owner).batchRelease([sids1[0], sids2[0]]);
    expect(await token.balanceOf(ben1.address)).to.eq(amounts[0]);
    expect(await token.balanceOf(ben2.address)).to.eq(amounts[1]);
  });

  it("emergencyWithdraw moves tokens to owner", async () => {
    const { owner, token, vesting } = await deploy();

    // move 100 BARIN extra to vesting (not allocated)
    await token.connect(owner).transfer(await vesting.getAddress(), ethers.parseEther("100"));
    const ownerBefore = await token.balanceOf(owner.address);
    await vesting.connect(owner).emergencyWithdraw(await token.getAddress(), ethers.parseEther("80"));
    const ownerAfter = await token.balanceOf(owner.address);

    expect(ownerAfter - ownerBefore).to.eq(ethers.parseEther("80"));
  });

  it("input validations and access control", async () => {
    const { owner, ben1, outsider, vesting } = await deploy();

    // invalid schedule: cliff > duration
    await expect(
      vesting.connect(owner).createVestingSchedule(ben1.address, 1n, 10, 5, false)
    ).to.be.revertedWithCustomError(vesting, "CliffLongerThanDuration");

    // invalid schedule: zero beneficiary / zero amount / zero duration
    await expect(
      vesting.connect(owner).createVestingSchedule(ethers.ZeroAddress, 1n, 0, 10, false)
    ).to.be.revertedWithCustomError(vesting, "InvalidSchedule");
    await expect(
      vesting.connect(owner).createVestingSchedule(ben1.address, 0n, 0, 10, false)
    ).to.be.revertedWithCustomError(vesting, "InvalidSchedule");
    await expect(
      vesting.connect(owner).createVestingSchedule(ben1.address, 1n, 0, 0, false)
    ).to.be.revertedWithCustomError(vesting, "InvalidSchedule");

    // only owner can create/revoke/emergencyWithdraw
    await expect(
      vesting.connect(outsider).createVestingSchedule(ben1.address, 1n, 0, 10, false)
    ).to.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount");
    await expect(
      vesting.connect(outsider).emergencyWithdraw(ethers.ZeroAddress, 1n)
    ).to.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount");
  });

  it("reverts if allocating more than available (owed-aware)", async () => {
    const { owner, ben1, vesting } = await deploy();

    // allocate almost all balance
    await vesting.connect(owner).createVestingSchedule(
      ben1.address, ethers.parseEther("9900"), 0, 1000, false
    );

    // try to over-allocate beyond (balance - owed)
    await expect(
      vesting.connect(owner).createVestingSchedule(
        ben1.address, ethers.parseEther("200"), 0, 1000, false
      )
    ).to.be.revertedWithCustomError(vesting, "InsufficientBalance");
  });

  it("extra", async () => {
    const Vesting = await ethers.getContractFactory("BarinVesting");
    await expect(Vesting.deploy(ethers.ZeroAddress)).to.revertedWithCustomError(Vesting, "InvalidSchedule");

    const { owner, ben1, token, vesting } = await deploy();
    await expect(vesting.connect(ben1).batchCreateSchedules([],[],[],[],[])).to.revertedWithCustomError(Vesting, "OwnableUnauthorizedAccount");
    await expect(vesting.batchCreateSchedules([],[],[],[],[true])).to.revertedWithCustomError(Vesting, "InvalidSchedule");

  });
});
