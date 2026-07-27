// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Circle CCTP V2 TokenMessenger — verify address per chain at
/// https://developers.circle.com/cctp/contracts
/// @dev V2 depositForBurn* return nothing (the nonce is assigned off-chain,
/// unlike V1).
interface ITokenMessengerV2 {
    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;
}
