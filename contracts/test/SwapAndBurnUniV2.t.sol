// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SwapAndBurnUniV2} from "../src/SwapAndBurnUniV2.sol";

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

/// @dev Fixed-rate ETH → USDC path router: 1 ETH = 1770 USDC. Mirrors real
/// Uniswap-V2-style routers: pulls ETH via msg.value, sends output tokens
/// straight to `to`.
contract MockV2Router {
    MockUSDC public immutable usdc;
    address public immutable weth;
    uint256 public constant RATE = 1770e6; // USDC (6d) per 1e18 wei

    constructor(MockUSDC usdc_, address weth_) {
        usdc = usdc_;
        weth = weth_;
    }

    function swapExactAVAXForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256)
        external
        payable
        returns (uint256[] memory amounts)
    {
        require(path[0] == weth && path[path.length - 1] == address(usdc), "path");
        uint256 amountOut = (msg.value * RATE) / 1e18;
        require(amountOut >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        usdc.mint(to, amountOut);
        amounts = new uint256[](2);
        amounts[0] = msg.value;
        amounts[1] = amountOut;
    }
}

/// @dev Records depositForBurnWithHook args and pulls the USDC like the real
/// TokenMessenger.
contract MockTokenMessenger {
    MockUSDC public immutable usdc;

    uint256 public amount;
    uint32 public destinationDomain;
    bytes32 public mintRecipient;
    bytes32 public destinationCaller;
    uint256 public maxFee;
    uint32 public minFinalityThreshold;
    bytes public hookData;
    uint256 public calls;

    constructor(MockUSDC usdc_) {
        usdc = usdc_;
    }

    function depositForBurnWithHook(
        uint256 amount_,
        uint32 destinationDomain_,
        bytes32 mintRecipient_,
        address burnToken,
        bytes32 destinationCaller_,
        uint256 maxFee_,
        uint32 minFinalityThreshold_,
        bytes calldata hookData_
    ) external {
        require(burnToken == address(usdc), "burnToken");
        usdc.transferFrom(msg.sender, address(this), amount_);
        amount = amount_;
        destinationDomain = destinationDomain_;
        mintRecipient = mintRecipient_;
        destinationCaller = destinationCaller_;
        maxFee = maxFee_;
        minFinalityThreshold = minFinalityThreshold_;
        hookData = hookData_;
        calls++;
    }
}

contract SwapAndBurnUniV2Test is Test {
    MockUSDC usdc;
    address constant WETH = address(0xBEE7);
    MockV2Router router;
    MockTokenMessenger messenger;
    SwapAndBurnUniV2 sab;

    address user = makeAddr("user");
    bytes32 constant EXECUTOR = bytes32(uint256(uint160(0xBEEF)));
    bytes constant HOOK_DATA = hex"c0ffee";

    function setUp() public {
        usdc = new MockUSDC();
        router = new MockV2Router(usdc, WETH);
        messenger = new MockTokenMessenger(usdc);
        sab = new SwapAndBurnUniV2(address(messenger), address(usdc), address(router), WETH);

        vm.deal(user, 10 ether);
    }

    function test_nativeSwapAndBurn() public {
        uint256 ethIn = 0.01 ether;
        uint256 expectedUsdc = (ethIn * router.RATE()) / 1e18;
        uint256 expectedFee = (expectedUsdc * sab.FEE_BPS()) / 10_000;
        uint256 expectedBurn = expectedUsdc - expectedFee;

        vm.prank(user);
        uint256 usdcBurned =
            sab.swapAndBurnNative{value: ethIn}(expectedUsdc, 3, EXECUTOR, EXECUTOR, 1_300_000, 1000, HOOK_DATA);

        assertEq(usdcBurned, expectedBurn, "burn amount is post-fee");
        assertEq(messenger.calls(), 1, "burn called");
        assertEq(messenger.amount(), expectedBurn, "post-fee USDC burned");
        assertEq(messenger.destinationDomain(), 3);
        assertEq(messenger.mintRecipient(), EXECUTOR, "executor is mintRecipient");
        assertEq(messenger.destinationCaller(), EXECUTOR, "executor is destinationCaller");
        assertEq(messenger.hookData(), HOOK_DATA, "hookData passed through");
        assertEq(usdc.balanceOf(address(sab)), expectedFee, "fee retained as treasury");
    }

    function test_feeAccumulatesAndWithdraws() public {
        vm.startPrank(user);
        sab.swapAndBurnNative{value: 0.01 ether}(0, 3, EXECUTOR, EXECUTOR, 1_300_000, 1000, HOOK_DATA);
        sab.swapAndBurnNative{value: 0.01 ether}(0, 3, EXECUTOR, EXECUTOR, 1_300_000, 1000, HOOK_DATA);
        vm.stopPrank();

        uint256 perSwapFee = ((0.01 ether * router.RATE()) / 1e18) * sab.FEE_BPS() / 10_000;
        uint256 treasury = usdc.balanceOf(address(sab));
        assertEq(treasury, perSwapFee * 2, "fees accumulate across swaps");

        vm.prank(user);
        vm.expectRevert(SwapAndBurnUniV2.NotOwner.selector);
        sab.withdrawFees(user, treasury);

        sab.withdrawFees(address(0xFEE), treasury);
        assertEq(usdc.balanceOf(address(0xFEE)), treasury, "owner withdrew fees");
        assertEq(usdc.balanceOf(address(sab)), 0);
    }

    function test_slippage_reverts() public {
        vm.prank(user);
        vm.expectRevert("INSUFFICIENT_OUTPUT_AMOUNT");
        sab.swapAndBurnNative{value: 0.01 ether}(type(uint256).max, 3, EXECUTOR, EXECUTOR, 1_300_000, 1000, HOOK_DATA);
    }

    function test_usdcBelowFee_reverts() public {
        // 0.0001 ETH → 0.177 USDC < 1.3 USDC max fee → refuse to burn
        vm.prank(user);
        vm.expectRevert(SwapAndBurnUniV2.UsdcBelowFee.selector);
        sab.swapAndBurnNative{value: 0.0001 ether}(0, 3, EXECUTOR, EXECUTOR, 1_300_000, 1000, HOOK_DATA);
    }

    function test_zeroValue_reverts() public {
        vm.prank(user);
        vm.expectRevert(SwapAndBurnUniV2.NothingSent.selector);
        sab.swapAndBurnNative{value: 0}(0, 3, EXECUTOR, EXECUTOR, 0, 1000, HOOK_DATA);
    }
}
