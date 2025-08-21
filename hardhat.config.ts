import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-deploy";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      { 
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        }
      },
      { 
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        } 
      },
      { version: "0.5.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        } 
      },
    ],
  },
  networks: {}
};

export default config;
