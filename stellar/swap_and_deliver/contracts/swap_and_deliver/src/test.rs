#![cfg(test)]
//! Mirrors the EVM test suites' shape (mock the external dependencies,
//! build a synthetic attested message, assert the delivery happens
//! correctly). The real cross-chain mechanics (Circle's live CctpForwarder,
//! the real Soroswap pair) are proven end-to-end on testnet — see
//! DEPLOYMENTS.md — this covers swap_and_deliver's own logic in isolation:
//! attestation verification, message parsing, the double-delivery guard,
//! the init guards, and the transfer-then-swap orchestration, against mocks
//! that match the real contracts' interfaces.
//!
//! Messages here are signed with a real secp256k1 key, because the contract
//! now verifies Circle's attestation rather than trusting the bytes it is
//! handed. That is the property most of these tests exist to pin down.

// The crate is #![no_std]; the test tree needs std for Vec/sorting.
extern crate std;

use super::*;
use k256::ecdsa::{RecoveryId, Signature as K256Signature, SigningKey};
use sha3::{Digest, Keccak256};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _},
    token, Bytes, BytesN, Env, Vec,
};

mod mock_message_transmitter {
    use soroban_sdk::{contract, contractimpl, contracttype, BytesN, Env};

    #[contracttype]
    pub enum DataKey {
        Used(BytesN<32>),
    }

    #[contract]
    pub struct MockMessageTransmitter;

    #[contractimpl]
    impl MockMessageTransmitter {
        pub fn set_used(env: Env, nonce: BytesN<32>) {
            env.storage().persistent().set(&DataKey::Used(nonce), &true);
        }
        pub fn is_nonce_used(env: Env, nonce: BytesN<32>) -> bool {
            env.storage().persistent().get(&DataKey::Used(nonce)).unwrap_or(false)
        }
    }
}

/// Matches the real pair's interface exactly (token_0/get_reserves/swap),
/// so it's a faithful stand-in for how swap_and_deliver actually calls it.
/// Fixed 1:2 USDC:XLM rate, ignoring reserve-based pricing — this test is
/// about swap_and_deliver's own orchestration, not AMM math (which is a
/// direct port of the same formula already covered by the EVM/Avalanche
/// frontend tests).
mod mock_pair {
    use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

    #[contracttype]
    pub enum DataKey {
        Usdc,
        Xlm,
    }

    #[contract]
    pub struct MockPair;

    #[contractimpl]
    impl MockPair {
        pub fn setup(env: Env, usdc: Address, xlm: Address) {
            env.storage().instance().set(&DataKey::Usdc, &usdc);
            env.storage().instance().set(&DataKey::Xlm, &xlm);
        }
        pub fn token_0(env: Env) -> Address {
            env.storage().instance().get(&DataKey::Usdc).unwrap()
        }
        pub fn get_reserves(_env: Env) -> (i128, i128) {
            (1_000_000_000, 2_000_000_000)
        }
        pub fn swap(env: Env, _amount_0_out: i128, amount_1_out: i128, to: Address) {
            // Real pair semantics: caller already transferred the input in;
            // this just needs to hand over the requested output.
            let xlm: Address = env.storage().instance().get(&DataKey::Xlm).unwrap();
            token::StellarAssetClient::new(&env, &xlm).mint(&to, &amount_1_out);
        }
    }
}

// ─── attestation helpers ────────────────────────────────────────────────

/// A deterministic test attester. Returns its signing key and the
/// Ethereum-style address the contract will recover from its signatures.
fn attester(seed: u8) -> (SigningKey, [u8; 20]) {
    let key = SigningKey::from_bytes(&[seed; 32].into()).expect("valid key");
    let public = key.verifying_key().to_encoded_point(false);
    let hash = Keccak256::digest(&public.as_bytes()[1..]);
    let mut address = [0u8; 20];
    address.copy_from_slice(&hash[12..32]);
    (key, address)
}

/// Circle's packed r(32) + s(32) + v(1) signature over keccak256(message).
fn sign(key: &SigningKey, message: &[u8]) -> [u8; 65] {
    let digest = Keccak256::digest(message);
    let (signature, recovery): (K256Signature, RecoveryId) =
        key.sign_prehash_recoverable(&digest).expect("signable");
    let mut out = [0u8; 65];
    out[..64].copy_from_slice(&signature.to_bytes());
    out[64] = recovery.to_byte() + 27;
    out
}

/// Sign `message` with every key given, ordered by recovered address so the
/// contract's strictly-increasing check is satisfied.
fn attestation(env: &Env, keys: &[(SigningKey, [u8; 20])], message: &[u8]) -> Bytes {
    let mut signed: std::vec::Vec<([u8; 20], [u8; 65])> =
        keys.iter().map(|(k, a)| (*a, sign(k, message))).collect();
    signed.sort_by_key(|(address, _)| *address);

    let mut packed = std::vec::Vec::new();
    for (_, signature) in signed {
        packed.extend_from_slice(&signature);
    }
    Bytes::from_slice(env, &packed)
}

fn attester_set(env: &Env, keys: &[(SigningKey, [u8; 20])]) -> Vec<BytesN<20>> {
    let mut set = Vec::new(env);
    for (_, address) in keys {
        set.push_back(BytesN::from_array(env, address));
    }
    set
}

// ─── message builder ────────────────────────────────────────────────────

fn write_u32_be(buf: &mut std::vec::Vec<u8>, at: usize, v: u32) {
    buf[at..at + 4].copy_from_slice(&v.to_be_bytes());
}

fn build_message(
    nonce: &BytesN<32>,
    amount: i128,
    circle_recipient: &soroban_sdk::String,
    final_recipient: &soroban_sdk::String,
    min_out: i128,
) -> std::vec::Vec<u8> {
    let mut circle_buf = [0u8; 56];
    let circle_len = circle_recipient.len() as usize;
    circle_recipient.copy_into_slice(&mut circle_buf[..circle_len]);

    let mut final_buf = [0u8; 56];
    let final_len = final_recipient.len() as usize;
    final_recipient.copy_into_slice(&mut final_buf[..final_len]);

    // …+ 16 trailing bytes for Conduit's own minimum-output floor.
    let mut bytes =
        std::vec![0u8; HOOK_DATA_OFFSET as usize + 32 + circle_len + 4 + final_len + 16];

    let mut nonce_bytes = [0u8; 32];
    nonce.copy_into_slice(&mut nonce_bytes);
    bytes[NONCE_OFFSET as usize..NONCE_OFFSET as usize + 32].copy_from_slice(&nonce_bytes);

    let mut amount_full = [0u8; 32];
    amount_full[16..32].copy_from_slice(&(amount as u128).to_be_bytes());
    bytes[AMOUNT_OFFSET as usize..AMOUNT_OFFSET as usize + 32].copy_from_slice(&amount_full);

    let hd = HOOK_DATA_OFFSET as usize;
    write_u32_be(&mut bytes, hd + CIRCLE_RECIPIENT_LEN_OFFSET as usize, circle_len as u32);
    bytes[hd + 32..hd + 32 + circle_len].copy_from_slice(&circle_buf[..circle_len]);

    let trailing = hd + 32 + circle_len;
    write_u32_be(&mut bytes, trailing, final_len as u32);
    bytes[trailing + 4..trailing + 4 + final_len].copy_from_slice(&final_buf[..final_len]);

    let min_out_at = trailing + 4 + final_len;
    bytes[min_out_at..min_out_at + 16].copy_from_slice(&(min_out as u128).to_be_bytes());

    bytes
}

// ─── fixture ────────────────────────────────────────────────────────────

struct Fixture {
    env: Env,
    client: SwapAndDeliverClient<'static>,
    contract_id: Address,
    mt_client: mock_message_transmitter::MockMessageTransmitterClient<'static>,
    xlm: Address,
    keys: std::vec::Vec<(SigningKey, [u8; 20])>,
}

fn setup(fund_usdc: i128) -> Fixture {
    let env = Env::default();
    // The pair's swap() mints the output token two frames below this call,
    // which plain recording auth rejects as "not tied to the root contract
    // invocation" — the same nested-auth constraint that made the real
    // contract bypass Soroswap's router (see the Pair doc in lib.rs).
    env.mock_all_auths_allowing_non_root_auth();

    let contract_id = env.register(SwapAndDeliver, ());
    let client = SwapAndDeliverClient::new(&env, &contract_id);

    let mt_id = env.register(mock_message_transmitter::MockMessageTransmitter, ());
    let mt_client = mock_message_transmitter::MockMessageTransmitterClient::new(&env, &mt_id);

    let usdc_issuer = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract_v2(usdc_issuer).address();
    let xlm_issuer = Address::generate(&env);
    let xlm = env.register_stellar_asset_contract_v2(xlm_issuer).address();

    let pair_id = env.register(mock_pair::MockPair, ());
    mock_pair::MockPairClient::new(&env, &pair_id).setup(&usdc, &xlm);

    if fund_usdc > 0 {
        token::StellarAssetClient::new(&env, &usdc).mint(&contract_id, &fund_usdc);
    }

    let keys = std::vec![attester(1), attester(2)];
    let admin = Address::generate(&env);
    client.init(&admin, &mt_id, &usdc, &xlm, &pair_id, &attester_set(&env, &keys), &2);

    Fixture { env, client, contract_id, mt_client, xlm, keys }
}

// ─── tests ──────────────────────────────────────────────────────────────

#[test]
fn test_swap_and_deliver_happy_path() {
    let f = setup(100_000_000);
    let recipient = Address::generate(&f.env);
    let nonce = BytesN::<32>::random(&f.env);
    f.mt_client.set_used(&nonce);

    let raw = build_message(
        &nonce,
        50_000_000,
        &f.contract_id.to_string(),
        &recipient.to_string(),
        1,
    );
    let message = Bytes::from_slice(&f.env, &raw);
    let att = attestation(&f.env, &f.keys, &raw);

    let out = f.client.swap_and_deliver(&message, &att, &1);
    assert!(out > 0, "delivered a positive XLM amount");
    assert!(f.client.is_delivered(&nonce), "nonce marked delivered");

    let xlm_balance = token::TokenClient::new(&f.env, &f.xlm).balance(&recipient);
    assert_eq!(xlm_balance, out, "recipient's XLM balance matches the delivered amount");
}

#[test]
fn test_double_delivery_rejected() {
    let f = setup(100_000_000);
    let recipient = Address::generate(&f.env);
    let nonce = BytesN::<32>::random(&f.env);
    f.mt_client.set_used(&nonce);

    let raw = build_message(&nonce, 10_000_000, &f.contract_id.to_string(), &recipient.to_string(), 1);
    let message = Bytes::from_slice(&f.env, &raw);
    let att = attestation(&f.env, &f.keys, &raw);

    f.client.swap_and_deliver(&message, &att, &1);
    let result = f.client.try_swap_and_deliver(&message, &att, &1);
    assert_eq!(result, Err(Ok(Error::AlreadyDelivered)));
}

#[test]
fn test_not_yet_minted_rejected() {
    let f = setup(0);
    let recipient = Address::generate(&f.env);
    let nonce = BytesN::<32>::random(&f.env);
    // Deliberately never call set_used — is_nonce_used stays false.

    let raw = build_message(&nonce, 10_000_000, &f.contract_id.to_string(), &recipient.to_string(), 1);
    let message = Bytes::from_slice(&f.env, &raw);
    let att = attestation(&f.env, &f.keys, &raw);

    let result = f.client.try_swap_and_deliver(&message, &att, &1);
    assert_eq!(result, Err(Ok(Error::NotMinted)));
}

/// The headline fix. The contract used to check only that the nonce in the
/// caller-supplied buffer had been consumed, which proved nothing about the
/// amount or recipient in that same buffer: anyone could pair a nonce
/// consumed by an unrelated transfer with a fabricated payload and drain
/// whatever the contract held between the mint and the delivery.
#[test]
fn test_forged_message_with_used_nonce_is_rejected() {
    let f = setup(100_000_000);
    let attacker = Address::generate(&f.env);
    let nonce = BytesN::<32>::random(&f.env);
    // The nonce really has been consumed — by something else entirely.
    f.mt_client.set_used(&nonce);

    // Fabricated payload: the contract's whole balance, paid to the attacker.
    let raw = build_message(
        &nonce,
        100_000_000,
        &f.contract_id.to_string(),
        &attacker.to_string(),
        1,
    );
    let message = Bytes::from_slice(&f.env, &raw);
    // No valid attestation exists for bytes Circle never signed. Signing
    // with a key outside the attester set is the best an attacker can do.
    let forged = std::vec![attester(99), attester(98)];
    let att = attestation(&f.env, &forged, &raw);

    let result = f.client.try_swap_and_deliver(&message, &att, &1);
    assert_eq!(result, Err(Ok(Error::InvalidAttestation)));
    assert_eq!(
        token::TokenClient::new(&f.env, &f.xlm).balance(&attacker),
        0,
        "attacker received nothing"
    );
}

/// An attestation signed by only one of two required attesters must fail,
/// and the same signature repeated must not count twice.
#[test]
fn test_threshold_and_duplicate_signatures_rejected() {
    let f = setup(100_000_000);
    let recipient = Address::generate(&f.env);
    let nonce = BytesN::<32>::random(&f.env);
    f.mt_client.set_used(&nonce);

    let raw = build_message(&nonce, 10_000_000, &f.contract_id.to_string(), &recipient.to_string(), 1);
    let message = Bytes::from_slice(&f.env, &raw);

    // One signature where two are required — wrong length.
    let single = attestation(&f.env, &f.keys[..1], &raw);
    assert_eq!(
        f.client.try_swap_and_deliver(&message, &single, &1),
        Err(Ok(Error::InvalidAttestation))
    );

    // Two signatures, but both from the same attester.
    let doubled = std::vec![attester(1), attester(1)];
    let duplicate = attestation(&f.env, &doubled, &raw);
    assert_eq!(
        f.client.try_swap_and_deliver(&message, &duplicate, &1),
        Err(Ok(Error::InvalidAttestation))
    );
}

/// The floor inside the attested message governs, and a relayer passing a
/// weaker one cannot override it.
#[test]
fn test_attested_min_out_is_enforced_over_caller_value() {
    let f = setup(100_000_000);
    let recipient = Address::generate(&f.env);
    let nonce = BytesN::<32>::random(&f.env);
    f.mt_client.set_used(&nonce);

    // Demand far more XLM than the mock pair can ever return.
    let raw = build_message(
        &nonce,
        10_000_000,
        &f.contract_id.to_string(),
        &recipient.to_string(),
        i128::MAX / 2,
    );
    let message = Bytes::from_slice(&f.env, &raw);
    let att = attestation(&f.env, &f.keys, &raw);

    // The relayer asks for no protection at all; the attested floor wins.
    let result = f.client.try_swap_and_deliver(&message, &att, &0);
    assert_eq!(result, Err(Ok(Error::SlippageExceeded)));
}

/// init used to be callable by anyone, at any time, repointing the
/// transmitter, tokens and pair at attacker-controlled contracts.
#[test]
fn test_init_cannot_be_called_twice() {
    let f = setup(0);
    let other = Address::generate(&f.env);
    let keys = std::vec![attester(7), attester(8)];
    let result = f.client.try_init(
        &other,
        &other,
        &other,
        &other,
        &other,
        &attester_set(&f.env, &keys),
        &2,
    );
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

/// A threshold of zero would accept an empty attestation; a threshold above
/// the attester count could never be met.
#[test]
fn test_invalid_threshold_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SwapAndDeliver, ());
    let client = SwapAndDeliverClient::new(&env, &contract_id);
    let any = Address::generate(&env);
    let keys = std::vec![attester(1), attester(2)];

    assert_eq!(
        client.try_init(&any, &any, &any, &any, &any, &attester_set(&env, &keys), &0),
        Err(Ok(Error::InvalidConfig))
    );
    assert_eq!(
        client.try_init(&any, &any, &any, &any, &any, &attester_set(&env, &keys), &3),
        Err(Ok(Error::InvalidConfig))
    );
}
