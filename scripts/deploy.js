// Deploys FileVault and records the address + ABI for the frontend.
//   npm run deploy:local     (Hardhat node on http://127.0.0.1:8545)
//   npm run deploy:sepolia   (needs SEPOLIA_RPC_URL and PRIVATE_KEY in .env)
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network, artifacts } = hre;
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`Network   : ${network.name} (chainId ${chainId})`);
  console.log(`Deployer  : ${deployer.address}`);

  const factory = await ethers.getContractFactory("FileVault");
  const vault = await factory.deploy();
  await vault.waitForDeployment();
  const address = await vault.getAddress();
  const tx = vault.deploymentTransaction();
  const receipt = await tx.wait();

  console.log(`FileVault : ${address}`);

  const outDir = path.join(__dirname, "..", "frontend", "src", "contracts");
  fs.mkdirSync(outDir, { recursive: true });

  // 1) ABI for ethers.js
  const artifact = await artifacts.readArtifact("FileVault");
  fs.writeFileSync(path.join(outDir, "FileVault.abi.json"), JSON.stringify(artifact.abi, null, 2) + "\n");

  // 2) address per chain id (earlier deployments are kept)
  const file = path.join(outDir, "deployments.json");
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  all[String(chainId)] = {
    address,
    network: network.name,
    blockNumber: receipt.blockNumber,
    txHash: tx.hash,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n");

  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
  console.log("Done. Start the app with: npm run dev");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
