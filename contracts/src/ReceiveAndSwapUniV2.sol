// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IMessageTransmitterV2} from "./interfaces/IMessageTransmitterV2.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @title ReceiveAndSwapUniV2 — CCTP V2 destination-side hook executor, Uniswap-V2-style router
///
/// @notice Identical relayAndExecute/hook-parsing/refund logic to ReceiveAndSwap.sol
/// (see that contract's docs for the full mechanism, including the two
/// weaknesses — the unrestricted hook target and the balanceOf-derived
/// amounts — that its current shape exists to prevent) — only the swap leg
/// differs, targeting a Uniswap V2 fork's path-based router instead of V3's
/// exactInputSingle, for chains without Uniswap V3 deployed. Built for
/// Avalanche Fuji via Pangolin's router (a genuine Uniswap V2 fork), the only V2-style DEX on Fuji confirmed to actually execute a swap.
///
/// @dev Message layout (CCTP V2): 148-byte header, then BurnMessageV2 body in
/// which hookData starts at byte 228 — absolute offset 376. `messageSender`
/// sits at body offset 100 — absolute 248.
contract ReceiveAndSwapUniV2 {
    IMessageTransmitterV2 public immutable messageTransmitter;
    IERC20 public immutable usdc;
    IUniswapV2Router02 public immutable router;
    address public immutable weth;
    address public immutable owner;

    uint256 private constant HEADER_LENGTH = 148;
    uint256 private constant HOOK_DATA_OFFSET = HEADER_LENGTH + 228;
    uint256 private constant MESSAGE_SENDER_OFFSET = HEADER_LENGTH + 100;

    uint256 private _lock = 1;

    /// @dev USDC the currently-executing hook may spend. See ReceiveAndSwap.
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

    constructor(address messageTransmitter_, address usdc_, address router_, address weth_) {
        messageTransmitter = IMessageTransmitterV2(messageTransmitter_);
        usdc = IERC20(usdc_);
        router = IUniswapV2Router02(router_);
        weth = weth_;
        owner = msg.sender;
    }

    /// @notice Mint USDC from an attested CCTP V2 message and execute its hook.
    /// Permissionless: the hook comes from the attested message, so callers
    /// cannot redirect funds.
    function relayAndExecute(bytes calldata message, bytes calldata attestation) external nonReentrant {
        uint256 balanceBefore = usdc.balanceOf(address(this));
        messageTransmitter.receiveMessage(message, attestation);
        uint256 minted = usdc.balanceOf(address(this)) - balanceBefore;
        if (minted == 0) revert NothingMinted();

        address messageSender =
            address(uint160(uint256(bytes32(message[MESSAGE_SENDER_OFFSET:MESSAGE_SENDER_OFFSET + 32]))));

        if (message.length <= HOOK_DATA_OFFSET) {
            _safeTransfer(messageSender, minted);
            emit NoHookRefund(messageSender, minted);
            return;
        }

        (address target, bytes memory data, uint256 forwardAmount) =
            abi.decode(message[HOOK_DATA_OFFSET:], (address, bytes, uint256));

        address refundTo = _hookRecipient(data);
        if (refundTo == address(0)) refundTo = messageSender;

        if (!_isPermittedHook(target, data)) {
            _safeTransfer(refundTo, minted);
            emit HookRejected(target, refundTo, minted);
            return;
        }

        uint256 amount = (forwardAmount == 0 || forwardAmount > minted) ? minted : forwardAmount;

        _pendingAmount = amount;
        (bool ok,) = address(this).call(data);
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

    /// @notice Hook target: swap USDC for the chain's native token via the
    /// Uniswap-V2-style router. The router sends native output straight to
    /// `recipient` — no manual WETH unwrap step needed, unlike the V3 variant.
    /// @dev Never reverts on swap failure: refunds USDC straight to `recipient`
    /// (part of the attested hookData), so refunds work even when the burn's
    /// messageSender is a source-chain contract.
    function swapUsdcToNative(uint256 amountIn, uint256 minOut, address recipient) external onlySelf {
        amountIn = _claim(amountIn);
        _safeApprove(address(router), amountIn);
        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = weth;
        // block.timestamp as the deadline is always satisfied — it exists to
        // fill the router's signature, not to bound execution. `minOut`, which
        // is carried inside the attested message, is the real protection.
        try router.swapExactTokensForAVAX(amountIn, minOut, path, recipient, block.timestamp) returns (
            uint256[] memory amounts
        ) {
            emit SwapDelivered(recipient, address(0), amounts[amounts.length - 1]);
        } catch {
            _safeApprove(address(router), 0);
            _safeTransfer(recipient, amountIn);
            emit SwapRefunded(recipient, amountIn);
        }
    }

    /// @notice Recover tokens stranded by a receiveMessage that bypassed
    /// relayAndExecute.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        _safeTransferToken(IERC20(token), to, amount);
    }

    function rescueNative(address to, uint256 amount) external onlyOwner {
        (bool sent,) = to.call{value: amount}("");
        if (!sent) revert NativeSendFailed();
    }

    function _claim(uint256 amountIn) private returns (uint256) {
        uint256 budget = _pendingAmount;
        if (amountIn == 0 || amountIn > budget) amountIn = budget;
        _pendingAmount = budget - amountIn;
        return amountIn;
    }

    function _isPermittedHook(address target, bytes memory data) private view returns (bool) {
        if (target != address(this)) return false;
        if (data.length < 4) return false;
        bytes4 selector;
        assembly {
            selector := mload(add(data, 32))
        }
        return selector == this.swapUsdcToNative.selector;
    }

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

    /// @dev Accept native token from the router's swapExactTokensForAVAX — not
    /// actually used since the router sends straight to `recipient`, but kept
    /// so a stray direct transfer doesn't revert.
    receive() external payable {}
}
