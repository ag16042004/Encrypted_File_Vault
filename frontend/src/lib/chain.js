// ---------------------------------------------------------------------------
// Everything that talks to MetaMask and the FileVault smart contract.
// ---------------------------------------------------------------------------
import { BrowserProvider, Contract } from "ethers";
import abi from "../contracts/FileVault.abi.json";
import deployments from "../contracts/deployments.json";

const env = import.meta.env || {};

export const TARGET_CHAIN_ID = Number(env.VITE_CHAIN_ID || 31337);

export const CHAINS = {
  31337: { name: "Hardhat Local", hex: "0x7a69", rpc: "http://127.0.0.1:8545", symbol: "ETH", explorer: null },
  11155111: { name: "Sepolia", hex: "0xaa36a7", rpc: "https://ethereum-sepolia-rpc.publicnode.com", symbol: "SepoliaETH", explorer: "https://sepolia.etherscan.io" },
};
export const chainName = (id) => CHAINS[id]?.name || `Chain ${id}`;
export const targetChain = () => CHAINS[TARGET_CHAIN_ID] || { name: `Chain ${TARGET_CHAIN_ID}` };
export const txUrl = (hash) => (CHAINS[TARGET_CHAIN_ID]?.explorer ? `${CHAINS[TARGET_CHAIN_ID].explorer}/tx/${hash}` : null);

export function contractAddress(chainId = TARGET_CHAIN_ID) {
  if (env.VITE_CONTRACT_ADDRESS && chainId === TARGET_CHAIN_ID) return env.VITE_CONTRACT_ADDRESS;
  return deployments[String(chainId)]?.address || null;
}
export const deploymentBlock = (chainId = TARGET_CHAIN_ID) => deployments[String(chainId)]?.blockNumber || 0;

export const hasWallet = () => typeof window !== "undefined" && !!window.ethereum;

export class ChainError extends Error {}

// -------------------------------------------------------------- wallet
async function snapshot(provider) {
  const signer = await provider.getSigner();
  const network = await provider.getNetwork();
  return { provider, signer, address: await signer.getAddress(), chainId: Number(network.chainId) };
}

/** Opens the MetaMask connect prompt. */
export async function connectWallet() {
  if (!hasWallet()) throw new ChainError("No wallet found. Install MetaMask to continue.");
  const provider = new BrowserProvider(window.ethereum, "any");
  await provider.send("eth_requestAccounts", []);
  return snapshot(provider);
}

/** Reconnects silently if the site is already approved in MetaMask. */
export async function reconnectWallet() {
  if (!hasWallet()) return null;
  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  if (!accounts?.length) return null;
  return snapshot(new BrowserProvider(window.ethereum, "any"));
}

export async function switchToTarget() {
  const chain = CHAINS[TARGET_CHAIN_ID];
  if (!chain) throw new ChainError(`Unsupported VITE_CHAIN_ID ${TARGET_CHAIN_ID}.`);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.hex }] });
  } catch (e) {
    const code = e?.code ?? e?.data?.originalError?.code;
    if (code === 4001) throw e; // user said no
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: chain.hex,
        chainName: chain.name,
        rpcUrls: [chain.rpc],
        nativeCurrency: { name: chain.symbol, symbol: chain.symbol, decimals: 18 },
        ...(chain.explorer ? { blockExplorerUrls: [chain.explorer] } : {}),
      }],
    });
  }
}

export function vaultContract(signerOrProvider, chainId) {
  const address = contractAddress(chainId);
  if (!address) {
    throw new ChainError(
      `The FileVault smart contract is not deployed on ${chainName(chainId)}. Run "npm run deploy:${chainId === 11155111 ? "sepolia" : "local"}" and reload the page.`,
    );
  }
  return new Contract(address, abi, signerOrProvider);
}

// ------------------------------------------------------------ reading
function toFile(f) {
  return {
    id: Number(f.id),
    owner: f.owner,
    hash: f.hash,
    cid: f.cid,
    uploadedAt: Number(f.uploadedAt) * 1000,
    encMeta: f.encMeta,
    key: f.key,
  };
}

/** Raw (still encrypted) records of every file the address owns or can access. */
export async function fetchSealedFiles(vault) {
  const address = await vault.runner.getAddress();
  const [owned, shared] = await Promise.all([vault.getOwnedFileIds(address), vault.getSharedFileIds(address)]);
  const ids = [...new Set([...owned, ...shared].map(Number))].sort((a, b) => b - a);
  const out = [];
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(ids.slice(i, i + 8).map((id) => vault.getFile(id)));
    out.push(...batch.map(toFile));
  }
  return out;
}

export async function fetchPublicKey(vault, address) {
  return vault.getPublicKey(address);
}

export async function fetchAccessList(vault, id) {
  return (await vault.getAccessList(id)).map((a) => a);
}

/** Calls verifyFile on the contract: does `hashHex` equal the hash stored on-chain? */
export async function verifyOnChain(vault, id, hashHex) {
  return vault.verifyFile(id, hashHex);
}

// ------------------------------------------------------------ writing
export async function sendUpload(vault, { hashHex, cid, encMeta, ownerKey }, onSent) {
  const tx = await vault.uploadFile(hashHex, cid, encMeta, ownerKey);
  onSent?.(tx);
  const receipt = await tx.wait();
  let id = null;
  for (const log of receipt.logs) {
    try {
      const parsed = vault.interface.parseLog(log);
      if (parsed?.name === "FileUploaded") id = Number(parsed.args.id);
    } catch { /* not our event */ }
  }
  return { id, txHash: tx.hash };
}

export async function sendTx(promise) {
  const tx = await promise;
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt };
}

// ------------------------------------------------------------ activity
/** Past on-chain events that involve `address`, newest first. */
export async function fetchChainEvents(vault, provider, address, chainId = TARGET_CHAIN_ID) {
  const from = deploymentBlock(chainId);
  const f = vault.filters;
  const queries = [
    ["FileUploaded", f.FileUploaded(null, address)],
    ["AccessGranted", f.AccessGranted(null, address, null)],
    ["AccessGranted", f.AccessGranted(null, null, address)],
    ["AccessRevoked", f.AccessRevoked(null, address, null)],
    ["AccessRevoked", f.AccessRevoked(null, null, address)],
    ["FileDeleted", f.FileDeleted(null, address)],
    ["PublicKeyRegistered", f.PublicKeyRegistered(address)],
  ];
  const results = await Promise.all(queries.map(([, filter]) => vault.queryFilter(filter, from, "latest")));
  const seen = new Set();
  const events = [];
  results.forEach((list, i) => {
    for (const ev of list) {
      const key = `${ev.transactionHash}:${ev.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({
        name: queries[i][0],
        blockNumber: ev.blockNumber,
        txHash: ev.transactionHash,
        id: ev.args.id !== undefined ? Number(ev.args.id) : null,
        owner: ev.args.owner,
        user: ev.args.user,
        asRecipient: queries[i][0].startsWith("Access") && ev.args.user?.toLowerCase() === address.toLowerCase(),
      });
    }
  });
  const blocks = new Map();
  for (const bn of new Set(events.map((e) => e.blockNumber))) {
    const b = await provider.getBlock(bn);
    blocks.set(bn, (b?.timestamp || 0) * 1000);
  }
  return events
    .map((e) => ({ ...e, at: blocks.get(e.blockNumber) }))
    .sort((a, b) => b.at - a.at || b.blockNumber - a.blockNumber);
}
