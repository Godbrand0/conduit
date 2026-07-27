// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IMessageTransmitterV2} from "./interfaces/IMessageTransmitterV2.sol";
import {ISwapRouter02} from "./interfaces/ISwapRouter02.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @title ReceiveAndSwap — CCTP V2 destination-side hook executor and swap handler
///
/// @notice The destination half of a Conduit native-to-native swap. CCTP V2 carries
/// hookData inside the attested burn message but never executes it — Circle's
/// contracts only mint USDC to `mintRecipient`. This contract closes that gap:
///
///   1. It is set as `mintRecipient` on the source-side burn.
///   2. Anyone (normally the Conduit relayer) calls `relayAndExecute(message,
///      attestation)`. USDC mints to this contract via `receiveMessage`.
///   3. The hook — abi.encode(address target, bytes calldata_, uint256
///      forwardAmount), the cctp-sdk/core wire format — is parsed straight from
///      the attested message, so a relayer cannot substitute its own instructions.
///   4. The target is called with the calldata after approving it for the USDC.
///      For Conduit swaps the target is this same contract's `swapUsdcToNative`
///      or `swapUsdcToToken`.
///   5. If the hook call fails (e.g. slippage floor hit), the minted USDC is
///      refunded to the burn message's `messageSender` — funds never strand.
///
/// @dev Message layout (CCTP V2): 148-byte header, then BurnMessageV2 body in
/// which hookData starts at byte 228 — absolute offset 376. `messageSender`
/// sits at body offset 100 — absolute 248.
contract ReceiveAndSwap {
    IMessageTransmitterV2 public immutable messageTransmitter;
    IERC20 public immutable usdc;
    ISwapRouter02 public immutable swapRouter;
    IWETH9 public immutable weth;
    address public immutable owner;

    uint256 private constant HEADER_LENGTH = 148;
    uint256 private constant HOOK_DATA_OFFSET = HEADER_LENGTH + 228;
    uint256 private constant MESSAGE_SENDER_OFFSET = HEADER_LENGTH + 100;

    uint256 private _lock = 1;

    error NothingMinted();
    error NotOwner();
    error NotSelf();
    error Reentrancy();
    error NativeSendFailed();

    event HookExecuted(address indexed target, uint256 usdcAmount);
    event HookFailed(address indexed refundTo, uint256 usdcRefunded);
    event NoHookRefund(address indexed refundTo, uint256 usdcRefunded);
    event SwapDelivered(address indexed recipient, address indexed tokenOut, uint256 amountOut);
    event SwapRefunded(address indexed recipient, uint256 usdcRefunded);

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev Hook-target functions must only run inside relayAndExecute's self-call,
    /// where the contract transiently holds the minted USDC.
    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    constructor(address messageTransmitter_, address usdc_, address swapRouter_, address weth_) {
        messageTransmitter = IMessageTransmitterV2(messageTransmitter_);
        usdc = IERC20(usdc_);
        swapRouter = ISwapRouter02(swapRouter_);
        weth = IWETH9(weth_);
        owner = msg.sender;
    }

    /// @notice Mint USDC from an attested CCTP V2 message and execute its hook.
    /// Permissionless: the hook comes from the attested message, so callers
    /// cannot redirect funds.
    function relayAndExecute(bytes calldata message, bytes calldata attestation)
        external
        nonReentrant
    {
        uint256 balanceBefore = usdc.balanceOf(address(this));
        messageTransmitter.receiveMessage(message, attestation);
        uint256 minted = usdc.balanceOf(address(this)) - balanceBefore;
        if (minted == 0) revert NothingMinted();

        address refundTo = address(uint160(uint256(bytes32(message[MESSAGE_SENDER_OFFSET:MESSAGE_SENDER_OFFSET + 32]))));

        if (message.length <= HOOK_DATA_OFFSET) {
            // Mint aimed at this contract with no instructions — return funds.
            usdc.transfer(refundTo, minted);
            emit NoHookRefund(refundTo, minted);
            return;
        }

        (address target, bytes memory data, uint256 forwardAmount) =
            abi.decode(message[HOOK_DATA_OFFSET:], (address, bytes, uint256));

        // forwardAmount of 0 means "all"; Fast Transfer fees make the exact
        // minted amount unknowable at burn time, so clamp to what arrived.
        uint256 amount = (forwardAmount == 0 || forwardAmount > minted) ? minted : forwardAmount;

        usdc.approve(target, amount);
        (bool ok,) = target.call(data);
        usdc.approve(target, 0);

        uint256 remaining = usdc.balanceOf(address(this)) - balanceBefore;
        if (ok) {
            emit HookExecuted(target, amount);
            // Sweep any USDC the hook didn't consume (partial forwardAmount).
            if (remaining > 0) usdc.transfer(refundTo, remaining);
        } else {
            usdc.transfer(refundTo, remaining);
            emit HookFailed(refundTo, remaining);
        }
    }

    /// @notice Hook target: swap USDC for the chain's native token via Uniswap V3
    /// and deliver it to `recipient`.
    /// @param amountIn USDC to swap; 0 means the contract's full balance — used by
    /// contract-initiated burns (SwapAndBurn) where the minted amount isn't known
    /// at sign time.
    /// @dev Never reverts on swap failure: slippage refunds USDC straight to
    /// `recipient` (whose address is part of the attested hookData), so refunds
    /// work even when the burn's messageSender is a source-chain contract. If the
    /// recipient can't receive ETH, WETH is delivered instead.
    function swapUsdcToNative(uint256 amountIn, uint24 poolFee, uint256 minOut, address recipient)
        external
        onlySelf
    {
        if (amountIn == 0) amountIn = usdc.balanceOf(address(this));
        usdc.approve(address(swapRouter), amountIn);
        try swapRouter.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(usdc),
                tokenOut: address(weth),
                fee: poolFee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 wethOut) {
            weth.withdraw(wethOut);
            (bool sent,) = recipient.call{value: wethOut}("");
            if (sent) {
                emit SwapDelivered(recipient, address(0), wethOut);
            } else {
                weth.deposit{value: wethOut}();
                weth.transfer(recipient, wethOut);
                emit SwapDelivered(recipient, address(weth), wethOut);
            }
        } catch {
            usdc.approve(address(swapRouter), 0);
            usdc.transfer(recipient, amountIn);
            emit SwapRefunded(recipient, amountIn);
        }
    }

    /// @notice Hook target: swap USDC for an ERC20 via Uniswap V3, delivered
    /// directly to `recipient` by the router. Same 0-means-all and refund
    /// semantics as swapUsdcToNative.
    function swapUsdcToToken(
        uint256 amountIn,
        address tokenOut,
        uint24 poolFee,
        uint256 minOut,
        address recipient
    ) external onlySelf {
        if (amountIn == 0) amountIn = usdc.balanceOf(address(this));
        usdc.approve(address(swapRouter), amountIn);
        try swapRouter.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(usdc),
                tokenOut: tokenOut,
                fee: poolFee,
                recipient: recipient,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 amountOut) {
            emit SwapDelivered(recipient, tokenOut, amountOut);
        } catch {
            usdc.approve(address(swapRouter), 0);
            usdc.transfer(recipient, amountIn);
            emit SwapRefunded(recipient, amountIn);
        }
    }

    /// @notice Recover tokens stranded by a receiveMessage that bypassed
    /// relayAndExecute (e.g. someone relayed directly on the MessageTransmitter).
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).transfer(to, amount);
    }

    function rescueNative(address to, uint256 amount) external onlyOwner {
        (bool sent,) = to.call{value: amount}("");
        if (!sent) revert NativeSendFailed();
    }

    /// @dev Accept ETH from WETH.withdraw.
    receive() external payable {}
}
