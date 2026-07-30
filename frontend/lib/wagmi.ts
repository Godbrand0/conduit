import { createConfig, http } from "wagmi";
import { baseSepolia, arbitrumSepolia, sepolia, optimismSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { arcTestnet } from "./arcChain";

export const wagmiConfig = createConfig({
  chains: [baseSepolia, arbitrumSepolia, sepolia, optimismSepolia, arcTestnet],
  connectors: [injected()],
  transports: {
    [baseSepolia.id]: http("https://base-sepolia-rpc.publicnode.com"),
    [arbitrumSepolia.id]: http("https://sepolia-rollup.arbitrum.io/rpc"),
    [sepolia.id]: http("https://ethereum-sepolia-rpc.publicnode.com"),
    [optimismSepolia.id]: http("https://sepolia.optimism.io"),
    [arcTestnet.id]: http("https://rpc.testnet.arc.network"),
  },
});
