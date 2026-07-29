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
import { BaseError, encodeFunctionData, padHex, parseEther, parseUnits } from "viem";
import { encodeHook } from "@cctp-sdk/core";
import {
  LEGS,
  POOL_SLOT0_ABI,
  SWAP_AND_BURN_ABI,
  SWAP_USDC_TO_NATIVE_ABI,
  quoteEthToUsdc,
  quoteUsdcToEth,
} from "@/lib/legs";
import type { SwapRow } from "@/lib/db";

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

/** Spot-quote of the entered ETH amount in USDC from the source pool. */
export function useUsdcEstimate(from: string, amount: string): bigint | null {
  const source = LEGS[from];
  const publicClient = usePublicClient({ chainId: source.chain.id });
  const [estimate, setEstimate] = useState<bigint | null>(null);

  useEffect(() => {
    setEstimate(null);
    let wei: bigint;
    try {
      wei = parseEther(amount || "0");
    } catch {
      return;
    }
    if (wei === 0n || !publicClient) return;
    let stale = false;
    publicClient
      .readContract({ address: source.pool, abi: POOL_SLOT0_ABI, functionName: "slot0" })
      .then((slot0) => {
        if (!stale) setEstimate(quoteEthToUsdc(wei, slot0[0], source.token0IsUsdc));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [amount, source, publicClient]);

  return estimate;
}

/**
 * Estimated native ETH received on the destination: source-pool USDC estimate,
 * minus the 0.05% Conduit fee and the Circle fast fee, priced through the
 * destination pool. Spot estimate — ignores swap fees and price impact.
 */
export function useReceiveEstimate(
  to: string,
  usdcEstimate: bigint | null,
  fastFee: bigint | null
): bigint | null {
  const dest = LEGS[to];
  const publicClient = usePublicClient({ chainId: dest.chain.id });
  const [estimate, setEstimate] = useState<bigint | null>(null);

  useEffect(() => {
    setEstimate(null);
    if (usdcEstimate === null || !publicClient) return;
    const net = usdcEstimate - (usdcEstimate * 5n) / 10_000n - (fastFee ?? 1_300_000n);
    if (net <= 0n) {
      setEstimate(0n);
      return;
    }
    let stale = false;
    publicClient
      .readContract({ address: dest.pool, abi: POOL_SLOT0_ABI, functionName: "slot0" })
      .then((slot0) => {
        if (!stale) setEstimate(quoteUsdcToEth(net, slot0[0], dest.token0IsUsdc));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [usdcEstimate, fastFee, dest, publicClient]);

  return estimate;
}

export type SwapStep = {
  label: string;
  done: boolean;
  active: boolean;
  link: string | null;
};

/** A swap being tracked — either just signed, or selected from history. */
type Tracked = { hash: `0x${string}`; from: string; to: string };

/**
 * The full swap flow: route/amount state, one-signature execution via
 * SwapAndBurn, and live status of the tracked transfer (client receipt +
 * relayer polling).
 */
export function useSwapFlow() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending: signing } = useWriteContract();

  const [from, setFrom] = useState("base");
  const [to, setTo] = useState("arbitrum");
  const [amount, setAmount] = useState("0.004");
  const [tracked, setTracked] = useState<Tracked | null>(null);
  const [serverSwap, setServerSwap] = useState<SwapRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const source = LEGS[from];
  const dest = LEGS[to];
  const sourcePublicClient = usePublicClient({ chainId: source.chain.id });
  const maxFee = useFastFee(from, to);
  const usdcEstimate = useUsdcEstimate(from, amount);
  const receiveEstimate = useReceiveEstimate(to, usdcEstimate, maxFee);
  const { data: balance } = useBalance({ address, chainId: source.chain.id });

  // The tracked swap's own route (may differ from the selectors, e.g. when
  // opened from history).
  const trackedSource = tracked ? LEGS[tracked.from] : source;
  const trackedDest = tracked ? LEGS[tracked.to] : dest;

  const { data: burnReceipt } = useWaitForTransactionReceipt({
    hash: tracked?.hash,
    chainId: trackedSource.chain.id,
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
    const burnDone = !!burnReceipt;
    const attested = serverSwap?.status === "RELAYING" || serverSwap?.status === "COMPLETE";
    const complete = serverSwap?.status === "COMPLETE";
    return [
      {
        label: `Swap ETH → USDC + burn on ${trackedSource.label}`,
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
        label: `Mint + swap USDC → ETH on ${trackedDest.label}`,
        done: complete,
        active: attested && !complete,
        link: serverSwap?.relayTxHash
          ? `${trackedDest.explorer}/tx/${serverSwap.relayTxHash}`
          : null,
      },
    ];
  }, [tracked, burnReceipt, serverSwap, trackedSource, trackedDest]);

  const reverse = useCallback(() => {
    setFrom(to);
    setTo(from);
  }, [from, to]);

  /** Track an existing swap (e.g. selected from history). */
  const track = useCallback((hash: `0x${string}`, swapFrom: string, swapTo: string) => {
    setError(null);
    setServerSwap(null);
    setTracked({ hash, from: swapFrom, to: swapTo });
  }, []);

  const swap = useCallback(async () => {
    setError(null);
    setTracked(null);
    setServerSwap(null);
    try {
      if (chainId !== source.chain.id) {
        await switchChainAsync({ chainId: source.chain.id });
      }
      const fee = maxFee ?? 1_300_000n;
      const hook = encodeHook({
        target: dest.executor,
        calldata: encodeFunctionData({
          abi: SWAP_USDC_TO_NATIVE_ABI,
          functionName: "swapUsdcToNative",
          // amountIn=0: swap all minted USDC. minOut=1: testnet pools carry
          // arbitrary prices; production quoting sets a real slippage floor.
          args: [0n, dest.poolFee, 1n, address!],
        }),
        forwardAmount: 0n,
      });
      const executorBytes32 = padHex(dest.executor, { size: 32 });
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
      const hash = await writeContractAsync({
        address: source.swapAndBurn,
        abi: SWAP_AND_BURN_ABI,
        functionName: "swapAndBurnNative",
        args: [
          parseUnits("2", 6),
          source.poolFee,
          dest.domain,
          executorBytes32,
          executorBytes32,
          fee,
          1000,
          hook,
        ],
        value: parseEther(amount || "0"),
        chainId: source.chain.id,
        ...gasFees,
      });
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
  }, [address, chainId, source, dest, from, to, amount, maxFee, sourcePublicClient, switchChainAsync, writeContractAsync]);

  const busy =
    signing ||
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
    // quote
    maxFee,
    usdcEstimate,
    receiveEstimate,
    balance: balance?.value ?? null,
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
  };
}
