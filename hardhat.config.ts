import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "@nomicfoundation/hardhat-verify";
import "hardhat-deploy";
import { config } from "dotenv";
config();

const amoyscan_key = process.env.ETHERSCAN_V2_KEY;
const amoy_url = process.env.AMOY_URL ?? 'https://polygon-amoy-bor-rpc.publicnode.com';
const mnemonic = process.env.MNEMONIC || "test test test test test test test test test test test junk";

const hhConfig: HardhatUserConfig = {
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
    ],
  },
  networks: {
    testnet_amoy: {
      url: amoy_url,
      accounts: { mnemonic },
    }
  },
  namedAccounts: {
    deployer: {
      default: 0, // first account by default
    },
  },
  sourcify: {
    enabled: true
  },
  etherscan: {
    apiKey: {
      testnet_amoy: amoyscan_key,
    },
    customChains: [
      {
        network: "testnet_amoy",
        chainId: 80002,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://polygonscan.com/"
        }
      },
    ]
  },
};

export default hhConfig;
