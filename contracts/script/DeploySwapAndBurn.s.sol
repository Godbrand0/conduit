// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {SwapAndBurn} from "../src/SwapAndBurn.sol";
import {DeployReceiveAndSwap} from "./DeployReceiveAndSwap.s.sol";

/// @notice Deploys SwapAndBurn to the chain of the given --rpc-url, reusing
/// the per-chain Uniswap/USDC config from DeployReceiveAndSwap.
contract DeploySwapAndBurn is DeployReceiveAndSwap {
    address constant TESTNET_TOKEN_MESSENGER = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;

    function run() external override {
        ChainConfig memory c = config();
        vm.startBroadcast();
        SwapAndBurn sab =
            new SwapAndBurn(TESTNET_TOKEN_MESSENGER, c.usdc, c.swapRouter02, c.weth9);
        vm.stopBroadcast();
        console2.log("SwapAndBurn deployed on chain", block.chainid, ":", address(sab));
    }
}
