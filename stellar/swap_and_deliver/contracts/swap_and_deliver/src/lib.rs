#![no_std]
//! swap_and_deliver — the Stellar half of a Conduit native-to-native swap.
//!
//! Circle's CctpForwarder.mint_and_forward only mints USDC and forwards it to
//! a plain address — it has no hook-execution capability like EVM's
//! MessageTransmitter + a hook executor. So the source-side burn (an
//! unmodified SwapAndBurn on any EVM chain, via SwapAndBurnStellar's hookData
//! encoding) points mint_and_forward at *this* contract instead of the end
//! user, and this contract is called as a second, still-permissionless step.
//!
//! Circle's hookData format only covers 32 bytes (a reserved/version header)
//! plus a length-prefixed Stellar strkey; Conduit appends its own
//! length-prefixed final-recipient strkey and a 16-byte minimum-output floor
//! immediately after that. Confirmed on-chain (2026-08-17) that
//! mint_and_forward tolerates this trailing data — it stops parsing after its
//! own recipient field.
//!
//! # Trust model
//!
//! This contract verifies Circle's attestation itself, over the exact message
//! bytes it is handed: threshold ECDSA signatures over keccak256(message),
//! recovered to Ethereum-style attester addresses and checked against the
//! configured attester set. Nothing in the message — amount, recipient,
//! slippage floor — is believed until that check passes.
//!
//! An earlier version instead checked only `MessageTransmitter.is_nonce_used`
//! for the nonce it read out of the caller-supplied buffer. That proved *a*
//! nonce had been consumed, but proved nothing about the rest of the bytes:
//! anyone could pair a nonce consumed by some unrelated transfer with a
//! fabricated amount and recipient and drain whatever the contract held
//! between the mint transaction and the delivery transaction. The nonce check
//! is still performed — it confirms the mint really landed — but it is now a
//! liveness check on top of a real authenticity check, not a substitute for
//! one.
#![allow(dead_code)]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, crypto::Hash, Address, Bytes, BytesN,
    Env, IntoVal, String, Vec,
};

mod message_transmitter {
    use soroban_sdk::{contractclient, BytesN, Env};

    #[contractclient(name = "Client")]
    pub trait MessageTransmitter {
        fn is_nonce_used(env: Env, nonce: BytesN<32>) -> bool;
    }
}

// Soroswap's router internally does a *nested* token.transfer (router calls
// pair calls token, from = our contract) two call-frames removed from us,
// which Soroban's auth model rejects without pre-authorizing that exact
// sub-invocation tree via authorize_as_current_contract. Simplest fix:
// bypass the router and use the pair's own low-level Uniswap-V2-style
// interface directly — transfer input tokens to the pair ourselves (a
// direct, single-hop call, auto-authorized), then call the pair's own
// `swap`, exactly the "optimistic transfer" pattern real Uniswap V2 uses.
// `swap`'s Result<(), SoroswapPairError> isn't imported here (we don't
// depend on the soroswap-pair crate) — invoked dynamically instead so a
// failure just traps the transaction, which is all we need.
#[contractclient(name = "PairClient")]
pub trait Pair {
    fn token_0(env: Env) -> Address;
    fn get_reserves(env: Env) -> (i128, i128);
}

// CCTP V2 message layout (identical to every EVM Conduit contract):
// 148-byte header, then a BurnMessageV2 body. Header: version(4) +
// sourceDomain(4) + destinationDomain(4) + nonce(32) + sender(32) +
// recipient(32) + destinationCaller(32) + minFinalityThreshold(4) +
// finalityThresholdExecuted(4) = 148. Body before hookData: version(4) +
// burnToken(32) + mintRecipient(32) + amount(32) + messageSender(32) +
// maxFee(32) + feeExecuted(32) + expirationBlock(32) = 228, so hookData
// starts at absolute offset 148 + 228 = 376.
const NONCE_OFFSET: u32 = 12;
const AMOUNT_OFFSET: u32 = 216;
const HOOK_DATA_OFFSET: u32 = 376;
// Within hookData: 24 reserved + 4 version + 4 length = 32 bytes before
// Circle's own recipient strkey begins.
const CIRCLE_RECIPIENT_LEN_OFFSET: u32 = 28;
const CIRCLE_RECIPIENT_START: u32 = 32;

/// Each attestation signature is r(32) + s(32) + v(1), the same packed
/// layout Circle's EVM MessageTransmitter consumes.
const SIGNATURE_LENGTH: u32 = 65;
/// Stellar strkeys (G/C) are always exactly 56 ASCII characters. Anything
/// else in the recipient field is a malformed message, not a long address.
const STRKEY_LENGTH: u32 = 56;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum Error {
    AlreadyDelivered = 1,
    NotMinted = 2,
    MalformedMessage = 3,
    AlreadyInitialized = 4,
    NotInitialized = 5,
    InvalidAttestation = 6,
    InsufficientBalance = 7,
    SlippageExceeded = 8,
    InvalidConfig = 9,
}

#[contract]
pub struct SwapAndDeliver;

#[contractimpl]
impl SwapAndDeliver {
    /// One-time setup. Callable exactly once; every later reconfiguration
    /// goes through `set_config`, which the admin must authorize.
    ///
    /// The previous version of this function had no auth check and no
    /// already-initialized guard, so anyone could call it at any time and
    /// repoint the message transmitter, token and pair addresses at
    /// contracts they controlled — a complete takeover for the price of one
    /// transaction. Both guards below exist for that reason.
    pub fn init(
        env: Env,
        admin: Address,
        message_transmitter: Address,
        usdc: Address,
        xlm: Address,
        pair: Address,
        attesters: Vec<BytesN<20>>,
        signature_threshold: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        Self::write_config(&env, message_transmitter, usdc, xlm, pair, attesters, signature_threshold)
    }

    /// Admin-only reconfiguration (attester-set rotation, pair migration).
    pub fn set_config(
        env: Env,
        message_transmitter: Address,
        usdc: Address,
        xlm: Address,
        pair: Address,
        attesters: Vec<BytesN<20>>,
        signature_threshold: u32,
    ) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        Self::write_config(&env, message_transmitter, usdc, xlm, pair, attesters, signature_threshold)
    }

    /// Hand the admin role to a new address (a multisig, ideally). Requires
    /// the current admin's authorization.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    fn write_config(
        env: &Env,
        message_transmitter: Address,
        usdc: Address,
        xlm: Address,
        pair: Address,
        attesters: Vec<BytesN<20>>,
        signature_threshold: u32,
    ) -> Result<(), Error> {
        // A zero threshold would accept an empty attestation, and a
        // threshold above the attester count could never be satisfied.
        if signature_threshold == 0 || signature_threshold > attesters.len() {
            return Err(Error::InvalidConfig);
        }
        env.storage().instance().set(&DataKey::MessageTransmitter, &message_transmitter);
        env.storage().instance().set(&DataKey::Usdc, &usdc);
        env.storage().instance().set(&DataKey::Xlm, &xlm);
        env.storage().instance().set(&DataKey::Pair, &pair);
        env.storage().instance().set(&DataKey::Attesters, &attesters);
        env.storage().instance().set(&DataKey::Threshold, &signature_threshold);
        Ok(())
    }

    /// Deliver one attested transfer: verify Circle's signatures over the
    /// message, confirm it really minted, parse the final Stellar recipient
    /// and slippage floor Conduit embedded after Circle's own hookData
    /// section, swap the USDC to XLM on Soroswap, and send it to them.
    /// Permissionless — callable by anyone, normally Conduit's relayer.
    ///
    /// `min_out` is a floor the *caller* may additionally impose; the
    /// authoritative floor is the one carried inside the attested message,
    /// and the stricter of the two applies. A relayer therefore cannot
    /// weaken the slippage protection the user signed for.
    pub fn swap_and_deliver(
        env: Env,
        message: Bytes,
        attestation: Bytes,
        min_out: i128,
    ) -> Result<i128, Error> {
        if message.len() < HOOK_DATA_OFFSET + CIRCLE_RECIPIENT_START {
            return Err(Error::MalformedMessage);
        }

        // Authenticate the bytes before believing a single field in them.
        Self::verify_attestation(&env, &message, &attestation)?;

        let nonce: BytesN<32> = message
            .slice(NONCE_OFFSET..NONCE_OFFSET + 32)
            .try_into()
            .map_err(|_| Error::MalformedMessage)?;

        if env.storage().persistent().get(&DataKey::Delivered(nonce.clone())).unwrap_or(false) {
            return Err(Error::AlreadyDelivered);
        }

        // The attestation proves the message is genuine; is_nonce_used
        // proves Circle's forwarder has actually run it and the USDC is
        // really here, rather than us front-running our own mint.
        let message_transmitter: Address = env
            .storage()
            .instance()
            .get(&DataKey::MessageTransmitter)
            .ok_or(Error::NotInitialized)?;
        let mt_client = message_transmitter::Client::new(&env, &message_transmitter);
        if !mt_client.is_nonce_used(&nonce) {
            return Err(Error::NotMinted);
        }

        let amount = bytes_to_i128(&message.slice(AMOUNT_OFFSET..AMOUNT_OFFSET + 32))?;
        if amount <= 0 {
            return Err(Error::MalformedMessage);
        }

        // Circle's own recipient (this contract's address, as a strkey) sits
        // right after the 32-byte reserved/version/length header; Conduit's
        // trailing fields start immediately after that.
        let circle_len = bytes_to_u32(&message.slice(
            HOOK_DATA_OFFSET + CIRCLE_RECIPIENT_LEN_OFFSET..HOOK_DATA_OFFSET + CIRCLE_RECIPIENT_START,
        ))?;
        if circle_len != STRKEY_LENGTH {
            return Err(Error::MalformedMessage);
        }
        let trailing_start = HOOK_DATA_OFFSET + CIRCLE_RECIPIENT_START + circle_len;
        if message.len() < trailing_start + 4 {
            return Err(Error::MalformedMessage);
        }
        let recipient_len = bytes_to_u32(&message.slice(trailing_start..trailing_start + 4))?;
        if recipient_len != STRKEY_LENGTH {
            return Err(Error::MalformedMessage);
        }
        let recipient_start = trailing_start + 4;
        // 16 further bytes carry the user's own minimum-output floor, so the
        // slippage tolerance they signed for travels inside the attested
        // message rather than being chosen by whoever relays it.
        let min_out_start = recipient_start + recipient_len;
        if message.len() < min_out_start + 16 {
            return Err(Error::MalformedMessage);
        }
        let recipient_strkey_bytes = message.slice(recipient_start..recipient_start + recipient_len);
        let recipient_strkey = bytes_to_string(&env, &recipient_strkey_bytes)?;
        let recipient = Address::from_string(&recipient_strkey);

        let attested_min_out = bytes_to_i128_16(&message.slice(min_out_start..min_out_start + 16))?;
        // The stricter of the two floors wins: the relayer may ask for more
        // than the user did, never less.
        let effective_min_out = if attested_min_out > min_out { attested_min_out } else { min_out };

        env.storage().persistent().set(&DataKey::Delivered(nonce), &true);

        let usdc: Address = env.storage().instance().get(&DataKey::Usdc).ok_or(Error::NotInitialized)?;
        let xlm: Address = env.storage().instance().get(&DataKey::Xlm).ok_or(Error::NotInitialized)?;
        let pair: Address = env.storage().instance().get(&DataKey::Pair).ok_or(Error::NotInitialized)?;
        let self_address = env.current_contract_address();

        let usdc_client = soroban_sdk::token::TokenClient::new(&env, &usdc);
        if usdc_client.balance(&self_address) < amount {
            return Err(Error::InsufficientBalance);
        }

        // Low-level Uniswap-V2-style pair interaction, bypassing Soroswap's
        // router (see the module doc on Pair for why): transfer the input
        // ourselves (direct, single-hop call — auto-authorized, unlike the
        // router's nested transfer), compute the output via the standard
        // constant-product formula, then call the pair's own `swap` and
        // forward the result ourselves.
        let pair_client = PairClient::new(&env, &pair);
        let usdc_is_token0 = pair_client.token_0() == usdc;
        let (reserve0, reserve1) = pair_client.get_reserves();
        let (reserve_in, reserve_out) = if usdc_is_token0 { (reserve0, reserve1) } else { (reserve1, reserve0) };
        if reserve_in <= 0 || reserve_out <= 0 {
            return Err(Error::MalformedMessage);
        }

        // Standard constant-product formula, 0.3% fee — but Soroswap's own
        // fee model may differ by a hair (rounding, or a slightly different
        // bps), and the pair's swap() enforces its own K-invariant strictly
        // against real balances, not this estimate. Request 0.5% under our
        // own calculation as a safety margin so the invariant always clears.
        let amount_in_with_fee = amount.checked_mul(997).ok_or(Error::MalformedMessage)?;
        let denominator = reserve_in
            .checked_mul(1000)
            .and_then(|v| v.checked_add(amount_in_with_fee))
            .ok_or(Error::MalformedMessage)?;
        let estimated_out = amount_in_with_fee
            .checked_mul(reserve_out)
            .ok_or(Error::MalformedMessage)?
            / denominator;
        let out_amount = estimated_out.checked_mul(995).ok_or(Error::MalformedMessage)? / 1000;

        // Check the floor against what the recipient will ACTUALLY receive,
        // not against the pre-markdown estimate. The 0.5% safety margin is a
        // real cost to the user, so it belongs inside the slippage check
        // rather than being quietly excluded from it.
        if out_amount < effective_min_out {
            return Err(Error::SlippageExceeded);
        }

        usdc_client.transfer(&self_address, &pair, &amount);

        let (amount_0_out, amount_1_out) = if usdc_is_token0 { (0, out_amount) } else { (out_amount, 0) };
        let _: () = env.invoke_contract(
            &pair,
            &soroban_sdk::Symbol::new(&env, "swap"),
            soroban_sdk::vec![&env, amount_0_out.into_val(&env), amount_1_out.into_val(&env), self_address.into_val(&env)],
        );

        let xlm_client = soroban_sdk::token::TokenClient::new(&env, &xlm);
        xlm_client.transfer(&self_address, &recipient, &out_amount);

        Ok(out_amount)
    }

    pub fn is_delivered(env: Env, nonce: BytesN<32>) -> bool {
        env.storage().persistent().get(&DataKey::Delivered(nonce)).unwrap_or(false)
    }

    pub fn admin(env: Env) -> Result<Address, Error> {
        env.storage().instance().get(&DataKey::Admin).ok_or(Error::NotInitialized)
    }

    /// Threshold ECDSA verification over keccak256(message), mirroring what
    /// Circle's own EVM MessageTransmitter does with the same attestation
    /// bytes: recover each signature to an Ethereum-style address, require
    /// every recovered address to be a configured attester, and require the
    /// addresses to be strictly increasing so the same attester cannot be
    /// counted twice.
    fn verify_attestation(env: &Env, message: &Bytes, attestation: &Bytes) -> Result<(), Error> {
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Threshold)
            .ok_or(Error::NotInitialized)?;
        let attesters: Vec<BytesN<20>> = env
            .storage()
            .instance()
            .get(&DataKey::Attesters)
            .ok_or(Error::NotInitialized)?;

        if attestation.len() != threshold * SIGNATURE_LENGTH {
            return Err(Error::InvalidAttestation);
        }

        let digest = env.crypto().keccak256(message);

        let mut previous: Option<BytesN<20>> = None;
        for i in 0..threshold {
            let start = i * SIGNATURE_LENGTH;
            let signature = attestation.slice(start..start + SIGNATURE_LENGTH);
            let recovered = recover_evm_address(env, &digest, &signature)?;

            if let Some(prev) = previous {
                // Strictly increasing — rejects both duplicates and the
                // unordered signature sets Circle never produces.
                if recovered <= prev {
                    return Err(Error::InvalidAttestation);
                }
            }
            if !attesters.contains(&recovered) {
                return Err(Error::InvalidAttestation);
            }
            previous = Some(recovered);
        }

        Ok(())
    }
}

#[derive(Clone)]
#[soroban_sdk::contracttype]
enum DataKey {
    Admin,
    MessageTransmitter,
    Usdc,
    Xlm,
    Pair,
    Attesters,
    Threshold,
    Delivered(BytesN<32>),
}

/// Recover the Ethereum-style address that produced `signature` over
/// `digest`. `signature` is the packed r(32) + s(32) + v(1) layout; `v` is
/// accepted both as a raw recovery id (0/1) and in Ethereum's 27/28 form.
fn recover_evm_address(env: &Env, digest: &Hash<32>, signature: &Bytes) -> Result<BytesN<20>, Error> {
    let rs: BytesN<64> = signature
        .slice(0..64)
        .try_into()
        .map_err(|_| Error::InvalidAttestation)?;
    let v = signature.get(64).ok_or(Error::InvalidAttestation)?;
    let recovery_id: u32 = if v >= 27 { (v - 27) as u32 } else { v as u32 };
    if recovery_id > 1 {
        return Err(Error::InvalidAttestation);
    }

    // 65 bytes: 0x04 prefix + 64-byte uncompressed public key. The address
    // is the low 20 bytes of the keccak hash of the key without its prefix.
    let public_key = env.crypto().secp256k1_recover(digest, &rs, recovery_id).to_array();
    let key_body = Bytes::from_slice(env, &public_key[1..]);
    let hashed = env.crypto().keccak256(&key_body).to_bytes().to_array();
    let mut address = [0u8; 20];
    address.copy_from_slice(&hashed[12..32]);
    Ok(BytesN::from_array(env, &address))
}

fn bytes_to_u32(b: &Bytes) -> Result<u32, Error> {
    if b.len() != 4 {
        return Err(Error::MalformedMessage);
    }
    let mut out = [0u8; 4];
    b.copy_into_slice(&mut out);
    Ok(u32::from_be_bytes(out))
}

/// Read a 32-byte big-endian CCTP amount field. The previous version took
/// the low 16 bytes and cast `u128 as i128` unconditionally, which silently
/// truncated anything larger and could produce a *negative* amount from a
/// value with its high bit set. Both cases are now rejected outright.
fn bytes_to_i128(b: &Bytes) -> Result<i128, Error> {
    if b.len() != 32 {
        return Err(Error::MalformedMessage);
    }
    let mut out = [0u8; 32];
    b.copy_into_slice(&mut out);
    // Anything set in the high 16 bytes cannot fit an i128 at all.
    for byte in out[0..16].iter() {
        if *byte != 0 {
            return Err(Error::MalformedMessage);
        }
    }
    let mut low = [0u8; 16];
    low.copy_from_slice(&out[16..32]);
    i128::try_from(u128::from_be_bytes(low)).map_err(|_| Error::MalformedMessage)
}

/// Read Conduit's own 16-byte big-endian minimum-output field.
fn bytes_to_i128_16(b: &Bytes) -> Result<i128, Error> {
    if b.len() != 16 {
        return Err(Error::MalformedMessage);
    }
    let mut out = [0u8; 16];
    b.copy_into_slice(&mut out);
    i128::try_from(u128::from_be_bytes(out)).map_err(|_| Error::MalformedMessage)
}

/// Stellar strkeys (G/C) are always 56 ASCII chars. The previous version
/// copied into a fixed 56-byte buffer using a length validated only against
/// the message size, so a longer field panicked out of bounds.
fn bytes_to_string(env: &Env, b: &Bytes) -> Result<String, Error> {
    if b.len() != STRKEY_LENGTH {
        return Err(Error::MalformedMessage);
    }
    let mut buf = [0u8; STRKEY_LENGTH as usize];
    b.copy_into_slice(&mut buf);
    Ok(String::from_bytes(env, &buf))
}

#[cfg(test)]
mod test;
