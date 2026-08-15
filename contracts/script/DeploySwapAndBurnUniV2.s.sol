// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {SwapAndBurnUniV2} from "../src/SwapAndBurnUniV2.sol";
import {DeployReceiveAndSwapUniV2} from "./DeployReceiveAndSwapUniV2.s.sol";

/// @notice Deploys SwapAndBurnUniV2 to the chain of the given --rpc-url,
/// reusing the per-chain config from DeployReceiveAndSwapUniV2.
contract DeploySwapAndBurnUniV2 is DeployReceiveAndSwapUniV2 {
    address constant TESTNET_TOKEN_MESSENGER = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;

    function run() external override {
        ChainConfig memory c = config();
        vm.startBroadcast();
        SwapAndBurnUniV2 sab = new SwapAndBurnUniV2(TESTNET_TOKEN_MESSENGER, c.usdc, c.router, c.wavax);
        vm.stopBroadcast();
        console2.log("SwapAndBurnUniV2 deployed on chain", block.chainid, ":", address(sab));
    }
}
