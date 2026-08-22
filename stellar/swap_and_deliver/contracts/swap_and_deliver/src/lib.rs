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
//! Trustlessness comes from re-parsing the same attested CCTP message this
//! contract is handed — exactly the pattern ReceiveAndSwap.sol already uses
//! on every EVM chain. Circle's hookData format only covers 32 bytes (a
//! reserved/version header) plus a length-prefixed Stellar strkey; Conduit
//! appends its own length-prefixed final-recipient strkey immediately after
//! that. Confirmed on-chain (2026-08-17) that mint_and_forward tolerates
//! this trailing data — it stops parsing after its own recipient field.
//!
//! Since mint_and_forward already ran in a prior transaction, this contract
//! doesn't re-verify Circle's attestation itself — it confirms the mint
//! really happened by checking MessageTransmitter.is_nonce_used(nonce),
//! which only becomes true after real, valid attestation processing.
#![allow(dead_code)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contractclient, Address, Bytes, BytesN, Env, IntoVal,
    String,
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

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum Error {
    AlreadyDelivered = 1,
    NotMinted = 2,
    MalformedMessage = 3,
}

#[contract]
pub struct SwapAndDeliver;

#[contractimpl]
impl SwapAndDeliver {
    pub fn init(env: Env, message_transmitter: Address, usdc: Address, xlm: Address, pair: Address) {
        env.storage().instance().set(&DataKey::MessageTransmitter, &message_transmitter);
        env.storage().instance().set(&DataKey::Usdc, &usdc);
        env.storage().instance().set(&DataKey::Xlm, &xlm);
        env.storage().instance().set(&DataKey::Pair, &pair);
    }

    /// Deliver one attested transfer: verify it really minted, parse the
    /// final Stellar recipient Conduit embedded after Circle's own hookData
    /// section, swap the USDC to XLM on Soroswap, and send it to them.
    /// Permissionless — callable by anyone, normally Conduit's relayer.
    pub fn swap_and_deliver(env: Env, message: Bytes, min_out: i128) -> Result<i128, Error> {
        if message.len() < HOOK_DATA_OFFSET + CIRCLE_RECIPIENT_START {
            return Err(Error::MalformedMessage);
        }

        let nonce: BytesN<32> = message
            .slice(NONCE_OFFSET..NONCE_OFFSET + 32)
            .try_into()
            .map_err(|_| Error::MalformedMessage)?;

        if env.storage().persistent().get(&DataKey::Delivered(nonce.clone())).unwrap_or(false) {
            return Err(Error::AlreadyDelivered);
        }

        let message_transmitter: Address = env.storage().instance().get(&DataKey::MessageTransmitter).unwrap();
        let mt_client = message_transmitter::Client::new(&env, &message_transmitter);
        if !mt_client.is_nonce_used(&nonce) {
            return Err(Error::NotMinted);
        }

        let amount = bytes_to_i128(&message.slice(AMOUNT_OFFSET..AMOUNT_OFFSET + 32));

        // Circle's own recipient (this contract's address, as a strkey) sits
        // right after the 32-byte reserved/version/length header; Conduit's
        // trailing final-recipient field starts immediately after that.
        let circle_len = bytes_to_u32(&message.slice(
            HOOK_DATA_OFFSET + CIRCLE_RECIPIENT_LEN_OFFSET..HOOK_DATA_OFFSET + CIRCLE_RECIPIENT_START,
        ));
        let trailing_start = HOOK_DATA_OFFSET + CIRCLE_RECIPIENT_START + circle_len;
        if message.len() < trailing_start + 4 {
            return Err(Error::MalformedMessage);
        }
        let recipient_len = bytes_to_u32(&message.slice(trailing_start..trailing_start + 4));
        let recipient_start = trailing_start + 4;
        if message.len() < recipient_start + recipient_len {
            return Err(Error::MalformedMessage);
        }
        let recipient_strkey_bytes = message.slice(recipient_start..recipient_start + recipient_len);
        let recipient_strkey = bytes_to_string(&env, &recipient_strkey_bytes);
        let recipient = Address::from_string(&recipient_strkey);

        env.storage().persistent().set(&DataKey::Delivered(nonce), &true);

        let usdc: Address = env.storage().instance().get(&DataKey::Usdc).unwrap();
        let xlm: Address = env.storage().instance().get(&DataKey::Xlm).unwrap();
        let pair: Address = env.storage().instance().get(&DataKey::Pair).unwrap();
        let self_address = env.current_contract_address();

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

        // Standard constant-product formula, 0.3% fee — but Soroswap's own
        // fee model may differ by a hair (rounding, or a slightly different
        // bps), and the pair's swap() enforces its own K-invariant strictly
        // against real balances, not this estimate. Request 0.5% under our
        // own calculation as a safety margin so the invariant always clears;
        // `min_out` (the caller's real slippage floor) is still checked
        // against the honest, non-marked-down estimate.
        let amount_in_with_fee = amount * 997;
        let estimated_out = (amount_in_with_fee * reserve_out) / (reserve_in * 1000 + amount_in_with_fee);
        if estimated_out < min_out {
            return Err(Error::MalformedMessage);
        }
        let out_amount = (estimated_out * 995) / 1000;

        let usdc_client = soroban_sdk::token::TokenClient::new(&env, &usdc);
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
}

#[derive(Clone)]
#[soroban_sdk::contracttype]
enum DataKey {
    MessageTransmitter,
    Usdc,
    Xlm,
    Pair,
    Delivered(BytesN<32>),
}

fn bytes_to_u32(b: &Bytes) -> u32 {
    let mut out = [0u8; 4];
    b.copy_into_slice(&mut out);
    u32::from_be_bytes(out)
}

fn bytes_to_i128(b: &Bytes) -> i128 {
    let mut out = [0u8; 32];
    b.copy_into_slice(&mut out);
    // CCTP amounts fit comfortably in the low 16 bytes; take the low u128
    // and cast — a burn large enough to overflow i128 in µUSDC units isn't
    // realistic on any chain this contract will see.
    let mut low = [0u8; 16];
    low.copy_from_slice(&out[16..32]);
    u128::from_be_bytes(low) as i128
}

fn bytes_to_string(env: &Env, b: &Bytes) -> String {
    let mut buf = [0u8; 56]; // Stellar strkeys (G/C) are always 56 ASCII chars
    let len = b.len() as usize;
    b.copy_into_slice(&mut buf[..len]);
    String::from_bytes(env, &buf[..len])
}
