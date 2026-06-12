/**
 * deploy-contracts.cjs
 * Deploy thesis-registry and thesis-certificate to Stacks mainnet.
 *
 * Usage (from project root, in Termux or any Node env):
 *   npm install @stacks/transactions @stacks/network
 *   STACKS_PRIVATE_KEY=your_private_key node scripts/deploy-contracts.cjs
 *
 * After deploy, update Vercel env vars:
 *   VITE_STACKS_THESIS_REGISTRY=<deployer>.thesis-registry
 *   VITE_STACKS_THESIS_NFT=<deployer>.thesis-certificate
 */

const {
  makeContractDeploy,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
} = require('@stacks/transactions');
const { StacksMainnet } = require('@stacks/network');
const { readFileSync } = require('fs');

const PRIVATE_KEY = process.env.STACKS_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('Error: Set STACKS_PRIVATE_KEY env variable before running.');
  console.error('  STACKS_PRIVATE_KEY=your_private_key node scripts/deploy-contracts.cjs');
  process.exit(1);
}

const network = new StacksMainnet();

async function deployContract(contractName, codeFilePath) {
  console.log(`\nDeploying ${contractName} from ${codeFilePath}...`);
  const codeBody = readFileSync(codeFilePath, 'utf8');
  const tx = await makeContractDeploy({
    contractName,
    codeBody,
    senderKey: PRIVATE_KEY,
    network,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
    fee: 10000,
  });
  const result = await broadcastTransaction(tx, network);
  if (result.error) {
    throw new Error(`Deploy failed for ${contractName}: ${result.error} — ${result.reason}`);
  }
  console.log(`✓ Deployed ${contractName}: txid=${result.txid}`);
  return result.txid;
}

(async () => {
  try {
    console.log('ThesisAI — Stacks Contract Deployer');
    console.log('=====================================');
    await deployContract('thesis-registry', 'contracts/thesis-registry.clar');
    await deployContract('thesis-certificate', 'contracts/thesis-certificate.clar');
    console.log('\n✓ All contracts deployed successfully.');
    console.log('\nNext steps:');
    console.log('  1. Wait for transactions to confirm on Stacks mainnet.');
    console.log('  2. The deployer address is derived from your private key.');
    console.log('  3. Update Vercel env vars:');
    console.log('       VITE_STACKS_THESIS_REGISTRY=<your-address>.thesis-registry');
    console.log('       VITE_STACKS_THESIS_NFT=<your-address>.thesis-certificate');
    console.log('  4. Redeploy on Vercel to pick up the new env vars.');
  } catch (e) {
    console.error('\n✗', e.message);
    process.exit(1);
  }
})();
