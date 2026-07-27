// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {ReceiveAndSwap} from "../src/ReceiveAndSwap.sol";

/// @notice Deploys ReceiveAndSwap to the chain of the given --rpc-url.
/// CCTP V2 testnet contracts share one address across all EVM testnets.
/// Uniswap addresses verified on-chain per chain (factory() + WETH9() probes):
///  - Arbitrum Sepolia 2026-07-27: router 0x101F..663E, WETH 0x980B..7c73
///  - Base Sepolia     2026-07-27: router 0x94cC..2bc4, WETH 0x4200..0006
contract DeployReceiveAndSwap is Script {
    address constant TESTNET_MESSAGE_TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;

    struct ChainConfig {
        address usdc;
        address swapRouter02;
        address weth9;
    }

    function config() internal view returns (ChainConfig memory) {
        if (block.chainid == 421614) {
            // Arbitrum Sepolia
            return ChainConfig({
                usdc: 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d,
                swapRouter02: 0x101F443B4d1b059569D643917553c771E1b9663E,
                weth9: 0x980B62Da83eFf3D4576C647993b0c1D7faf17c73
            });
        }
        if (block.chainid == 84532) {
            // Base Sepolia
            return ChainConfig({
                usdc: 0x036CbD53842c5426634e7929541eC2318f3dCF7e,
                swapRouter02: 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4,
                weth9: 0x4200000000000000000000000000000000000006
            });
        }
        if (block.chainid == 11155111) {
            // Ethereum Sepolia
            return ChainConfig({
                usdc: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238,
                swapRouter02: 0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E,
                weth9: 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14
            });
        }
        if (block.chainid == 11155420) {
            // OP Sepolia (same Uniswap deployment addresses as Base Sepolia)
            return ChainConfig({
                usdc: 0x5fd84259d66Cd46123540766Be93DFE6D43130D7,
                swapRouter02: 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4,
                weth9: 0x4200000000000000000000000000000000000006
            });
        }
        revert("no config for this chain");
    }

    function run() external virtual {
        ChainConfig memory c = config();
        vm.startBroadcast();
        ReceiveAndSwap ras =
            new ReceiveAndSwap(TESTNET_MESSAGE_TRANSMITTER, c.usdc, c.swapRouter02, c.weth9);
        vm.stopBroadcast();
        console2.log("ReceiveAndSwap deployed on chain", block.chainid, ":", address(ras));
    }
}
