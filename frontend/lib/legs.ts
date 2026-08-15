import type { Chain } from "viem";
import { baseSepolia, arbitrumSepolia, sepolia, optimismSepolia, unichainSepolia, avalancheFuji } from "viem/chains";
import { arcTestnet } from "./arcChain";

/**
 * Per-chain Conduit deployment config. All addresses are public testnet
 * deployments, recorded with proofs in ../DEPLOYMENTS.md.
 *
 * Every field below is required EXCEPT for chains where `nativeIsUsdc` is
 * true (currently only Arc): its native gas token IS USDC, so there's no
 * swap step on either side of a transfer — no SwapAndBurn/ReceiveAndSwap
 * contract, no Uniswap pool, nothing to quote. Instead it uses the plain
 * CCTP TokenMessenger/MessageTransmitter directly, via the fields under
 * "Arc-only fields" below.
 */
export type Leg = {
  key: string;
  label: string;
  /** Short display name for compact UI */
  short: string;
  /** Brand color for the chain icon */
  color: string;
  chain: Chain;
  domain: number;
  explorer: string;
  /** Server-side RPC (public); the wallet uses its own for writes */
  rpc: string;
  /** True when this chain's native gas token IS USDC (only Arc, so far).
   *  No swap on either side; the swap/pool fields below are omitted. */
  nativeIsUsdc?: boolean;
  /** "v2" when the swap/burn contracts are the Uniswap-V2-style variant
   *  (SwapAndBurnUniV2/ReceiveAndSwapUniV2 — currently only Avalanche,
   *  where Uniswap V3 isn't deployed). Changes: quote math (constant-product
   *  reserves instead of sqrtPriceX96), ABI shape (no poolFee param), and
   *  `pool` means the LP pair address rather than a V3 pool. Omitted/"v3"
   *  for every other standard chain. */
  dex?: "v2";

  // ── Standard-chain fields (omitted when nativeIsUsdc) ──────────────────
  /** ReceiveAndSwap v2 hook executor (destination side) */
  executor?: `0x${string}`;
  /** SwapAndBurn fee-enabled (source side) */
  swapAndBurn?: `0x${string}`;
  /** USDC/WETH fee tier with verified liquidity (V3 chains only) */
  poolFee?: number;
  /** The USDC/WETH pool for spot-price quotes — a Uniswap V3 pool normally,
   *  or the LP pair address when dex is "v2" */
  pool?: `0x${string}`;
  /** Whether USDC is token0 in that pool (address ordering) */
  token0IsUsdc?: boolean;

  // ── Arc-only fields (raw CCTP, no Conduit contracts deployed there) ────
  /** Standard CCTP TokenMessenger — burns are signed directly by the user's
   *  EOA when Arc is the source (there's no ETH to swap, so no SwapAndBurn
   *  wrapper exists). */
  tokenMessenger?: `0x${string}`;
  /** Standard CCTP MessageTransmitter — the relayer calls receiveMessage
   *  directly when Arc is the destination (nothing to swap into, so no
   *  ReceiveAndSwap executor exists). */
  messageTransmitter?: `0x${string}`;
  /** The ERC20-view precompile CCTP burns/mints through on Arc. */
  usdc?: `0x${string}`;
};

export const LEGS: Record<string, Leg> = {
  base: {
    key: "base",
    label: "Base Sepolia",
    short: "Base",
    color: "#0052FF",
    chain: baseSepolia,
    domain: 6,
    executor: "0x86986974E1B45Dd370AD90Fe8747e86C355b0866",
    swapAndBurn: "0xc3Deb7F7Ad5075618e1055EC2aaf27659740F022",
    poolFee: 3000,
    pool: "0x46880b404CD35c165EDdefF7421019F8dD25F4Ad",
    token0IsUsdc: true,
    explorer: "https://sepolia.basescan.org",
    rpc: "https://base-sepolia-rpc.publicnode.com",
  },
  arbitrum: {
    key: "arbitrum",
    label: "Arbitrum Sepolia",
    short: "Arbitrum",
    color: "#28A0F0",
    chain: arbitrumSepolia,
    domain: 3,
    executor: "0x9B6aaDaEeD2cAF2B3b26C62aA5dEaCcB8052F40B",
    swapAndBurn: "0xcEE2b537Ee71c0B4399761537357c1c2B5A5F6Ec",
    poolFee: 3000,
    pool: "0x66EEAB70aC52459Dd74C6AD50D578Ef76a441bbf",
    token0IsUsdc: true,
    explorer: "https://sepolia.arbiscan.io",
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
  },
  ethereum: {
    key: "ethereum",
    label: "Ethereum Sepolia",
    short: "Ethereum",
    color: "#627EEA",
    chain: sepolia,
    domain: 0,
    executor: "0x226EC562076549FdD16ecaaF437CD77E49D102c5",
    swapAndBurn: "0x9A732afcA3Fbc0FB9a0dDF677dC1c35549499766",
    poolFee: 500,
    pool: "0x3289680dD4d6C10bb19b899729cda5eEF58AEfF1",
    token0IsUsdc: true,
    explorer: "https://sepolia.etherscan.io",
    rpc: "https://ethereum-sepolia-rpc.publicnode.com",
  },
  optimism: {
    key: "optimism",
    label: "OP Sepolia",
    short: "OP",
    color: "#FF0420",
    chain: optimismSepolia,
    domain: 2,
    executor: "0xAead88469c8DBdA0efd12c6993eDCb2F171D8203",
    swapAndBurn: "0x84B1634Ec67d309AEB9DC422F001350e467DCBc8",
    poolFee: 500,
    pool: "0xEB18BA6D2d8408A87EE5Ac4264C8dbb73ad538eb",
    token0IsUsdc: false, // WETH (0x4200…) sorts below USDC (0x5fd8…) on OP Sepolia
    explorer: "https://sepolia-optimism.etherscan.io",
    rpc: "https://sepolia.optimism.io",
  },
  unichain: {
    key: "unichain",
    label: "Unichain Sepolia",
    short: "Unichain",
    color: "#FF007A",
    chain: unichainSepolia,
    domain: 10,
    executor: "0x60D6EDA1573f13268f5a925CB8ECabe00ABB2C6f",
    swapAndBurn: "0xcc5b18B89C7709EeB840c2cA4875c39e17d57c21",
    poolFee: 3000,
    pool: "0x8F463126bBEA80A10DF9Bf6FF5455B6B0292B34e",
    token0IsUsdc: true,
    explorer: "https://sepolia.uniscan.xyz",
    rpc: "https://sepolia.unichain.org",
  },
  avalanche: {
    key: "avalanche",
    label: "Avalanche Fuji",
    short: "Avalanche",
    color: "#E84142",
    chain: avalancheFuji,
    domain: 1,
    dex: "v2",
    executor: "0x064B35CA8f0886A10eD7C43E29D558E66b0dea36",
    swapAndBurn: "0x9AcD57857367494eb6CB02Bd2241Cc78FdCdDe8b",
    pool: "0x8Aa1D713454bD21D10c9d25d717C59Ad75406888", // Pangolin WAVAX/USDC pair
    token0IsUsdc: true,
    explorer: "https://testnet.snowtrace.io",
    rpc: "https://api.avax-test.network/ext/bc/C/rpc",
  },
  arc: {
    key: "arc",
    label: "Arc Testnet",
    short: "Arc",
    color: "#00C7B7",
    chain: arcTestnet,
    domain: 26,
    nativeIsUsdc: true,
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    usdc: "0x3600000000000000000000000000000000000000",
    explorer: "https://testnet.arcscan.app",
    rpc: "https://rpc.testnet.arc.network",
  },
};

export const LEG_KEYS = Object.keys(LEGS);

export const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;

export const SWAP_AND_BURN_ABI = [
  {
    type: "function",
    name: "swapAndBurnNative",
    stateMutability: "payable",
    inputs: [
      { name: "minUsdcOut", type: "uint256" },
      { name: "poolFee", type: "uint24" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "usdcBurned", type: "uint256" }],
  },
  { type: "error", name: "NothingSent", inputs: [] },
  { type: "error", name: "UsdcBelowFee", inputs: [] },
  { type: "error", name: "NotOwner", inputs: [] },
] as const;

export const POOL_SLOT0_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
] as const;

/** Spot-quote ETH (wei) → USDC (µ) from a pool's sqrtPriceX96. Estimate only —
 * ignores swap fee and price impact. */
export function quoteEthToUsdc(ethWei: bigint, sqrtPriceX96: bigint, token0IsUsdc: boolean): bigint {
  const Q192 = 1n << 192n;
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  // token0IsUsdc: price (token1/token0) = wei per µUSDC → usdc = wei * Q192 / priceX192
  // else:         price = µUSDC per wei              → usdc = wei * priceX192 / Q192
  return token0IsUsdc ? (ethWei * Q192) / priceX192 : (ethWei * priceX192) / Q192;
}

/** Spot-quote USDC (µ) → ETH (wei) — the inverse, for the receive estimate. */
export function quoteUsdcToEth(usdcMicro: bigint, sqrtPriceX96: bigint, token0IsUsdc: boolean): bigint {
  const Q192 = 1n << 192n;
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  return token0IsUsdc ? (usdcMicro * priceX192) / Q192 : (usdcMicro * Q192) / priceX192;
}

export const PAIR_RESERVES_ABI = [
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
] as const;

/** Spot-quote ETH (wei) → USDC (µ) from a Uniswap-V2-style pair's reserves,
 * including the standard 0.3% LP fee (matches Pangolin/Trader Joe V1). */
export function quoteEthToUsdcV2(
  ethWei: bigint,
  reserve0: bigint,
  reserve1: bigint,
  token0IsUsdc: boolean
): bigint {
  const [reserveUsdc, reserveEth] = token0IsUsdc ? [reserve0, reserve1] : [reserve1, reserve0];
  const ethInWithFee = ethWei * 997n;
  return (reserveUsdc * ethInWithFee) / (reserveEth * 1000n + ethInWithFee);
}

/** Spot-quote USDC (µ) → ETH (wei) — the inverse, for the receive estimate. */
export function quoteUsdcToEthV2(
  usdcMicro: bigint,
  reserve0: bigint,
  reserve1: bigint,
  token0IsUsdc: boolean
): bigint {
  const [reserveUsdc, reserveEth] = token0IsUsdc ? [reserve0, reserve1] : [reserve1, reserve0];
  const usdcInWithFee = usdcMicro * 997n;
  return (reserveEth * usdcInWithFee) / (reserveUsdc * 1000n + usdcInWithFee);
}

/** SwapAndBurnUniV2's ABI — same shape as SWAP_AND_BURN_ABI but no poolFee
 * param, since Uniswap-V2-style routers have no fee tiers. */
export const SWAP_AND_BURN_V2_ABI = [
  {
    type: "function",
    name: "swapAndBurnNative",
    stateMutability: "payable",
    inputs: [
      { name: "minUsdcOut", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "usdcBurned", type: "uint256" }],
  },
  { type: "error", name: "NothingSent", inputs: [] },
  { type: "error", name: "UsdcBelowFee", inputs: [] },
  { type: "error", name: "NotOwner", inputs: [] },
] as const;

/** ReceiveAndSwapUniV2's hook-target ABI — no poolFee param. */
export const SWAP_USDC_TO_NATIVE_V2_ABI = [
  {
    type: "function",
    name: "swapUsdcToNative",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "minOut", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
] as const;

export const SWAP_USDC_TO_NATIVE_ABI = [
  {
    type: "function",
    name: "swapUsdcToNative",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "poolFee", type: "uint24" },
      { name: "minOut", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
] as const;
