"use client";

import { useCallback, useEffect, useState } from "react";
import { StellarWalletsKit, Networks, KitEventType } from "@creit.tech/stellar-wallets-kit";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";

/**
 * Stellar Wallets Kit v2.5's API is a static class (StellarWalletsKit.init /
 * .authModal / .signTransaction / ...), not an instance you construct — this
 * was verified against the installed package's own .d.ts files, not assumed
 * from docs (the kit went through breaking API changes across majors). Init
 * is idempotent-guarded here since React may mount this hook more than once
 * (StrictMode, multiple components).
 *
 * Only Freighter is wired in as a module for now (Conduit's primary target,
 * per the phase plan) — the kit supports many more wallets via its own
 * `defaultModules()`, but that pulls in WalletConnect (needs a project ID)
 * and several other SDKs not otherwise needed here.
 */
let kitInitialized = false;
function ensureKitInitialized() {
  if (kitInitialized) return;
  StellarWalletsKit.init({
    network: Networks.TESTNET,
    modules: [new FreighterModule()],
  });
  kitInitialized = true;
}

const STORAGE_KEY = "conduit:stellarWalletId";

/**
 * Stellar wallet connection state, parallel to (and independent of) wagmi's
 * EVM connection — needed now that Stellar can be a SOURCE chain (Phase 2),
 * which requires the user to sign real transactions (approve, swap,
 * deposit_for_burn_with_hook) with a Stellar keypair, unlike Stellar-as-
 * destination which needs no Stellar signature at all.
 */
export function useStellarWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    ensureKitInitialized();
    const unsubscribe = StellarWalletsKit.on(KitEventType.STATE_UPDATED, (event) => {
      setAddress(event.payload.address ?? null);
    });
    return unsubscribe;
  }, []);

  const connect = useCallback(async () => {
    ensureKitInitialized();
    setConnecting(true);
    try {
      const { address } = await StellarWalletsKit.authModal();
      setAddress(address);
      localStorage.setItem(STORAGE_KEY, "freighter");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await StellarWalletsKit.disconnect();
    } catch {
      // Freighter's module has no real disconnect handshake — clearing local
      // state below is what actually matters to this app.
    }
    localStorage.removeItem(STORAGE_KEY);
    setAddress(null);
  }, []);

  /** Sign an unsigned transaction XDR with the connected wallet. Throws if
   *  no wallet is connected — callers must check `address` first. */
  const signTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      if (!address) throw new Error("No Stellar wallet connected");
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
        address,
        networkPassphrase: Networks.TESTNET,
      });
      return signedTxXdr;
    },
    [address]
  );

  return { address, connecting, connect, disconnect, signTransaction };
}
