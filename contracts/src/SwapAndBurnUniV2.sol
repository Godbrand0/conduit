// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITokenMessengerV2} from "./interfaces/ITokenMessengerV2.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @title SwapAndBurnUniV2 — CCTP V2 source-side swap + burn via a Uniswap-V2-style router
///
/// @notice Same one-transaction swap+burn pattern as SwapAndBurn.sol, but swaps
/// through a Uniswap V2 fork's path-based router instead of Uniswap V3's
/// exactInputSingle — for chains where V3 isn't deployed. Built for Avalanche
/// Fuji, via Pangolin's router — the only Uniswap-V2-style DEX there confirmed
/// to actually execute a swap (Trader Joe's legacy V1 router has a genuinely
/// liquid pool too, but reverts on every real swap attempt; only its
/// read-only quote function works). Any Uniswap V2 fork with the AVAX-named
/// function set (swapExact*AVAX*For*, not *ETH*) works identically.
///
/// @dev Same messageSender/refund caveat as SwapAndBurn.sol: pair only with a
/// ReceiveAndSwap variant that refunds from the attested hookData, not
/// messageSender.
contract SwapAndBurnUniV2 {
    ITokenMessengerV2 public immutable tokenMessenger;
    IERC20 public immutable usdc;
    IUniswapV2Router02 public immutable router;
    address public immutable weth;
    address public immutable owner;

    /// @notice Conduit protocol fee in basis points, skimmed from the USDC
    /// output of the source swap before burning.
    uint256 public constant FEE_BPS = 5; // 0.05%

    /// @notice USDC accrued as protocol fees and withdrawable by the owner.
    uint256 public accruedFees;

    uint256 private _lock = 1;

    error NothingSent();
    error UsdcBelowFee();
    error NotOwner();
    error Reentrancy();
    error TransferFailed();
    error AmountExceedsAccruedFees();

    event BurnInitiated(
        address indexed sender, uint256 amountIn, uint256 usdcBurned, uint256 conduitFee, uint32 destinationDomain
    );
    event FeesWithdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address tokenMessenger_, address usdc_, address router_, address weth_) {
        tokenMessenger = ITokenMessengerV2(tokenMessenger_);
        usdc = IERC20(usdc_);
        router = IUniswapV2Router02(router_);
        weth = weth_;
        owner = msg.sender;
    }

    /// @notice Swap native token → USDC and burn it to `destinationDomain` with
    /// a hook, atomically. `mintRecipient` and `destinationCaller` must both be
    /// the ReceiveAndSwap executor on the destination chain.
    function swapAndBurnNative(
        uint256 minUsdcOut,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external payable nonReentrant returns (uint256 usdcBurned) {
        if (msg.value == 0) revert NothingSent();
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = address(usdc);
        // block.timestamp as the deadline is always satisfied — it fills the
        // router's signature. `minUsdcOut` is the real protection, and the
        // whole swap+burn is atomic within this one transaction anyway.
        uint256[] memory amounts =
            router.swapExactAVAXForTokens{value: msg.value}(minUsdcOut, path, address(this), block.timestamp);
        uint256 usdcOut = amounts[amounts.length - 1];

        uint256 conduitFee = (usdcOut * FEE_BPS) / 10_000;
        accruedFees += conduitFee;
        usdcBurned = usdcOut - conduitFee;
        _burn(usdcBurned, destinationDomain, mintRecipient, destinationCaller, maxFee, minFinalityThreshold, hookData);
        emit BurnInitiated(msg.sender, msg.value, usdcBurned, conduitFee, destinationDomain);
    }

    /// @notice Withdraw accumulated Conduit fees. Capped at `accruedFees`, so
    /// USDC that is mid-swap or was sent here by mistake is out of reach.
    function withdrawFees(address to, uint256 amount) external onlyOwner {
        if (amount > accruedFees) revert AmountExceedsAccruedFees();
        accruedFees -= amount;
        _safeCall(abi.encodeWithSelector(usdc.transfer.selector, to, amount));
        emit FeesWithdrawn(to, amount);
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
        if (usdcOut <= maxFee) revert UsdcBelowFee();
        _safeCall(abi.encodeWithSelector(usdc.approve.selector, address(tokenMessenger), usdcOut));
        tokenMessenger.depositForBurnWithHook(
            usdcOut, destinationDomain, mintRecipient, address(usdc), destinationCaller, maxFee, minFinalityThreshold, hookData
        );
    }

    /// @dev Tolerates both reverting and `false`-returning ERC20s, and the
    /// non-standard ones that return nothing at all.
    function _safeCall(bytes memory data) private {
        (bool ok, bytes memory ret) = address(usdc).call(data);
        if (!ok || (ret.length > 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
