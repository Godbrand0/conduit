// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {ReceiveAndSwap} from "../src/ReceiveAndSwap.sol";

/// @notice Deploys ReceiveAndSwap to Arbitrum Sepolia.
/// All addresses verified on-chain 2026-07-27:
///  - MessageTransmitterV2: version() == 1 (CCTP V2 testnet, same on all EVM testnets)
///  - USDC: Circle-issued Arbitrum Sepolia USDC
///  - SwapRouter02: factory() == 0x248A..188e, WETH9() == 0x980B..7c73
contract DeployReceiveAndSwap is Script {
    address constant MESSAGE_TRANSMITTER = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;
    address constant USDC = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    address constant SWAP_ROUTER_02 = 0x101F443B4d1b059569D643917553c771E1b9663E;
    address constant WETH9 = 0x980B62Da83eFf3D4576C647993b0c1D7faf17c73;

    function run() external {
        vm.startBroadcast();
        ReceiveAndSwap ras =
            new ReceiveAndSwap(MESSAGE_TRANSMITTER, USDC, SWAP_ROUTER_02, WETH9);
        vm.stopBroadcast();
        console2.log("ReceiveAndSwap deployed:", address(ras));
    }
}
