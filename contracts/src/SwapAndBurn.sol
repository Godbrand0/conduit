// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITokenMessengerV2} from "./interfaces/ITokenMessengerV2.sol";
import {ISwapRouter02} from "./interfaces/ISwapRouter02.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @title SwapAndBurn — CCTP V2 source-side swap + burn, one transaction
///
/// @notice The source half of a Conduit native-to-native swap. The user sends
/// native ETH (or an ERC20); the contract swaps it to USDC on the local
/// Uniswap V3 and immediately burns the USDC via depositForBurnWithHook,
/// with the hook targeting a ReceiveAndSwap executor on the destination
/// chain. One signature: token in on chain A, native token out on chain B.
///
/// @dev Because this contract is the burn caller, the CCTP message's
/// messageSender is this contract's address — destination-side refunds must
/// therefore come from the hookData (ReceiveAndSwap's swap functions refund
/// to the recipient embedded in the attested calldata), never from
/// messageSender. Pair only with ReceiveAndSwap >= the version that refunds
/// in-swap. The hook's amountIn should be 0 ("swap all minted USDC"), since
/// the USDC output of the source swap is unknown at signing time.
contract SwapAndBurn {
    ITokenMessengerV2 public immutable tokenMessenger;
    IERC20 public immutable usdc;
    ISwapRouter02 public immutable swapRouter;
    IWETH9 public immutable weth;

    error NothingSent();
    error UsdcBelowFee();

    event BurnInitiated(
        address indexed sender,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 usdcBurned,
        uint32 destinationDomain
    );

    constructor(address tokenMessenger_, address usdc_, address swapRouter_, address weth_) {
        tokenMessenger = ITokenMessengerV2(tokenMessenger_);
        usdc = IERC20(usdc_);
        swapRouter = ISwapRouter02(swapRouter_);
        weth = IWETH9(weth_);
    }

    /// @notice Swap native ETH → USDC and burn it to `destinationDomain` with a
    /// hook, atomically. `mintRecipient` and `destinationCaller` must both be
    /// the ReceiveAndSwap executor on the destination chain.
    function swapAndBurnNative(
        uint256 minUsdcOut,
        uint24 poolFee,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external payable returns (uint256 usdcOut) {
        if (msg.value == 0) revert NothingSent();
        weth.deposit{value: msg.value}();
        weth.approve(address(swapRouter), msg.value);
        usdcOut = swapRouter.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(weth),
                tokenOut: address(usdc),
                fee: poolFee,
                recipient: address(this),
                amountIn: msg.value,
                amountOutMinimum: minUsdcOut,
                sqrtPriceLimitX96: 0
            })
        );
        _burn(usdcOut, destinationDomain, mintRecipient, destinationCaller, maxFee, minFinalityThreshold, hookData);
        emit BurnInitiated(msg.sender, address(0), msg.value, usdcOut, destinationDomain);
    }

    /// @notice Swap an ERC20 → USDC and burn, atomically. Caller must approve
    /// this contract for `amountIn` first. Passing USDC itself skips the swap.
    function swapAndBurnToken(
        address tokenIn,
        uint256 amountIn,
        uint256 minUsdcOut,
        uint24 poolFee,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external returns (uint256 usdcOut) {
        if (amountIn == 0) revert NothingSent();
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        if (tokenIn == address(usdc)) {
            usdcOut = amountIn;
        } else {
            IERC20(tokenIn).approve(address(swapRouter), amountIn);
            usdcOut = swapRouter.exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: address(usdc),
                    fee: poolFee,
                    recipient: address(this),
                    amountIn: amountIn,
                    amountOutMinimum: minUsdcOut,
                    sqrtPriceLimitX96: 0
                })
            );
        }
        _burn(usdcOut, destinationDomain, mintRecipient, destinationCaller, maxFee, minFinalityThreshold, hookData);
        emit BurnInitiated(msg.sender, tokenIn, amountIn, usdcOut, destinationDomain);
    }

    function _burn(
        uint256 usdcOut,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) private {
        // A burn where the fast fee eats the whole amount mints nothing useful.
        if (usdcOut <= maxFee) revert UsdcBelowFee();
        usdc.approve(address(tokenMessenger), usdcOut);
        tokenMessenger.depositForBurnWithHook(
            usdcOut,
            destinationDomain,
            mintRecipient,
            address(usdc),
            destinationCaller,
            maxFee,
            minFinalityThreshold,
            hookData
        );
    }
}
