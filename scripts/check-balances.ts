import { config } from "dotenv";
import { createPublicClient, http, formatEther } from "viem";
import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Horizon, Keypair } from "@stellar/stellar-sdk";

config({ path: new URL("../.env", import.meta.url).pathname });

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
console.log("EVM wallet:", account.address);
for (const [name, chain, rpc] of [
  ["arbitrum", arbitrumSepolia, process.env.ARB_SEPOLIA_RPC],
  ["base", baseSepolia, process.env.BASE_SEPOLIA_RPC],
] as const) {
  const client = createPublicClient({ chain, transport: http(rpc) });
  const bal = await client.getBalance({ address: account.address });
  console.log(name, formatEther(bal), "ETH");
}

const relayerKp = Keypair.fromSecret(process.env.STELLAR_RELAYER_SECRET as string);
console.log("Stellar relayer:", relayerKp.publicKey());
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
try {
  const acc = await horizon.accounts().accountId(relayerKp.publicKey()).call();
  const xlm = acc.balances.find((b: any) => b.asset_type === "native")!.balance;
  console.log("Stellar relayer XLM:", xlm);
} catch (e) {
  console.log("Stellar relayer account not found / unfunded:", (e as Error).message);
}
