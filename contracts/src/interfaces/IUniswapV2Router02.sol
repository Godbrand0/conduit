// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal Uniswap V2 router interface — covers the swap functions
/// SwapAndBurnUniV2/ReceiveAndSwapUniV2 need. Uses Avalanche-native naming
/// (AVAX, not ETH): Pangolin's Fuji router — the only Uniswap-V2-style router
/// on Fuji confirmed to actually execute a swap, not just quote one; Trader
/// Joe's legacy V1 router reverts on every real swap attempt despite having
/// its own liquid pool — only implements swapExact*AVAX*For*, not the
/// swapExact*ETH*For* names some other V2 forks use. Same ABI shape either
/// way, just different function selectors.
interface IUniswapV2Router02 {
    function swapExactAVAXForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);

    function swapExactTokensForAVAX(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}
