import { Networks } from "@stellar/stellar-sdk";

/**
 * Stellar network selection, in one place.
 *
 * The RPC URL, the network passphrase and the USDC issuer used to be
 * hardcoded testnet literals repeated across four API routes and the
 * relayer. A mainnet deployment would have kept building and submitting
 * testnet transactions with no visible sign that anything was wrong, so this
 * is a correctness guard as much as a configuration one.
 *
 * Set STELLAR_NETWORK=public (plus STELLAR_RPC_URL) for mainnet.
 */
const network = process.env.STELLAR_NETWORK === "public" ? "public" : "testnet";

export const IS_STELLAR_MAINNET = network === "public";

export const STELLAR_NETWORK_PASSPHRASE = IS_STELLAR_MAINNET ? Networks.PUBLIC : Networks.TESTNET;

export const STELLAR_RPC_URL =
  process.env.STELLAR_RPC_URL ??
  (IS_STELLAR_MAINNET ? "https://mainnet.sorobanrpc.com" : "https://soroban-testnet.stellar.org");

/**
 * The classic asset USDC's SAC wraps. Read live via the SAC's own name()
 * during development (see DEPLOYMENTS.md), not guessed from docs.
 */
export const STELLAR_USDC_ISSUER =
  process.env.STELLAR_USDC_ISSUER ??
  (IS_STELLAR_MAINNET
    ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
