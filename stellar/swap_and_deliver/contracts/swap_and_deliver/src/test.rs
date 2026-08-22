#![cfg(test)]
//! Mirrors the EVM test suites' shape (mock the external dependencies,
//! build a synthetic attested message, assert the delivery happens
//! correctly). The real cross-chain mechanics (Circle's live CctpForwarder,
//! the real Soroswap pair) are proven end-to-end on testnet — see
//! DEPLOYMENTS.md — this covers swap_and_deliver's own logic in isolation:
//! message parsing, the double-delivery guard, and the transfer-then-swap
//! orchestration, against mocks that match the real contracts' interfaces.

use super::*;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _},
    token, Bytes, BytesN, Env,
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

fn write_u32_be(buf: &mut std::vec::Vec<u8>, at: usize, v: u32) {
    buf[at..at + 4].copy_from_slice(&v.to_be_bytes());
}

fn build_message(
    env: &Env,
    nonce: &BytesN<32>,
    amount: i128,
    circle_recipient: &soroban_sdk::String,
    final_recipient: &soroban_sdk::String,
) -> Bytes {
    let mut circle_buf = [0u8; 56];
    let circle_len = circle_recipient.len() as usize;
    circle_recipient.copy_into_slice(&mut circle_buf[..circle_len]);

    let mut final_buf = [0u8; 56];
    let final_len = final_recipient.len() as usize;
    final_recipient.copy_into_slice(&mut final_buf[..final_len]);

    let mut bytes = std::vec![0u8; HOOK_DATA_OFFSET as usize + 32 + circle_len + 4 + final_len];

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

    Bytes::from_slice(env, &bytes)
}

#[test]
fn test_swap_and_deliver_happy_path() {
    let env = Env::default();
    env.mock_all_auths();

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

    // Fund the contract with USDC the way a real mint_and_forward already
    // would have, in a prior transaction.
    token::StellarAssetClient::new(&env, &usdc).mint(&contract_id, &100_000_000);

    client.init(&mt_id, &usdc, &xlm, &pair_id);

    let recipient = Address::generate(&env);
    let nonce = BytesN::<32>::random(&env);
    mt_client.set_used(&nonce);

    let message = build_message(&env, &nonce, 50_000_000, &contract_id.to_string(), &recipient.to_string());

    let out = client.swap_and_deliver(&message, &1);
    assert!(out > 0, "delivered a positive XLM amount");
    assert!(client.is_delivered(&nonce), "nonce marked delivered");

    let xlm_balance = token::TokenClient::new(&env, &xlm).balance(&recipient);
    assert_eq!(xlm_balance, out, "recipient's XLM balance matches the delivered amount");
}

#[test]
fn test_double_delivery_rejected() {
    let env = Env::default();
    env.mock_all_auths();

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
    token::StellarAssetClient::new(&env, &usdc).mint(&contract_id, &100_000_000);
    client.init(&mt_id, &usdc, &xlm, &pair_id);

    let recipient = Address::generate(&env);
    let nonce = BytesN::<32>::random(&env);
    mt_client.set_used(&nonce);
    let message = build_message(&env, &nonce, 10_000_000, &contract_id.to_string(), &recipient.to_string());

    client.swap_and_deliver(&message, &1);
    let result = client.try_swap_and_deliver(&message, &1);
    assert_eq!(result, Err(Ok(Error::AlreadyDelivered)));
}

#[test]
fn test_not_yet_minted_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(SwapAndDeliver, ());
    let client = SwapAndDeliverClient::new(&env, &contract_id);
    let mt_id = env.register(mock_message_transmitter::MockMessageTransmitter, ());

    let usdc_issuer = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract_v2(usdc_issuer).address();
    let xlm_issuer = Address::generate(&env);
    let xlm = env.register_stellar_asset_contract_v2(xlm_issuer).address();
    let pair_id = env.register(mock_pair::MockPair, ());
    mock_pair::MockPairClient::new(&env, &pair_id).setup(&usdc, &xlm);
    client.init(&mt_id, &usdc, &xlm, &pair_id);

    let recipient = Address::generate(&env);
    let nonce = BytesN::<32>::random(&env);
    // Deliberately never call mt_client.set_used — is_nonce_used stays false.
    let message = build_message(&env, &nonce, 10_000_000, &contract_id.to_string(), &recipient.to_string());

    let result = client.try_swap_and_deliver(&message, &1);
    assert_eq!(result, Err(Ok(Error::NotMinted)));
}
