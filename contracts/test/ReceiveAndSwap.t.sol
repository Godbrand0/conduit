// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ReceiveAndSwap} from "../src/ReceiveAndSwap.sol";
import {ISwapRouter02} from "../src/interfaces/ISwapRouter02.sol";

contract MockUSDC {
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;
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

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 wad) external {
        balanceOf[msg.sender] -= wad;
        (bool ok,) = msg.sender.call{value: wad}("");
        require(ok, "weth: send failed");
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    receive() external payable {}
}

/// @dev Mints the amount configured per test to the burn message's mintRecipient,
/// mimicking MessageTransmitterV2.receiveMessage.
contract MockMessageTransmitter {
    MockUSDC public immutable usdc;
    uint256 public mintAmount;
    bool public consumed;

    constructor(MockUSDC usdc_) {
        usdc = usdc_;
    }

    function setMintAmount(uint256 amount) external {
        mintAmount = amount;
    }

    function receiveMessage(bytes calldata message, bytes calldata) external returns (bool) {
        require(!consumed, "nonce used");
        consumed = true;
        // mintRecipient: burn body offset 36 → absolute 184
        address recipient = address(uint160(uint256(bytes32(message[184:216]))));
        usdc.mint(recipient, mintAmount);
        return true;
    }
}

/// @dev Fixed-rate USDC → WETH/token router. 1 USDC (1e6) = 0.0004 ETH (4e14 wei).
contract MockRouter {
    MockUSDC public immutable usdc;
    MockWETH public immutable weth;
    uint256 public constant RATE = 4e14; // wei out per 1e6 USDC in

    constructor(MockUSDC usdc_, MockWETH weth_) {
        usdc = usdc_;
        weth = weth_;
    }

    function exactInputSingle(ISwapRouter02.ExactInputSingleParams calldata p)
        external
        payable
        returns (uint256 amountOut)
    {
        require(p.tokenIn == address(usdc), "tokenIn");
        usdc.transferFrom(msg.sender, address(this), p.amountIn);
        amountOut = (p.amountIn * RATE) / 1e6;
        require(amountOut >= p.amountOutMinimum, "Too little received");
        weth.transfer(p.recipient, amountOut);
    }
}

contract ReceiveAndSwapTest is Test {
    MockUSDC usdc;
    MockWETH weth;
    MockRouter router;
    MockMessageTransmitter transmitter;
    ReceiveAndSwap ras;

    address user = makeAddr("user");
    address sourceSender = makeAddr("sourceSender");
    uint256 constant MINTED = 100e6; // 100 USDC arrives after fees

    function setUp() public {
        usdc = new MockUSDC();
        weth = new MockWETH();
        router = new MockRouter(usdc, weth);
        transmitter = new MockMessageTransmitter(usdc);
        ras = new ReceiveAndSwap(address(transmitter), address(usdc), address(router), address(weth));

        // Seed router with WETH liquidity (backed by real ETH so withdraw works).
        vm.deal(address(this), 1000 ether);
        weth.deposit{value: 100 ether}();
        weth.transfer(address(router), 100 ether);

        transmitter.setMintAmount(MINTED);
    }

    // ─── helpers ────────────────────────────────────────────────────────────

    function _buildMessage(address mintRecipient, bytes memory hookData)
        internal
        view
        returns (bytes memory)
    {
        bytes memory header = abi.encodePacked(
            uint32(1), // version
            uint32(6), // sourceDomain (Base)
            uint32(3), // destinationDomain (Arbitrum)
            bytes32(uint256(42)), // nonce
            bytes32(uint256(uint160(sourceSender))), // sender (source TokenMessenger in reality)
            bytes32(uint256(uint160(mintRecipient))), // recipient (dest TokenMessenger in reality)
            bytes32(0), // destinationCaller
            uint32(1000), // minFinalityThreshold
            uint32(1000) // finalityThresholdExecuted
        );
        bytes memory body = abi.encodePacked(
            uint32(1), // body version
            bytes32(uint256(uint160(address(usdc)))), // burnToken
            bytes32(uint256(uint160(mintRecipient))), // mintRecipient
            uint256(MINTED), // amount
            bytes32(uint256(uint160(sourceSender))), // messageSender
            uint256(0), // maxFee
            uint256(0), // feeExecuted
            uint256(0), // expirationBlock
            hookData
        );
        return abi.encodePacked(header, body);
    }

    function _swapToNativeHook(uint256 forwardAmount, uint256 minOut)
        internal
        view
        returns (bytes memory)
    {
        bytes memory data = abi.encodeCall(
            ReceiveAndSwap.swapUsdcToNative,
            (forwardAmount == 0 ? MINTED : forwardAmount, uint24(500), minOut, user)
        );
        return abi.encode(address(ras), data, forwardAmount);
    }

    // ─── tests ──────────────────────────────────────────────────────────────

    function test_happyPath_swapToNative() public {
        uint256 expectedEth = (MINTED * router.RATE()) / 1e6; // 0.04 ETH
        bytes memory message = _buildMessage(address(ras), _swapToNativeHook(0, expectedEth));

        ras.relayAndExecute(message, hex"");

        assertEq(user.balance, expectedEth, "user received native ETH");
        assertEq(usdc.balanceOf(address(ras)), 0, "no USDC left in contract");
    }

    function test_slippageFailure_refundsUsdcToSender() public {
        // minOut higher than the router can deliver → swap reverts → refund path
        bytes memory message = _buildMessage(address(ras), _swapToNativeHook(0, type(uint256).max));

        ras.relayAndExecute(message, hex"");

        assertEq(user.balance, 0, "no ETH delivered");
        assertEq(usdc.balanceOf(sourceSender), MINTED, "USDC refunded to source sender");
        assertEq(usdc.balanceOf(address(ras)), 0, "no USDC stranded");
    }

    function test_partialForwardAmount_sweepsRemainder() public {
        uint256 forward = 60e6;
        uint256 expectedEth = (forward * router.RATE()) / 1e6;
        bytes memory message = _buildMessage(address(ras), _swapToNativeHook(forward, expectedEth));

        ras.relayAndExecute(message, hex"");

        assertEq(user.balance, expectedEth, "swapped the forward amount");
        assertEq(usdc.balanceOf(sourceSender), MINTED - forward, "remainder swept to sender");
        assertEq(usdc.balanceOf(address(ras)), 0, "no USDC stranded");
    }

    function test_noHookData_refundsToSender() public {
        bytes memory message = _buildMessage(address(ras), hex"");

        ras.relayAndExecute(message, hex"");

        assertEq(usdc.balanceOf(sourceSender), MINTED, "plain mint refunded");
    }

    function test_nothingMinted_reverts() public {
        transmitter.setMintAmount(0);
        bytes memory message = _buildMessage(address(ras), _swapToNativeHook(0, 0));

        vm.expectRevert(ReceiveAndSwap.NothingMinted.selector);
        ras.relayAndExecute(message, hex"");
    }

    function test_swapFunctions_rejectExternalCallers() public {
        vm.expectRevert(ReceiveAndSwap.NotSelf.selector);
        ras.swapUsdcToNative(1e6, 500, 0, user);

        vm.expectRevert(ReceiveAndSwap.NotSelf.selector);
        ras.swapUsdcToToken(1e6, address(weth), 500, 0, user);
    }

    function test_rescue_onlyOwner() public {
        usdc.mint(address(ras), 5e6);

        vm.prank(user);
        vm.expectRevert(ReceiveAndSwap.NotOwner.selector);
        ras.rescueToken(address(usdc), user, 5e6);

        ras.rescueToken(address(usdc), user, 5e6);
        assertEq(usdc.balanceOf(user), 5e6, "owner rescued stranded USDC");
    }

    function test_swapToToken_deliversErc20() public {
        uint256 expectedWeth = (MINTED * router.RATE()) / 1e6;
        bytes memory data = abi.encodeCall(
            ReceiveAndSwap.swapUsdcToToken, (MINTED, address(weth), uint24(500), expectedWeth, user)
        );
        bytes memory message = _buildMessage(address(ras), abi.encode(address(ras), data, uint256(0)));

        ras.relayAndExecute(message, hex"");

        assertEq(weth.balanceOf(user), expectedWeth, "user received WETH");
    }
}
