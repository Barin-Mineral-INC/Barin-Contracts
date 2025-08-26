import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Barin (ERC20 + ERC20Permit)", function () {
  async function deploy() {
    const [deployer, alice, bob] = await ethers.getSigners();
    const Barin = await ethers.getContractFactory("BarinToken", deployer);
    const token = await Barin.deploy();
    await token.waitForDeployment();
    return { token, deployer, alice, bob };
  }

  it("mints total supply to deployer", async () => {
    const { token, deployer } = await loadFixture(deploy);
    const supply = await token.totalSupply();
    expect(await token.balanceOf(deployer.address)).to.eq(supply);
    expect(await token.name()).to.eq("Barin Mineral Token");
    expect(await token.symbol()).to.eq("BARIN");
    expect(await token.decimals()).to.eq(18);
  });

  it("supports EIP-2612 permit", async () => {
    const { token, deployer, alice, bob } = await loadFixture(deploy);

    // give Alice some tokens
    await token.connect(deployer).transfer(alice.address, ethers.parseEther("5"));

    const value = ethers.parseEther("3");
    const nonce = await token.nonces(alice.address);
    const deadline = (await time.latest()) + 60 * 60 * 24;

    const domain = {
      name: await token.name(),
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await token.getAddress(),
    };

    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const message = {
      owner: alice.address,
      spender: bob.address,
      value,
      nonce,
      deadline,
    };

    const signature = await alice.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(signature);

    await token.connect(bob).permit(alice.address, bob.address, value, deadline, v, r, s);
    expect(await token.allowance(alice.address, bob.address)).to.eq(value);

    // spend 2 from Alice
    await token.connect(bob).transferFrom(alice.address, bob.address, ethers.parseEther("2"));
    expect(await token.balanceOf(bob.address)).to.eq(ethers.parseEther("2"));
    expect(await token.allowance(alice.address, bob.address)).to.eq(ethers.parseEther("1"));
  });
});
