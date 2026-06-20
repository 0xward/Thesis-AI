/**
 * deploy-new-contracts.cjs
 *
 * Deploys the NEW contracts only: thesis-certificate-v2 and thesis-review.
 * thesis-registry and thesis-certificate (v1) are already live on mainnet
 * and are NOT touched by this script.
 *
 * This uses the modern @stacks/transactions v7+ API (makeContractDeploy +
 * broadcastTransaction with string network names), replacing the old
 * deploy-contracts.legacy.cjs.bak which used the deprecated AnchorMode /
 * PostConditionMode.Allow API.
 *
 * For most cases, prefer the official Clarinet CLI workflow instead (see
 * contracts-workspace/README.md and the Termux deployment guide) — it
 * generates a reviewable deployment plan and handles cost estimation for
 * you. This script exists as a lightweight alternative if you don't want
 * to install the full Clarinet CLI.
 *
 * Usage:
 *   cd thesis-ai/                      (project root)
 *   npm install                        (already includes @stacks/transactions)
 *   STACKS_PRIVATE_KEY=your_key STACKS_NETWORK=testnet node scripts/deploy-new-contracts.cjs
 *
 *   Then, after verifying on testnet:
 *   STACKS_PRIVATE_KEY=your_key STACKS_NETWORK=mainnet node scripts/deploy-new-contracts.cjs
 */

const { makeContractDeploy, broadcastTransaction } = require('@stacks/transactions');
const { readFileSync } = require('fs');
const path = require('path');

const PRIVATE_KEY = process.env.STACKS_PRIVATE_KEY;
const NETWORK = process.env.STACKS_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';

if (!PRIVATE_KEY) {
  console.error('Error: Set STACKS_PRIVATE_KEY env variable before running.');
  console.error('  STACKS_PRIVATE_KEY=your_private_key STACKS_NETWORK=testnet node scripts/deploy-new-contracts.cjs');
  process.exit(1);
}

if (NETWORK === 'mainnet') {
  console.log('\n  You are about to deploy to MAINNET. This costs real STX and is irreversible.');
  console.log('  Make sure you already tested on testnet first.\n');
}

const CONTRACTS_DIR = path.join(__dirname, '..', 'contracts-workspace', 'contracts');

async function deployContract(contractName, fileName) {
  console.log(`\nDeploying ${contractName} (${NETWORK})...`);
  const codeBody = readFileSync(path.join(CONTRACTS_DIR, fileName), 'utf8');

  const transaction = await makeContractDeploy({
    contractName,
    codeBody,
    senderKey: PRIVATE_KEY,
    network: NETWORK,
    clarityVersion: 3,
  });

  const result = await broadcastTransaction({ transaction, network: NETWORK });

  if (result.error) {
    throw new Error(`Deploy failed for ${contractName}: ${result.error} - ${result.reason || ''}`);
  }

  console.log(`Deployed ${contractName}: txid=${result.txid}`);
  return result.txid;
}

(async () => {
  try {
    console.log('ThesisAI - New Contracts Deployer (v2 certificate + review)');
    console.log('=============================================================');

    // thesis-certificate-v2 depends on thesis-registry being already
    // deployed (it calls `contract-call? .thesis-registry get-proof ...`).
    // thesis-registry is already live, so we only deploy the new contracts
    // here. Order doesn't matter between these two since neither depends on
    // the other.
    await deployContract('thesis-certificate-v2', 'thesis-certificate-v2.clar');
    await deployContract('thesis-review', 'thesis-review.clar');

    console.log('\nAll new contracts deployed successfully.');
    console.log('\nNext steps:');
    console.log('  1. Wait for transactions to confirm (check on https://explorer.hiro.so).');
    console.log('  2. Update your .env / Vercel env vars:');
    console.log(`       VITE_STACKS_THESIS_NFT_V2=<your-address>.thesis-certificate-v2`);
    console.log(`       VITE_STACKS_THESIS_REVIEW=<your-address>.thesis-review`);
    console.log('  3. Set STACKS_BACKEND_PRIVATE_KEY on Vercel (a DIFFERENT, dedicated wallet');
    console.log('     used only for backend minting — do not reuse your deployer key for this).');
    console.log('  4. Call set-contract-owner on thesis-certificate-v2 to transfer ownership');
    console.log('     from the deployer address to the backend wallet address, so the backend');
    console.log('     (not you manually) can call mint going forward.');
    console.log('  5. Redeploy on Vercel to pick up the new env vars.');
  } catch (e) {
    console.error('\n', e.message);
    process.exit(1);
  }
})();
