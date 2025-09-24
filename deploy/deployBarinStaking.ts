import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getContractAddresses } from "../test/helper";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const contractAddresses = await getContractAddresses();

    // console.log("deployer address: ", deployer);
    // const constructorArguments = [contractAddresses.BarinToken, contractAddresses.BarinToken, deployer, deployer];
    // console.log("🚀 Deploying BarinStaking...", constructorArguments);
    // console.log("Constructor Arguments: ", constructorArguments);
    // const deployResult = await deploy("BarinStaking", {
    //     from: deployer,
    //     log: true,
    //     proxy: {
    //         owner: deployer,
    //         proxyContract: "OpenZeppelinTransparentProxy",
    //         execute: {
    //             init: {
    //                 methodName: "initialize",
    //                 args: constructorArguments,
    //             },
    //         },
    //     },
    // });

    console.log("🔍 Verifying...");
    await hre.run("verify:verify", {
        address: "0xe709D42853D2cA28b8dE1117B0b458A9765Af4d8",
        constructorArguments: []
    });
};
export default func;
func.tags = ["BarinStaking"];
