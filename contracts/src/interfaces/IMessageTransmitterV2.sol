// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Circle CCTP V2 MessageTransmitter — verify address per chain at
/// https://developers.circle.com/cctp/contracts
interface IMessageTransmitterV2 {
    function receiveMessage(bytes calldata message, bytes calldata attestation)
        external
        returns (bool success);
}
