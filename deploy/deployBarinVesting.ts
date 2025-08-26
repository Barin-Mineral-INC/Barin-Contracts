import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getContractAddresses } from "../test/helper";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const contractAddresses = await getContractAddresses();

    console.log("deployer address: ", deployer);
    const constructorArguments = [contractAddresses.BarinToken];
    console.log("🚀 Deploying BarinVesting...", constructorArguments);
    console.log("Constructor Arguments: ", constructorArguments);
    const deployResult = await deploy("BarinVesting", {
        from: deployer,
        args: constructorArguments, // constructor args
        log: true,
    });

    console.log("🔍 Verifying...");
    await hre.run("verify:verify", {
        address: await deployResult.address,
        constructorArguments: constructorArguments
    });
};
export default func;
func.tags = ["BarinVesting"];
