# Encrypted File Vault

Decentralised encrypted file storage. Files are encrypted **in the browser** with AES-256-GCM, the encrypted copy
is stored on **IPFS**, and the file's **SHA-256 hash, IPFS CID and access permissions** are recorded by a
**Solidity smart contract** on Ethereum. A **MetaMask** wallet signs the transactions.

```
Browser (React)                                   Network
 1. hash file (SHA-256)
 2. encrypt file (AES-256-GCM, random key)  ----> IPFS      encrypted file  -> CID
 3. seal file key + file name with your keys
 4. wallet signs uploadFile(hash, cid, ...)  ---> Ethereum  FileVault contract
```

## Quick start (local demo, about 5 minutes)

Requirements: **Node.js 20 or 22 LTS**, npm, Chrome/Edge/Firefox with the **MetaMask** extension.

```bash
npm run setup          # installs the contract tools and the web app
```

Open three terminals in this folder:

```bash
# Terminal 1 - a private test blockchain
npm run node

# Terminal 2 - deploy the smart contract to it (writes the address for the web app)
npm run deploy:local

# Terminal 3 - the web app
npm run dev            # open http://localhost:5173
```

In MetaMask:

1. Import a test account: *Account menu > Import account >* paste a private key printed by Terminal 1
   (for example Account #0). These keys are public, for local use only.
2. When the app asks, approve **Connect** and **Add network** (Hardhat Local, chain 31337, RPC http://127.0.0.1:8545).

In the app: **Get Started > create your vault > save the recovery key > Connect Wallet > Upload**.

> If you restart `npm run node`, run `npm run deploy:local` again and reset MetaMask's cached nonce:
> *Settings > Advanced > Clear activity tab data*.

By default encrypted files are kept by a built-in **IPFS simulation** in your browser (no account needed).
See "Real IPFS and Sepolia" below to use the real network.

## Real IPFS and Sepolia

1. Get a Sepolia RPC URL (Infura or Alchemy) and a **throw-away wallet** funded with Sepolia test ETH from a faucet.
2. Copy `.env.example` to `.env` in this folder and fill in `SEPOLIA_RPC_URL` and `PRIVATE_KEY`.
3. `npm run deploy:sepolia`
4. Copy `frontend/.env.example` to `frontend/.env` and set:
   ```
   VITE_CHAIN_ID=11155111
   VITE_STORAGE_MODE=pinata
   VITE_PINATA_JWT=<Pinata API key limited to pinFileToIPFS>
   VITE_IPFS_GATEWAY=https://<your-gateway>.mypinata.cloud
   ```
5. Restart `npm run dev` and switch MetaMask to Sepolia.

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | install all dependencies |
| `npm run node` | start the local blockchain |
| `npm run deploy:local` / `deploy:sepolia` | deploy the contract and write `frontend/src/contracts/` |
| `npm run dev` | start the web app (port 5173) |
| `npm run build` | production build of the web app (`frontend/dist`) |
| `npm test` | smart contract tests (14) |
| `npm --prefix frontend test` | cryptography / keystore / TOTP tests (17) |

## Project layout

```
contracts/FileVault.sol     smart contract (uploadFile, verifyFile, grantAccess, revokeAccess, getFile, ...)
test/FileVault.test.js      contract tests
scripts/deploy.js           deploy + export address and ABI to the web app
frontend/src/lib/crypto.js  ALL cryptography (Web Crypto API only)
frontend/src/lib/keystore.js  local encrypted account: master password, recovery key, 2FA, folders
frontend/src/lib/chain.js   MetaMask + contract calls          ipfs.js   IPFS / Pinata / local simulation
frontend/src/context/       app state: session, wallet, uploads, sharing, trash
frontend/src/pages/         the 16 screens of the UI board
```

## Security model in one minute

* The **master password** unlocks a small encrypted keystore kept in your browser (PBKDF2, 600,000 rounds).
  It holds the **vault key**. Nothing leaves the device.
* Every file gets its own random **file key**. The file, its name, type and size are encrypted with it.
  The file key is sealed with your vault key. To share, it is sealed with the recipient's public key (ECDH P-256).
* The **blockchain is public**: it shows the SHA-256 hash, the IPFS CID and which wallets have access, never
  file contents or names.
* On every open, the app decrypts (AES-GCM detects any change) and re-checks the SHA-256 against the contract.
* **No recovery without a key**: lose the master password and the recovery key, and the files cannot be opened.
  Download a vault backup (Security > Vault Backup) to use the vault on another device.

Limitations: 2FA protects unlocking on this device only; IPFS data cannot be erased (it stays unreadable);
the Pinata key is visible in the browser bundle, so use a key limited to `pinFileToIPFS`.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Smart contract not deployed on ..." | run `npm run deploy:local` (or `deploy:sepolia`), reload the page |
| "Wrong network" | click **Switch to ...** in the app, or change network in MetaMask |
| Transactions stuck / "nonce too high" | MetaMask > Settings > Advanced > Clear activity tab data (after restarting the local node) |
| File shows "No key" | it was uploaded with a different vault key (another account or device); import that vault's backup |
| "not in the local IPFS simulation" | the file was uploaded from another browser; use Pinata mode to share across devices |
| Hardhat cannot download the compiler | it needs internet access to `binaries.soliditylang.org` the first time |
