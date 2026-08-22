# swap_and_deliver — Conduit's Stellar contract

The Stellar half of a Conduit native-to-native swap. See
[`../../DEPLOYMENTS.md`](../../DEPLOYMENTS.md#15) for the full design
writeup and a live, on-chain proof (Arbitrum Sepolia ETH → Stellar XLM,
one signature, fully trustless).

## Why this exists

Circle's `CctpForwarder` on Stellar only mints USDC and forwards it to a
plain address — unlike EVM's `MessageTransmitter` + a hook executor, it
can't also invoke a swap function atomically. `swap_and_deliver` is the
second, still-permissionless step: it re-parses the same attested CCTP
message `mint_and_forward` already processed, extracts the real amount and
final recipient (which Conduit embeds as a trailing section appended after
Circle's own hookData format — confirmed on-chain that `mint_and_forward`
tolerates this), swaps the USDC for XLM on Soroswap, and delivers it. No
signature from the end user beyond the original EVM burn.

## Build

```bash
stellar contract build
```

Wasm output: `target/wasm32v1-none/release/swap_and_deliver.wasm`.

## Tests

`cargo test` currently fails to *compile* — an upstream dependency-version
bug in `soroban-env-host` 22.1.3's own testutils (see the comment in
`../Cargo.toml`), unrelated to this contract's code. The release build
above is unaffected and is what's actually deployed; real correctness is
proven by the live on-chain execution linked above, not a unit test.
`src/test.rs` has real test coverage (happy path, double-delivery guard,
not-yet-minted guard) ready to run once the upstream issue clears.

## Deploy

```bash
stellar contract deploy --wasm target/wasm32v1-none/release/swap_and_deliver.wasm \
  --source <your-identity> --network testnet

stellar contract invoke --id <deployed-id> --source-account <your-identity> --network testnet -- init \
  --message_transmitter CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY \
  --usdc CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA \
  --xlm CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --pair CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS
```

All addresses above are the real, live Stellar Testnet contracts (Circle's
CCTP deployment and Soroswap's USDC/XLM pair), verified on-chain — see
DEPLOYMENTS.md for how each was confirmed before use.
