// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {ReceiveAndSwapUniV2} from "../src/ReceiveAndSwapUniV2.sol";

/// @notice Deploys ReceiveAndSwapUniV2 to the chain of the given --rpc-url.
/// For chains without Uniswap V3 — currently Avalanche Fuji, via Pangolin's
/// router (a genuine Uniswap V2 fork). Verified on-chain 2026-08-06: CCTP
/// TokenMessenger/MessageTransmitter at the standard addresses; Pangolin's
/// router at 0x2D99...B921 confirmed to actually execute a swap (Trader
/// Joe's V1 router has a real pool too, but reverts on every real swap
/// attempt — only its quote function works); Pangolin's WAVAX/USDC pool has
/// real, healthy two-sided liquidity (~496 USDC / ~43.6 WAVAX) — the modern
/// Trader Joe V2.2 LBRouter's pools are empty for Circle's actual USDC.
contract DeployReceiveAndSwapUniV2 is Script {
    address constant TESTNET_MESSAGE_TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;

    struct ChainConfig {
        address usdc;
        address router;
        address wavax;
    }

    function config() internal view returns (ChainConfig memory) {
        if (block.chainid == 43113) {
            // Avalanche Fuji
            return ChainConfig({
                usdc: 0x5425890298aed601595a70AB815c96711a31Bc65,
                router: 0x2D99ABD9008Dc933ff5c0CD271B88309593aB921, // Pangolin router
                wavax: 0xd00ae08403B9bbb9124bB305C09058E32C39A48c
            });
        }
        revert("no config for this chain");
    }

    function run() external virtual {
        ChainConfig memory c = config();
        vm.startBroadcast();
        ReceiveAndSwapUniV2 ras =
            new ReceiveAndSwapUniV2(TESTNET_MESSAGE_TRANSMITTER, c.usdc, c.router, c.wavax);
        vm.stopBroadcast();
        console2.log("ReceiveAndSwapUniV2 deployed on chain", block.chainid, ":", address(ras));
    }
}
