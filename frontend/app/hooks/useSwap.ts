"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useBalance,
  usePublicClient,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { BaseError, concatHex, encodeFunctionData, numberToHex, padHex, parseEther, parseUnits, stringToHex, toHex } from "viem";
import { encodeHook, TOKEN_MESSENGER_ABI, USDC_ABI } from "@cctp-sdk/core";
import { StrKey } from "@stellar/stellar-sdk";
import {
  LEGS,
  type Leg,
  POOL_SLOT0_ABI,
  PAIR_RESERVES_ABI,
  SWAP_AND_BURN_ABI,
  SWAP_AND_BURN_V2_ABI,
  SWAP_USDC_TO_NATIVE_ABI,
  SWAP_USDC_TO_NATIVE_V2_ABI,
  ZERO_BYTES32,
  XLM_TO_WEI_SCALE,
  quoteEthToUsdc,
  quoteUsdcToEth,
  quoteEthToUsdcV2,
  quoteUsdcToEthV2,
  quoteUsdcToXlm,
  quoteXlmToUsdc,
} from "@/lib/legs";
import type { SwapRow } from "@/lib/db";
import { useStellarWallet } from "./useStellarWallet";

const NATIVE_TO_USDC_SCALE = 1_000_000_000_000n; // 1e12: 18-decimal native <-> 6-decimal µUSDC

/** Real strkey validation (not a regex guess) — a well-formed Stellar
 * Ed25519 public key ("G..." address), the only kind of recipient this
 * phase accepts. */
export function isValidStellarRecipient(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value);
}

/**
 * Shared hookData builder for any EVM destination — used both when the
 * source is another EVM chain (SwapAndBurn) and when the source is Stellar
 * (deposit_for_burn_with_hook), since Circle's hookData wire format is
 * identical either way and this destination-side logic never changes.
 * Never called when `dest.isStellar` (that has its own byte layout, built
 * inline in `swap()` below).
 */
function buildEvmDestHook(dest: Leg, address: `0x${string}`) {
  const mintRecipient = dest.nativeIsUsdc ? address : dest.executor!;
  const mintRecipientBytes32 = padHex(mintRecipient, { size: 32 });
  const destinationCaller = dest.nativeIsUsdc ? ZERO_BYTES32 : padHex(dest.executor!, { size: 32 });
  const hookData = dest.nativeIsUsdc
    ? ("0x00" as const)
    : encodeHook({
        target: dest.executor!,
        calldata:
          dest.dex === "v2"
            ? encodeFunctionData({
                abi: SWAP_USDC_TO_NATIVE_V2_ABI,
                functionName: "swapUsdcToNative",
                args: [0n, 1n, address],
              })
            : encodeFunctionData({
                abi: SWAP_USDC_TO_NATIVE_ABI,
                functionName: "swapUsdcToNative",
                args: [0n, dest.poolFee!, 1n, address],
              }),
        forwardAmount: 0n,
      });
  return { mintRecipientBytes32, destinationCaller, hookData };
}

/** Round-trips one Stellar-source step through the server (build/simulate/
 * prepare, since Soroban RPC doesn't belong in a client fetch — see
 * /api/stellar-source/prepare), signs with the connected Stellar wallet, and
 * submits + polls to completion. Throws on any failure. */
async function stellarPrepareSignSubmit(
  step: string,
  publicKey: string,
  args: Record<string, unknown>,
  signTransaction: (xdr: string) => Promise<string>
): Promise<{ hash: string; status: string }> {
  const prepRes = await fetch("/api/stellar-source/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step, publicKey, ...args }),
  });
  const prepData = await prepRes.json();
  if (!prepRes.ok) throw new Error(prepData.error ?? `${step}: prepare failed`);

  const signedXdr = await signTransaction(prepData.xdr);

  const subRes = await fetch("/api/stellar-source/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signedXdr }),
  });
  const subData = await subRes.json();
  if (!subRes.ok) throw new Error(subData.error ?? `${step}: submit failed`);
  if (subData.status !== "SUCCESS") throw new Error(`${step}: ${subData.status}`);
  return subData;
}

/** Live XLM balance (via Horizon) for the connected Stellar wallet, scaled
 * to 18-decimal "wei-equivalent" so the rest of the UI's formatEther() calls
 * work the same way they do for every EVM chain's native balance. */
function useStellarXlmBalance(publicKey: string | null, horizonUrl: string | undefined): bigint | null {
  const [balance, setBalance] = useState<bigint | null>(null);
  useEffect(() => {
    setBalance(null);
    if (!publicKey || !horizonUrl) return;
    let stale = false;
    fetch(`${horizonUrl}/accounts/${publicKey}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((acc) => {
        if (stale || !acc) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const native = acc.balances?.find((b: any) => b.asset_type === "native");
        if (!native) return;
        const stroops = BigInt(Math.round(parseFloat(native.balance) * 1e7));
        setBalance(stroops * XLM_TO_WEI_SCALE);
      })
      .catch(() => {
        // Unfunded/nonexistent account (404) or a transient RPC error —
        // leave balance null, same as any other chain's loading state.
      });
    return () => {
      stale = true;
    };
  }, [publicKey, horizonUrl]);
  return balance;
}

/** Circle fast-transfer fee (µUSDC) for a route, via our /api/fee proxy. */
export function useFastFee(from: string, to: string): bigint | null {
  const [fee, setFee] = useState<bigint | null>(null);
  useEffect(() => {
    setFee(null);
    fetch(`/api/fee?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d) => setFee(BigInt(d.maxFee)))
      .catch(() => setFee(null));
  }, [from, to]);
  return fee;
}

/**
 * Spot-quote of the entered amount in USDC (µ). On Arc the amount field
 * already means USDC (its native token), so this is a straight unit
 * conversion — no pool exists to quote against. On Avalanche (dex "v2")
 * the quote comes from a Uniswap-V2-style pair's reserves instead of a V3
 * pool's sqrtPriceX96.
 */
export function useUsdcEstimate(from: string, amount: string): bigint | null {
  const source = LEGS[from];
  // `source.chain` is undefined only for the Stellar leg — usePublicClient
  // tolerates an undefined chainId, and the Stellar branch below never
  // touches the returned client.
  const publicClient = usePublicClient({ chainId: source.chain?.id });
  const [estimate, setEstimate] = useState<bigint | null>(null);

  useEffect(() => {
    setEstimate(null);
    let wei: bigint;
    try {
      wei = parseEther(amount || "0");
    } catch {
      return;
    }
    if (wei === 0n) return;

    if (source.nativeIsUsdc) {
      setEstimate(wei / NATIVE_TO_USDC_SCALE);
      return;
    }
    if (source.isStellar) {
      // amount is XLM; wei here is really an 18-decimal "wei-equivalent" of
      // XLM (see XLM_TO_WEI_SCALE) — scale back down to real 7-decimal
      // stroops before quoting against the pair's reserves.
      const stroops = wei / XLM_TO_WEI_SCALE;
      let stale = false;
      fetch(`/api/stellar-quote?from=${from}`)
        .then((r) => r.json())
        .then((d) => {
          if (stale || d.error) return;
          setEstimate(quoteXlmToUsdc(stroops, BigInt(d.reserveUsdc), BigInt(d.reserveXlm)));
        })
        .catch(() => {});
      return () => {
        stale = true;
      };
    }
    if (!publicClient) return;
    let stale = false;
    if (source.dex === "v2") {
      publicClient
        .readContract({ address: source.pool!, abi: PAIR_RESERVES_ABI, functionName: "getReserves" })
        .then((r) => {
          if (!stale) setEstimate(quoteEthToUsdcV2(wei, r[0], r[1], source.token0IsUsdc!));
        })
        .catch(() => {});
    } else {
      publicClient
        .readContract({ address: source.pool!, abi: POOL_SLOT0_ABI, functionName: "slot0" })
        .then((slot0) => {
          if (!stale) setEstimate(quoteEthToUsdc(wei, slot0[0], source.token0IsUsdc!));
        })
        .catch(() => {});
    }
    return () => {
      stale = true;
    };
  }, [amount, source, publicClient]);

  return estimate;
}

export type Quote = {
  /** 18-decimal ("wei-equivalent") estimate of what lands on the
   *  destination, so formatEther() works universally. Null while the quote
   *  is still loading — never a guessed/placeholder value. */
  estimate: bigint | null;
  /** µUSDC actually deducted for the 0.05% Conduit fee. Null while loading. */
  conduitFeeUsdc: bigint | null;
  /** µUSDC actually deducted for Circle's fast-transfer fee. Null while
   *  the real quote from /api/fee hasn't arrived yet — never guessed. */
  circleFeeUsdc: bigint | null;
  /** µUSDC left to bridge after both fees. Null while loading. */
  netUsdc: bigint | null;
  /** True only once we have the REAL fee and it exceeds the amount sent —
   *  never set from a guessed/fallback fee. */
  tooSmall: boolean;
};

const LOADING_QUOTE: Quote = {
  estimate: null,
  conduitFeeUsdc: null,
  circleFeeUsdc: null,
  netUsdc: null,
  tooSmall: false,
};

/**
 * Estimated amount received on the destination, plus the fee breakdown that
 * produced it. On Arc as destination the "estimate" is the µUSDC net amount
 * scaled back up to 18 decimals, since Arc's native balance IS USDC and
 * needs no swap. The 0.05% Conduit fee only applies when the source goes
 * through SwapAndBurn (skipped when the source is Arc, since that path
 * burns directly from the EOA with no Conduit contract involved).
 *
 * Deliberately waits for the real Circle fee before computing anything —
 * an earlier version fell back to a guessed 1.3 USDC fee while /api/fee was
 * still loading, which for a small amount (e.g. 1 USDC) could show a false
 * "0" before the real (possibly much lower, even zero) fee arrived.
 */
export function useReceiveEstimate(
  from: string,
  to: string,
  usdcEstimate: bigint | null,
  fastFee: bigint | null
): Quote {
  const source = LEGS[from];
  const dest = LEGS[to];
  // dest.chain is undefined for the Stellar leg — usePublicClient tolerates
  // an undefined chainId, and the Stellar branch below never touches it.
  const publicClient = usePublicClient({ chainId: dest.chain?.id });
  const [quote, setQuote] = useState<Quote>(LOADING_QUOTE);

  useEffect(() => {
    setQuote(LOADING_QUOTE);
    if (usdcEstimate === null || fastFee === null) return;
    const conduitFee = source.nativeIsUsdc ? 0n : (usdcEstimate * 5n) / 10_000n;
    const net = usdcEstimate - conduitFee - fastFee;
    if (net <= 0n) {
      setQuote({
        estimate: 0n,
        conduitFeeUsdc: conduitFee,
        circleFeeUsdc: fastFee,
        netUsdc: 0n,
        tooSmall: true,
      });
      return;
    }
    const breakdown = { conduitFeeUsdc: conduitFee, circleFeeUsdc: fastFee, netUsdc: net, tooSmall: false };

    if (dest.nativeIsUsdc) {
      setQuote({ estimate: net * NATIVE_TO_USDC_SCALE, ...breakdown });
      return;
    }
    let stale = false;
    if (dest.isStellar) {
      // No viem publicClient for Stellar — read the Soroswap pair's
      // reserves via the /api/stellar-quote proxy (Soroban RPC doesn't fit
      // a client-side effect directly), mirroring how /api/fee proxies
      // Circle's fee endpoint.
      fetch(`/api/stellar-quote?to=${to}`)
        .then((r) => r.json())
        .then((d) => {
          if (stale || d.error) return;
          const stroops = quoteUsdcToXlm(net, BigInt(d.reserveUsdc), BigInt(d.reserveXlm));
          setQuote({ estimate: stroops * XLM_TO_WEI_SCALE, ...breakdown });
        })
        .catch(() => {});
      return () => {
        stale = true;
      };
    }
    if (!publicClient) return;
    if (dest.dex === "v2") {
      publicClient
        .readContract({ address: dest.pool!, abi: PAIR_RESERVES_ABI, functionName: "getReserves" })
        .then((r) => {
          if (!stale) setQuote({ estimate: quoteUsdcToEthV2(net, r[0], r[1], dest.token0IsUsdc!), ...breakdown });
        })
        .catch(() => {});
    } else {
      publicClient
        .readContract({ address: dest.pool!, abi: POOL_SLOT0_ABI, functionName: "slot0" })
        .then((slot0) => {
          if (!stale) setQuote({ estimate: quoteUsdcToEth(net, slot0[0], dest.token0IsUsdc!), ...breakdown });
        })
        .catch(() => {});
    }
    return () => {
      stale = true;
    };
  }, [usdcEstimate, fastFee, source, dest, to, publicClient]);

  return quote;
}

export type SwapStep = {
  label: string;
  done: boolean;
  active: boolean;
  link: string | null;
};

/** A swap being tracked — either just signed, or selected from history.
 *  `hash` is a bare 64-hex Stellar tx hash when `from` is Stellar, otherwise
 *  a standard 0x-prefixed EVM tx hash. */
type Tracked = { hash: string; from: string; to: string };

/**
 * The full swap flow: route/amount state, one-signature execution via
 * SwapAndBurn (or, when the source is Stellar, a Stellar-wallet-signed
 * multi-step sequence), and live status of the tracked transfer (client
 * receipt + relayer polling).
 */
export function useSwapFlow() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending: signing } = useWriteContract();
  const stellarWallet = useStellarWallet();

  const [from, setFrom] = useState("base");
  const [to, setTo] = useState("arbitrum");
  const [amount, setAmount] = useState("0.004");
  const [tracked, setTracked] = useState<Tracked | null>(null);
  const [serverSwap, setServerSwap] = useState<SwapRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Human-readable progress during the Stellar-source multi-signature
  // sequence (e.g. "1 of 3: Swap XLM → USDC…") — null outside that flow.
  const [stellarSourceStep, setStellarSourceStep] = useState<string | null>(null);

  const [stellarRecipient, setStellarRecipient] = useState("");

  const source = LEGS[from];
  const dest = LEGS[to];
  // `source.chain` is undefined only for the Stellar leg.
  const sourcePublicClient = usePublicClient({ chainId: source.chain?.id });
  const maxFee = useFastFee(from, to);
  const usdcEstimate = useUsdcEstimate(from, amount);
  const quote = useReceiveEstimate(from, to, usdcEstimate, maxFee);
  const { data: evmBalance } = useBalance({ address, chainId: source.chain?.id });
  const stellarXlmBalance = useStellarXlmBalance(
    source.isStellar ? stellarWallet.address : null,
    source.horizonUrl
  );
  const balance = source.isStellar ? stellarXlmBalance : (evmBalance?.value ?? null);

  // The tracked swap's own route (may differ from the selectors, e.g. when
  // opened from history).
  const trackedSource = tracked ? LEGS[tracked.from] : source;
  const trackedDest = tracked ? LEGS[tracked.to] : dest;

  const { data: burnReceipt } = useWaitForTransactionReceipt({
    // Stellar sources have no EVM receipt to wait for — `tracked` is only
    // set for a Stellar-sourced swap once the burn itself already succeeded
    // (see the Stellar branch of `swap()` below), so `steps` below treats
    // `!!tracked` as "burn done" for that case instead.
    hash: trackedSource.isStellar ? undefined : (tracked?.hash as `0x${string}` | undefined),
    chainId: trackedSource.chain?.id,
    query: { enabled: !trackedSource.isStellar && !!tracked },
  });

  // Poll the relayer status while a tracked swap is in flight.
  useEffect(() => {
    if (!tracked) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/swaps/${tracked.hash}`);
      if (r.ok && !stop) {
        const s: SwapRow = await r.json();
        setServerSwap(s);
        if (s.status === "COMPLETE" || s.status === "FAILED") stop = true;
      }
    };
    tick();
    const t = setInterval(() => {
      if (stop) clearInterval(t);
      else tick();
    }, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [tracked]);

  const steps: SwapStep[] = useMemo(() => {
    // Stellar sources have no EVM receipt to wait on — `tracked` is only set
    // once the whole Stellar-side signature sequence (up to 4 signatures)
    // already succeeded, so its mere presence means the burn is done.
    const burnDone = trackedSource.isStellar ? !!tracked : !!burnReceipt;
    const attested = serverSwap?.status === "RELAYING" || serverSwap?.status === "COMPLETE";
    const complete = serverSwap?.status === "COMPLETE";
    const burnLabel = trackedSource.nativeIsUsdc
      ? `Burn native USDC on ${trackedSource.label}`
      : trackedSource.isStellar
        ? `Swap XLM → USDC + burn on ${trackedSource.label} (Stellar wallet)`
        : `Swap ${trackedSource.chain!.nativeCurrency.symbol} → USDC + burn on ${trackedSource.label}`;
    const mintLabel = trackedDest.nativeIsUsdc
      ? `Mint native USDC on ${trackedDest.label}`
      : trackedDest.isStellar
        ? `Mint + swap USDC → XLM on ${trackedDest.label} (Soroban)`
        : `Mint + swap USDC → ${trackedDest.chain!.nativeCurrency.symbol} on ${trackedDest.label}`;
    return [
      {
        label: burnLabel,
        done: burnDone,
        active: !!tracked && !burnDone,
        link: tracked ? `${trackedSource.explorer}/tx/${tracked.hash}` : null,
      },
      {
        label: "Circle attestation (~15s)",
        done: attested,
        active: burnDone && !attested,
        link: null,
      },
      {
        label: mintLabel,
        done: complete,
        active: attested && !complete,
        link: serverSwap?.relayTxHash
          ? `${trackedDest.explorer}/tx/${serverSwap.relayTxHash}`
          : null,
      },
    ];
  }, [tracked, burnReceipt, serverSwap, trackedSource, trackedDest]);

  const reverse = useCallback(() => {
    // Stellar can now be either side (Phase 2), so a straight swap is
    // always valid — the ChainSelector's `exclude` prop already prevents
    // selecting the same chain on both sides.
    setFrom(to);
    setTo(from);
  }, [from, to]);

  /** Track an existing swap (e.g. selected from history). */
  const track = useCallback((hash: string, swapFrom: string, swapTo: string) => {
    setError(null);
    setServerSwap(null);
    setTracked({ hash, from: swapFrom, to: swapTo });
  }, []);

  /**
   * Stellar-as-source: up to four sequential Stellar Wallets Kit signatures
   * (trustline if missing, swap XLM → USDC via Soroswap's router — verified
   * live to work for a real EOA signer despite failing for a contract
   * caller in Phase 1, see DEPLOYMENTS.md — approve TokenMessengerMinter,
   * then deposit_for_burn_with_hook). The destination side is always a
   * normal EVM chain (Stellar can never be picked as both), so it reuses
   * the exact same hookData construction as every other EVM destination.
   */
  const swapFromStellar = useCallback(async () => {
    if (!stellarWallet.address) throw new Error("Connect a Stellar wallet first");
    if (!address) throw new Error("Connect an EVM wallet to receive on the destination chain");
    const stroopsIn = parseEther(amount || "0") / XLM_TO_WEI_SCALE;
    if (stroopsIn <= 0n) throw new Error("Enter an amount");

    const { hookData, mintRecipientBytes32, destinationCaller } = buildEvmDestHook(dest, address);
    const sign = stellarWallet.signTransaction;

    // Trustline: a real Stellar ACCOUNT needs one for classic-asset-backed
    // SAC tokens like USDC before it can hold a balance (contracts never
    // need this — verified live, see DEPLOYMENTS.md). Skip it for a
    // returning user who already has one, to save a signature.
    setStellarSourceStep("Checking your Stellar account for a USDC trustline…");
    const horizonAccount = await fetch(`${source.horizonUrl}/accounts/${stellarWallet.address}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasTrustline = horizonAccount?.balances?.some((b: any) => b.asset_code === "USDC");
    const totalSteps = hasTrustline ? 3 : 4;
    let stepNum = 1;
    if (!hasTrustline) {
      setStellarSourceStep(`${stepNum} of ${totalSteps}: Approve a USDC trustline in your Stellar wallet…`);
      await stellarPrepareSignSubmit("trustline", stellarWallet.address, {}, sign);
      stepNum++;
    }

    // Quote a real slippage floor (same 1% margin verified live against the
    // router — see scripts/verify-soroswap-router.ts) rather than guessing.
    setStellarSourceStep(`${stepNum} of ${totalSteps}: Swap XLM → USDC in your Stellar wallet…`);
    const quoteRes = await fetch(`/api/stellar-quote?from=${from}`).then((r) => r.json());
    if (quoteRes.error) throw new Error(`quote failed: ${quoteRes.error}`);
    const estOut = quoteXlmToUsdc(stroopsIn, BigInt(quoteRes.reserveUsdc), BigInt(quoteRes.reserveXlm));
    const minOut = (estOut * 990n) / 1000n;
    await stellarPrepareSignSubmit(
      "swap",
      stellarWallet.address,
      { amountIn: stroopsIn.toString(), amountOutMin: minOut.toString() },
      sign
    );
    stepNum++;

    // Read the real post-swap balance rather than trusting the pre-swap
    // estimate — burns/approves exactly what's spendable.
    const usdcAmount = await fetch(`/api/stellar-source/balance?publicKey=${stellarWallet.address}`)
      .then((r) => r.json())
      .then((d) => BigInt(d.balance ?? "0"));
    if (usdcAmount <= 0n) throw new Error("Swap produced no USDC");

    setStellarSourceStep(`${stepNum} of ${totalSteps}: Approve the burn contract to spend your USDC…`);
    await stellarPrepareSignSubmit(
      "approve",
      stellarWallet.address,
      { amount: usdcAmount.toString(), spender: source.stellarTokenMessengerMinter },
      sign
    );
    stepNum++;

    setStellarSourceStep(`${stepNum} of ${totalSteps}: Burn USDC on Stellar (final signature)…`);
    const fee = maxFee ?? 100_000n; // fallback: 0.1 USDC
    const { hash } = await stellarPrepareSignSubmit(
      "burn",
      stellarWallet.address,
      {
        amount: usdcAmount.toString(),
        destinationDomain: dest.domain,
        mintRecipientHex: mintRecipientBytes32,
        destinationCallerHex: destinationCaller,
        maxFee: fee.toString(),
        hookDataHex: hookData,
      },
      sign
    );
    setStellarSourceStep(null);
    return hash;
  }, [address, amount, dest, from, maxFee, source, stellarWallet]);

  const swap = useCallback(async () => {
    setError(null);
    setTracked(null);
    setServerSwap(null);
    try {
      if (dest.isStellar && !isValidStellarRecipient(stellarRecipient)) {
        throw new Error("Enter a valid Stellar recipient address (G...)");
      }

      if (source.isStellar) {
        const hash = await swapFromStellar();
        setTracked({ hash, from, to });
        await fetch("/api/swaps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ burnTxHash: hash, from, to }),
        });
        return;
      }

      if (chainId !== source.chain!.id) {
        await switchChainAsync({ chainId: source.chain!.id });
      }
      const fee = maxFee ?? 1_300_000n;
      // Wallets underestimate fees on Arbitrum Sepolia (maxFeePerGas below the
      // base fee → RPC rejects). Quote the base fee ourselves with 3x headroom;
      // unspent headroom is refunded.
      const block = await sourcePublicClient!.getBlock();
      const gasFees = block.baseFeePerGas
        ? {
            maxFeePerGas: block.baseFeePerGas * 3n + 1_000_000n,
            maxPriorityFeePerGas: 1_000_000n,
          }
        : {};
      // Avalanche Fuji's public RPC intermittently misestimates gas for
      // contract-to-contract calls ("exceeds block gas limit" on a call that
      // works fine with an explicit limit) — bypass automatic estimation.
      // Only matters when the burn call itself runs on Fuji (source); a
      // Fuji *destination* only affects the server-side relay, handled in
      // relayer.ts.
      const gasOverride = source.dex === "v2" ? { gas: 800_000n } : {};

      // Shared hook target: mint straight to the user's own address with no
      // hook when the destination is Arc (nothing to swap into — hookData
      // must still be non-empty since TokenMessenger's WithHook variant
      // rejects empty data, but it's never decoded there); a raw
      // Circle-format hookData (see below) when the destination is Stellar
      // (no atomic hook execution there — CctpForwarder only mints and
      // forwards, so the "hook" is Conduit's own trailing recipient field,
      // re-parsed a second time by swap_and_deliver); otherwise a hook into
      // the destination's swapUsdcToNative, using the V2-shaped ABI (no
      // poolFee param) when the destination is the Uniswap-V2-style
      // Avalanche deployment.
      let mintRecipientBytes32: `0x${string}`;
      let destinationCaller: `0x${string}`;
      let hookData: `0x${string}`;

      if (dest.isStellar) {
        // Both mintRecipient and destinationCaller must be CctpForwarder's
        // OWN address, never swap_and_deliver's — verified on-chain that
        // anything else reverts with InvalidMintRecipient (see
        // DEPLOYMENTS.md #15 and scripts/stellar-e2e.ts). Where funds really
        // end up is entirely CctpForwarder's own hookData-driven concern.
        const forwarderBytes32 = toHex(StrKey.decodeContract(dest.stellarCctpForwarder!)) as `0x${string}`;
        mintRecipientBytes32 = forwarderBytes32;
        destinationCaller = forwarderBytes32;

        // Byte layout (matches scripts/stellar-e2e.ts exactly): 24-byte
        // reserved + 4-byte version (both zero) + 4-byte BE length +
        // 56-byte ascii swap_and_deliver contract id (Circle's own
        // mint_and_forward format) + Conduit's own trailing 4-byte BE
        // length + ascii final Stellar recipient (the real delivery
        // address, cryptographically bound inside the attested message so
        // no one relaying it can redirect funds).
        const circleRecipientAscii = stringToHex(dest.stellarSwapAndDeliver!);
        const finalRecipientAscii = stringToHex(stellarRecipient);
        hookData = concatHex([
          numberToHex(0, { size: 24 }), // reserved
          numberToHex(0, { size: 4 }), // version
          numberToHex(dest.stellarSwapAndDeliver!.length, { size: 4 }),
          circleRecipientAscii,
          numberToHex(stellarRecipient.length, { size: 4 }),
          finalRecipientAscii,
        ]);
      } else {
        // amountIn=0 (swap all minted USDC) / minOut=1 (testnet pools carry
        // arbitrary prices; production quoting sets a real slippage floor)
        // are baked into buildEvmDestHook, shared with the Stellar-source
        // path above.
        ({ mintRecipientBytes32, destinationCaller, hookData } = buildEvmDestHook(dest, address!));
      }

      let hash: `0x${string}`;

      if (source.nativeIsUsdc) {
        // Arc as source: native balance already IS USDC, so there's no swap
        // and no Conduit contract — burn directly from the EOA via the
        // standard TokenMessenger, same mechanics as any CCTP integrator.
        const usdcAmount = parseEther(amount || "0") / NATIVE_TO_USDC_SCALE;
        const allowance = await sourcePublicClient!.readContract({
          address: source.usdc!,
          abi: USDC_ABI,
          functionName: "allowance",
          args: [address!, source.tokenMessenger!],
        });
        if (allowance < usdcAmount) {
          const approveHash = await writeContractAsync({
            address: source.usdc!,
            abi: USDC_ABI,
            functionName: "approve",
            args: [source.tokenMessenger!, usdcAmount],
            chainId: source.chain!.id,
          });
          await sourcePublicClient!.waitForTransactionReceipt({ hash: approveHash });
        }

        hash = await writeContractAsync({
          address: source.tokenMessenger!,
          abi: TOKEN_MESSENGER_ABI,
          functionName: "depositForBurnWithHook",
          args: [
            usdcAmount,
            dest.domain,
            mintRecipientBytes32,
            source.usdc!,
            destinationCaller,
            fee,
            1000,
            hookData,
          ],
          chainId: source.chain!.id,
        });
      } else if (source.dex === "v2") {
        // Avalanche as source: SwapAndBurnUniV2 — same shape as SwapAndBurn
        // but no poolFee param (Uniswap-V2-style routers have no fee tiers).
        hash = await writeContractAsync({
          address: source.swapAndBurn!,
          abi: SWAP_AND_BURN_V2_ABI,
          functionName: "swapAndBurnNative",
          args: [1n, dest.domain, mintRecipientBytes32, destinationCaller, fee, 1000, hookData],
          value: parseEther(amount || "0"),
          chainId: source.chain!.id,
          ...gasOverride,
        });
      } else {
        hash = await writeContractAsync({
          address: source.swapAndBurn!,
          abi: SWAP_AND_BURN_ABI,
          functionName: "swapAndBurnNative",
          args: [
            parseUnits("2", 6),
            source.poolFee!,
            dest.domain,
            mintRecipientBytes32,
            destinationCaller,
            fee,
            1000,
            hookData,
          ],
          value: parseEther(amount || "0"),
          chainId: source.chain!.id,
          ...gasFees,
        });
      }

      setTracked({ hash, from, to });
      await fetch("/api/swaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ burnTxHash: hash, from, to }),
      });
    } catch (e) {
      const msg =
        e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : "swap failed";
      setError(msg.slice(0, 300));
    }
  }, [
    address,
    chainId,
    source,
    dest,
    from,
    to,
    amount,
    maxFee,
    sourcePublicClient,
    switchChainAsync,
    writeContractAsync,
    stellarRecipient,
    swapFromStellar,
  ]);

  const busy =
    signing ||
    !!stellarSourceStep ||
    (!!tracked && serverSwap?.status !== "COMPLETE" && serverSwap?.status !== "FAILED");

  return {
    // route + amount
    from,
    to,
    amount,
    setFrom,
    setTo,
    setAmount,
    reverse,
    source,
    dest,
    stellarRecipient,
    setStellarRecipient,
    // quote
    maxFee,
    usdcEstimate,
    quote,
    balance,
    // execution + tracking
    swap,
    track,
    tracked,
    trackedDest,
    serverSwap,
    steps,
    // ui state
    signing,
    busy,
    error,
    isConnected,
    stellarSourceStep,
    stellarWallet,
  };
}
