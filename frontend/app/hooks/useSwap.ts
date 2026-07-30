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
import { encodeHook, TOKEN_MESSENGER_ABI, USDC_ABI } from "@cctp-sdk/core";
import {
  LEGS,
  POOL_SLOT0_ABI,
  SWAP_AND_BURN_ABI,
  SWAP_USDC_TO_NATIVE_ABI,
  ZERO_BYTES32,
  quoteEthToUsdc,
  quoteUsdcToEth,
} from "@/lib/legs";
import type { SwapRow } from "@/lib/db";

const NATIVE_TO_USDC_SCALE = 1_000_000_000_000n; // 1e12: 18-decimal native <-> 6-decimal µUSDC

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
 * conversion — no pool exists to quote against.
 */
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
    if (wei === 0n) return;

    if (source.nativeIsUsdc) {
      setEstimate(wei / NATIVE_TO_USDC_SCALE);
      return;
    }
    if (!publicClient) return;
    let stale = false;
    publicClient
      .readContract({ address: source.pool!, abi: POOL_SLOT0_ABI, functionName: "slot0" })
      .then((slot0) => {
        if (!stale) setEstimate(quoteEthToUsdc(wei, slot0[0], source.token0IsUsdc!));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [amount, source, publicClient]);

  return estimate;
}

/**
 * Estimated amount received on the destination, always returned as an
 * 18-decimal ("wei-equivalent") bigint so formatEther() works universally —
 * on a normal chain that's native ETH from the destination pool; on Arc
 * it's the µUSDC net amount scaled back up, since Arc's native balance IS
 * USDC and needs no swap. The 0.05% Conduit fee only applies when the
 * source goes through SwapAndBurn (skipped when the source is Arc, since
 * that path burns directly from the EOA with no Conduit contract involved).
 */
export function useReceiveEstimate(
  from: string,
  to: string,
  usdcEstimate: bigint | null,
  fastFee: bigint | null
): bigint | null {
  const source = LEGS[from];
  const dest = LEGS[to];
  const publicClient = usePublicClient({ chainId: dest.chain.id });
  const [estimate, setEstimate] = useState<bigint | null>(null);

  useEffect(() => {
    setEstimate(null);
    if (usdcEstimate === null) return;
    const conduitFee = source.nativeIsUsdc ? 0n : (usdcEstimate * 5n) / 10_000n;
    const net = usdcEstimate - conduitFee - (fastFee ?? 1_300_000n);
    if (net <= 0n) {
      setEstimate(0n);
      return;
    }

    if (dest.nativeIsUsdc) {
      setEstimate(net * NATIVE_TO_USDC_SCALE);
      return;
    }
    if (!publicClient) return;
    let stale = false;
    publicClient
      .readContract({ address: dest.pool!, abi: POOL_SLOT0_ABI, functionName: "slot0" })
      .then((slot0) => {
        if (!stale) setEstimate(quoteUsdcToEth(net, slot0[0], dest.token0IsUsdc!));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [usdcEstimate, fastFee, source, dest, publicClient]);

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
  const receiveEstimate = useReceiveEstimate(from, to, usdcEstimate, maxFee);
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
    const burnLabel = trackedSource.nativeIsUsdc
      ? `Burn native USDC on ${trackedSource.label}`
      : `Swap ETH → USDC + burn on ${trackedSource.label}`;
    const mintLabel = trackedDest.nativeIsUsdc
      ? `Mint native USDC on ${trackedDest.label}`
      : `Mint + swap USDC → ETH on ${trackedDest.label}`;
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
            chainId: source.chain.id,
          });
          await sourcePublicClient!.waitForTransactionReceipt({ hash: approveHash });
        }

        const hook = encodeHook({
          target: dest.executor!,
          calldata: encodeFunctionData({
            abi: SWAP_USDC_TO_NATIVE_ABI,
            functionName: "swapUsdcToNative",
            args: [0n, dest.poolFee!, 1n, address!],
          }),
          forwardAmount: 0n,
        });
        const executorBytes32 = padHex(dest.executor!, { size: 32 });

        hash = await writeContractAsync({
          address: source.tokenMessenger!,
          abi: TOKEN_MESSENGER_ABI,
          functionName: "depositForBurnWithHook",
          args: [
            usdcAmount,
            dest.domain,
            executorBytes32,
            source.usdc!,
            executorBytes32,
            fee,
            1000,
            hook,
          ],
          chainId: source.chain.id,
        });
      } else {
        // Standard SwapAndBurn path. When the destination is Arc there's no
        // executor to swap into — mint straight to the user's own address,
        // no hook. TokenMessenger's WithHook variant rejects empty hookData,
        // so pass an inert byte; the relayer calls plain receiveMessage for
        // an Arc destination, so it's never decoded or executed.
        const mintRecipient = dest.nativeIsUsdc ? address! : dest.executor!;
        const mintRecipientBytes32 = padHex(mintRecipient, { size: 32 });
        const destinationCaller = dest.nativeIsUsdc
          ? ZERO_BYTES32
          : padHex(dest.executor!, { size: 32 });
        const hookData = dest.nativeIsUsdc
          ? ("0x00" as const)
          : encodeHook({
              target: dest.executor!,
              calldata: encodeFunctionData({
                abi: SWAP_USDC_TO_NATIVE_ABI,
                functionName: "swapUsdcToNative",
                // amountIn=0: swap all minted USDC. minOut=1: testnet pools carry
                // arbitrary prices; production quoting sets a real slippage floor.
                args: [0n, dest.poolFee!, 1n, address!],
              }),
              forwardAmount: 0n,
            });

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
          chainId: source.chain.id,
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
