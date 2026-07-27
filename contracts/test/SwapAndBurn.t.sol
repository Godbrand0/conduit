// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SwapAndBurn} from "../src/SwapAndBurn.sol";
import {ISwapRouter02} from "../src/interfaces/ISwapRouter02.sol";

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

contract MockWETH {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 wad) external {
        balanceOf[msg.sender] -= wad;
        (bool ok,) = msg.sender.call{value: wad}("");
        require(ok);
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

    receive() external payable {}
}

/// @dev Fixed-rate WETH → USDC router: 1 ETH = 1770 USDC.
contract MockRouter {
    MockUSDC public immutable usdc;
    MockWETH public immutable weth;
    uint256 public constant RATE = 1770e6; // USDC (6d) per 1e18 wei

    constructor(MockUSDC usdc_, MockWETH weth_) {
        usdc = usdc_;
        weth = weth_;
    }

    function exactInputSingle(ISwapRouter02.ExactInputSingleParams calldata p)
        external
        payable
        returns (uint256 amountOut)
    {
        require(p.tokenIn == address(weth) && p.tokenOut == address(usdc), "pair");
        weth.transferFrom(msg.sender, address(this), p.amountIn);
        amountOut = (p.amountIn * RATE) / 1e18;
        require(amountOut >= p.amountOutMinimum, "Too little received");
        usdc.transfer(p.recipient, amountOut);
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

contract SwapAndBurnTest is Test {
    MockUSDC usdc;
    MockWETH weth;
    MockRouter router;
    MockTokenMessenger messenger;
    SwapAndBurn sab;

    address user = makeAddr("user");
    bytes32 constant EXECUTOR = bytes32(uint256(uint160(0xBEEF)));
    bytes constant HOOK_DATA = hex"c0ffee";

    function setUp() public {
        usdc = new MockUSDC();
        weth = new MockWETH();
        router = new MockRouter(usdc, weth);
        messenger = new MockTokenMessenger(usdc);
        sab = new SwapAndBurn(address(messenger), address(usdc), address(router), address(weth));

        usdc.mint(address(router), 1_000_000e6);
        vm.deal(user, 10 ether);
    }

    function test_nativeSwapAndBurn() public {
        uint256 ethIn = 0.01 ether;
        uint256 expectedUsdc = (ethIn * router.RATE()) / 1e18; // 17.7 USDC

        vm.prank(user);
        uint256 usdcOut = sab.swapAndBurnNative{value: ethIn}(
            expectedUsdc, 3000, 3, EXECUTOR, EXECUTOR, 1_300_000, 1000, HOOK_DATA
        );

        assertEq(usdcOut, expectedUsdc, "swap output");
        assertEq(messenger.calls(), 1, "burn called");
        assertEq(messenger.amount(), expectedUsdc, "full USDC burned");
        assertEq(messenger.destinationDomain(), 3);
        assertEq(messenger.mintRecipient(), EXECUTOR, "executor is mintRecipient");
        assertEq(messenger.destinationCaller(), EXECUTOR, "executor is destinationCaller");
        assertEq(messenger.hookData(), HOOK_DATA, "hookData passed through");
        assertEq(usdc.balanceOf(address(sab)), 0, "no USDC left in contract");
        assertEq(weth.balanceOf(address(sab)), 0, "no WETH left in contract");
    }

    function test_slippage_reverts() public {
        vm.prank(user);
        vm.expectRevert("Too little received");
        sab.swapAndBurnNative{value: 0.01 ether}(
            type(uint256).max, 3000, 3, EXECUTOR, EXECUTOR, 1_300_000, 1000, HOOK_DATA
        );
    }

    function test_usdcBelowFee_reverts() public {
        // 0.0001 ETH → 0.177 USDC < 1.3 USDC max fee → refuse to burn
        vm.prank(user);
        vm.expectRevert(SwapAndBurn.UsdcBelowFee.selector);
        sab.swapAndBurnNative{value: 0.0001 ether}(
            0, 3000, 3, EXECUTOR, EXECUTOR, 1_300_000, 1000, HOOK_DATA
        );
    }

    function test_zeroValue_reverts() public {
        vm.prank(user);
        vm.expectRevert(SwapAndBurn.NothingSent.selector);
        sab.swapAndBurnNative{value: 0}(0, 3000, 3, EXECUTOR, EXECUTOR, 0, 1000, HOOK_DATA);
    }

    function test_usdcIn_skipsSwapAndBurnsDirect() public {
        usdc.mint(user, 5e6);
        vm.startPrank(user);
        usdc.approve(address(sab), 5e6);
        uint256 usdcOut = sab.swapAndBurnToken(
            address(usdc), 5e6, 0, 3000, 6, EXECUTOR, EXECUTOR, 1_300_000, 1000, HOOK_DATA
        );
        vm.stopPrank();

        assertEq(usdcOut, 5e6, "amount passes through unswapped");
        assertEq(messenger.amount(), 5e6, "burned directly");
        assertEq(messenger.destinationDomain(), 6);
    }
}
