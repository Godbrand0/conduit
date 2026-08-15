// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ReceiveAndSwapUniV2} from "../src/ReceiveAndSwapUniV2.sol";

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

/// @dev Fixed-rate USDC → native path router: 1 USDC (1e6) = 0.0004 ETH (4e14
/// wei), sent straight to `to` — the real behavior of swapExactTokensForAVAX.
contract MockV2Router {
    MockUSDC public immutable usdc;
    address public immutable weth;
    uint256 public constant RATE = 4e14; // wei out per 1e6 USDC in

    constructor(MockUSDC usdc_, address weth_) {
        usdc = usdc_;
        weth = weth_;
    }

    receive() external payable {}

    function swapExactTokensForAVAX(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256
    ) external returns (uint256[] memory amounts) {
        require(path[0] == address(usdc) && path[path.length - 1] == weth, "path");
        usdc.transferFrom(msg.sender, address(this), amountIn);
        uint256 amountOut = (amountIn * RATE) / 1e6;
        require(amountOut >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        (bool ok,) = to.call{value: amountOut}("");
        require(ok, "send failed");
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }
}

contract ReceiveAndSwapUniV2Test is Test {
    MockUSDC usdc;
    address constant WETH = address(0xBEE7);
    MockV2Router router;
    MockMessageTransmitter transmitter;
    ReceiveAndSwapUniV2 ras;

    address user = makeAddr("user");
    address sourceSender = makeAddr("sourceSender");
    uint256 constant MINTED = 100e6; // 100 USDC arrives after fees

    function setUp() public {
        usdc = new MockUSDC();
        router = new MockV2Router(usdc, WETH);
        transmitter = new MockMessageTransmitter(usdc);
        ras = new ReceiveAndSwapUniV2(address(transmitter), address(usdc), address(router), WETH);

        vm.deal(address(router), 1000 ether);
        transmitter.setMintAmount(MINTED);
    }

    // ─── helpers ────────────────────────────────────────────────────────────

    function _buildMessage(address mintRecipient, bytes memory hookData) internal view returns (bytes memory) {
        bytes memory header = abi.encodePacked(
            uint32(1), // version
            uint32(6), // sourceDomain (Base)
            uint32(3), // destinationDomain (Arbitrum)
            bytes32(uint256(42)), // nonce
            bytes32(uint256(uint160(sourceSender))), // sender
            bytes32(uint256(uint160(mintRecipient))), // recipient
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

    function _swapToNativeHook(uint256 forwardAmount, uint256 minOut) internal view returns (bytes memory) {
        bytes memory data = abi.encodeCall(
            ReceiveAndSwapUniV2.swapUsdcToNative, (forwardAmount == 0 ? MINTED : forwardAmount, minOut, user)
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

    function test_slippageFailure_refundsUsdcToRecipient() public {
        bytes memory message = _buildMessage(address(ras), _swapToNativeHook(0, type(uint256).max));

        ras.relayAndExecute(message, hex"");

        assertEq(user.balance, 0, "no ETH delivered");
        assertEq(usdc.balanceOf(user), MINTED, "USDC refunded to recipient");
        assertEq(usdc.balanceOf(address(ras)), 0, "no USDC stranded");
    }

    function test_amountInZero_swapsFullMintedBalance() public {
        uint256 expectedEth = (MINTED * router.RATE()) / 1e6;
        bytes memory data = abi.encodeCall(ReceiveAndSwapUniV2.swapUsdcToNative, (0, expectedEth, user));
        bytes memory message = _buildMessage(address(ras), abi.encode(address(ras), data, uint256(0)));

        ras.relayAndExecute(message, hex"");

        assertEq(user.balance, expectedEth, "full minted balance swapped");
        assertEq(usdc.balanceOf(address(ras)), 0, "no USDC left");
    }

    function test_malformedHookTarget_refundsToMessageSender() public {
        bytes memory message = _buildMessage(
            address(ras), abi.encode(address(ras), abi.encodeWithSelector(bytes4(0xdeadbeef)), uint256(0))
        );

        ras.relayAndExecute(message, hex"");

        assertEq(usdc.balanceOf(sourceSender), MINTED, "refunded to messageSender");
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

        vm.expectRevert(ReceiveAndSwapUniV2.NothingMinted.selector);
        ras.relayAndExecute(message, hex"");
    }

    function test_swapFunction_rejectsExternalCallers() public {
        vm.expectRevert(ReceiveAndSwapUniV2.NotSelf.selector);
        ras.swapUsdcToNative(1e6, 0, user);
    }

    function test_rescue_onlyOwner() public {
        usdc.mint(address(ras), 5e6);

        vm.prank(user);
        vm.expectRevert(ReceiveAndSwapUniV2.NotOwner.selector);
        ras.rescueToken(address(usdc), user, 5e6);

        ras.rescueToken(address(usdc), user, 5e6);
        assertEq(usdc.balanceOf(user), 5e6, "owner rescued stranded USDC");
    }
}
