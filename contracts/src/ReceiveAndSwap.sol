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
///   4. The hook must target this contract's own `swapUsdcToNative` or
///      `swapUsdcToToken`; anything else is refunded rather than executed.
///   5. If the hook call fails (e.g. slippage floor hit), the USDC is refunded
///      to the recipient named in the hook calldata — funds never strand.
///
/// @dev Message layout (CCTP V2): 148-byte header, then BurnMessageV2 body in
/// which hookData starts at byte 228 — absolute offset 376. `messageSender`
/// sits at body offset 100 — absolute 248.
///
/// @dev Two earlier weaknesses shaped the current design and are worth stating
/// so they don't get reintroduced:
///
///   * The hook target used to be called as-is. Since anyone can originate a
///     CCTP burn naming this contract as `mintRecipient` with any hookData they
///     like, that was an arbitrary-call primitive rentable for the price of a
///     minimal burn. Targets are now restricted to this contract's two swap
///     entry points.
///   * Amounts used to be derived from `usdc.balanceOf(address(this))` deltas.
///     Because every production hook asks to swap "everything", donating a
///     single µUSDC to this contract made the post-hook subtraction underflow
///     and reverted every relay permanently. All amounts are now tracked
///     explicitly in `_pendingAmount`, so the contract's resting balance can
///     never influence a relay.
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

    /// @dev USDC the currently-executing hook is allowed to spend, decremented
    /// as it spends. Zero outside a relay. This is the contract's entire notion
    /// of "how much is in play" — deliberately never `balanceOf`.
    uint256 private _pendingAmount;

    error NothingMinted();
    error NotOwner();
    error NotSelf();
    error Reentrancy();
    error NativeSendFailed();
    error TransferFailed();

    event HookExecuted(address indexed target, uint256 usdcAmount);
    event HookFailed(address indexed refundTo, uint256 usdcRefunded);
    event HookRejected(address indexed target, address indexed refundTo, uint256 usdcRefunded);
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

        address messageSender =
            address(uint160(uint256(bytes32(message[MESSAGE_SENDER_OFFSET:MESSAGE_SENDER_OFFSET + 32]))));

        if (message.length <= HOOK_DATA_OFFSET) {
            // Mint aimed at this contract with no instructions — return funds.
            // messageSender is the only address available here. It may be a
            // source-chain contract with no counterpart on this chain, so this
            // path is best-effort only; no Conduit flow produces it.
            _safeTransfer(messageSender, minted);
            emit NoHookRefund(messageSender, minted);
            return;
        }

        (address target, bytes memory data, uint256 forwardAmount) =
            abi.decode(message[HOOK_DATA_OFFSET:], (address, bytes, uint256));

        // Refunds go to the recipient named in the hook, never to
        // messageSender: for a SwapAndBurn-originated transfer messageSender is
        // a contract address on the *source* chain, and the same address on
        // this chain is usually nobody at all.
        address refundTo = _hookRecipient(data);
        if (refundTo == address(0)) refundTo = messageSender;

        if (!_isPermittedHook(target, data)) {
            _safeTransfer(refundTo, minted);
            emit HookRejected(target, refundTo, minted);
            return;
        }

        // forwardAmount of 0 means "all"; Fast Transfer fees make the exact
        // minted amount unknowable at burn time, so clamp to what arrived.
        uint256 amount = (forwardAmount == 0 || forwardAmount > minted) ? minted : forwardAmount;

        _pendingAmount = amount;
        (bool ok,) = address(this).call(data);
        // A reverted sub-call rolls back its own decrements, so `unspent` is
        // the full amount in that case — exactly what we want to refund.
        uint256 unspent = _pendingAmount;
        _pendingAmount = 0;

        // Sweep everything the hook didn't consume — both the part of its own
        // budget it left unspent and, for a partial `forwardAmount`, the
        // minted USDC that was never offered to it in the first place.
        uint256 spent = amount - unspent;
        uint256 leftover = minted - spent;
        if (leftover > 0) _safeTransfer(refundTo, leftover);
        if (ok) {
            emit HookExecuted(target, spent);
        } else {
            emit HookFailed(refundTo, leftover);
        }
    }

    /// @notice Hook target: swap USDC for the chain's native token via Uniswap V3
    /// and deliver it to `recipient`.
    /// @param amountIn USDC to swap; 0 means the whole amount this relay put in
    /// play — used by contract-initiated burns (SwapAndBurn) where the minted
    /// amount isn't known at sign time. Always clamped to that amount, so a hook
    /// can never reach the contract's resting balance.
    /// @dev Never reverts on swap failure: slippage refunds USDC straight to
    /// `recipient` (whose address is part of the attested hookData), so refunds
    /// work even when the burn's messageSender is a source-chain contract. If the
    /// recipient can't receive ETH, WETH is delivered instead.
    function swapUsdcToNative(uint256 amountIn, uint24 poolFee, uint256 minOut, address recipient)
        external
        onlySelf
    {
        amountIn = _claim(amountIn);
        _safeApprove(address(swapRouter), amountIn);
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
            _safeApprove(address(swapRouter), 0);
            _safeTransfer(recipient, amountIn);
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
        amountIn = _claim(amountIn);
        _safeApprove(address(swapRouter), amountIn);
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
            _safeApprove(address(swapRouter), 0);
            _safeTransfer(recipient, amountIn);
            emit SwapRefunded(recipient, amountIn);
        }
    }

    /// @notice Recover tokens stranded by a receiveMessage that bypassed
    /// relayAndExecute (e.g. someone relayed directly on the MessageTransmitter).
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        _safeTransferToken(IERC20(token), to, amount);
    }

    function rescueNative(address to, uint256 amount) external onlyOwner {
        (bool sent,) = to.call{value: amount}("");
        if (!sent) revert NativeSendFailed();
    }

    /// @dev Take `amountIn` out of the current relay's budget, clamped to what
    /// is actually in play. `0` means the whole remaining budget.
    function _claim(uint256 amountIn) private returns (uint256) {
        uint256 budget = _pendingAmount;
        if (amountIn == 0 || amountIn > budget) amountIn = budget;
        _pendingAmount = budget - amountIn;
        return amountIn;
    }

    /// @dev A hook is permitted only if it re-enters this contract through one
    /// of the two swap entry points. Both are `onlySelf`, and the owner-only
    /// rescue functions are unreachable this way (msg.sender would be this
    /// contract, not the owner) — but the explicit allowlist means a future
    /// self-callable function can't silently widen the hook surface.
    function _isPermittedHook(address target, bytes memory data) private view returns (bool) {
        if (target != address(this)) return false;
        if (data.length < 4) return false;
        bytes4 selector;
        assembly {
            selector := mload(add(data, 32))
        }
        return selector == this.swapUsdcToNative.selector || selector == this.swapUsdcToToken.selector;
    }

    /// @dev `recipient` is the last argument of both swap entry points, so the
    /// final word of the calldata is the refund address. Returns address(0) if
    /// the calldata isn't shaped like a valid ABI-encoded call.
    function _hookRecipient(bytes memory data) private pure returns (address) {
        if (data.length < 36 || (data.length - 4) % 32 != 0) return address(0);
        bytes32 lastWord;
        assembly {
            lastWord := mload(add(data, mload(data)))
        }
        return address(uint160(uint256(lastWord)));
    }

    function _safeTransfer(address to, uint256 amount) private {
        _safeTransferToken(usdc, to, amount);
    }

    /// @dev Tolerates both reverting and `false`-returning ERC20s, and the
    /// non-standard ones that return nothing at all.
    function _safeTransferToken(IERC20 token, address to, uint256 amount) private {
        (bool ok, bytes memory ret) =
            address(token).call(abi.encodeWithSelector(token.transfer.selector, to, amount));
        if (!ok || (ret.length > 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _safeApprove(address spender, uint256 amount) private {
        (bool ok, bytes memory ret) =
            address(usdc).call(abi.encodeWithSelector(usdc.approve.selector, spender, amount));
        if (!ok || (ret.length > 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    /// @dev Accept ETH from WETH.withdraw.
    receive() external payable {}
}
