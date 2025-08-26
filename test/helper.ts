import { deployments } from "hardhat";
// import { MyContract } from "../typechain-types";

export const getContractAddresses = async () => {
  console.log("BarinToken: ", (await deployments.get("BarinToken")).address);
  const contractDeployment = await deployments.get("BarinToken");
  console.log("BarinToken address:", contractDeployment.address);

  return {BarinToken: contractDeployment.address}
}
