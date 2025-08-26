import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

    console.log("deployer address: ", deployer);
    const constructorArguments = [];
    console.log("🚀 Deploying BarinToken...", constructorArguments);
    console.log("Constructor Arguments: ", constructorArguments);
    const deployResult = await deploy("BarinToken", {
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
func.tags = ["BarinToken"];
