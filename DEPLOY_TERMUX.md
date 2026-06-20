# Deploying ThesisAI Contracts from Termux

This guide walks through deploying `thesis-certificate-v2` and `thesis-review`
to Stacks testnet (then mainnet) using only an Android phone with Termux.
`thesis-registry` and `thesis-certificate` (v1) are already live and are
**not** touched by any of these steps.

Total time: roughly 30-45 minutes the first time, mostly Node.js/dependency
install. Actual deployment itself takes a few minutes per contract.

---

## 0. Install Termux (if you haven't already)

Use **F-Droid**, not the Play Store — the Play Store build of Termux is
outdated and frequently fails to install packages correctly.

1. Install F-Droid from https://f-droid.org
2. Inside F-Droid, search for and install "Termux"
3. Open Termux

## 1. Set up Node.js in Termux

```bash
pkg update -y && pkg upgrade -y
pkg install nodejs-lts git -y
node -v   # should print a v20.x or v22.x version
npm -v
```

If `npm install` later fails with weird permission or native-build errors,
also install build tools:

```bash
pkg install python build-essential -y
```

## 2. Get the project onto your phone

If your repo is on GitHub:

```bash
cd ~
git clone https://github.com/your-username/thesis-ai.git
cd thesis-ai
```

If you don't have it on GitHub yet, you can `scp`/`adb push` the folder, or
zip it and download it via Termux's storage access — but GitHub is by far
the easiest path for repeated work.

## 3. Install dependencies

```bash
npm install
```

This installs `@stacks/transactions`, `@stacks/network`, and `@stacks/connect`
which are now regular dependencies (no more ad-hoc `npm install` before every
deploy like the old script required).

## 4. Run the contract test suite (recommended before any deploy)

```bash
cd contracts-workspace
npm install
npm test
```

You should see all tests pass, including the ones that intentionally
document the v1 vulnerability (those are *supposed* to pass — they're proof
the bug exists, not a sign something's broken). If `npm test` fails because
it can't reach the Hiro API to fetch the `nft-trait` requirement, make sure
Termux has internet access and retry — this only needs to succeed once,
after which it's cached locally.

```bash
cd ..   # back to project root
```

## 5. Get a wallet ready for deployment

You need a Stacks wallet with some STX to pay deployment fees. For testnet,
get free testnet STX from the faucet:

- Testnet faucet: https://explorer.hiro.so/sandbox/faucet?chain=testnet

You'll need the wallet's **private key** (not the seed phrase — the raw hex
private key). If you're using Leather or Xverse, both have a way to export
this from Settings → Advanced. Treat this like a password: never commit it,
never paste it into a public chat, never reuse a mainnet key for testing.

## 6. Deploy to testnet first

```bash
export STACKS_PRIVATE_KEY=your_testnet_private_key_here
export STACKS_NETWORK=testnet
node scripts/deploy-new-contracts.cjs
```

You should see output like:

```
Deploying thesis-certificate-v2 (testnet)...
Deployed thesis-certificate-v2: txid=0x...
Deploying thesis-review (testnet)...
Deployed thesis-review: txid=0x...
```

Copy both `txid` values. Check them on
`https://explorer.hiro.so/txid/<txid>?chain=testnet` and wait for them to
confirm (usually 1-2 Stacks blocks, a few minutes).

### Sanity-check on testnet

Before touching mainnet, manually exercise the new contracts on testnet:

1. Anchor a test thesis via `thesis-registry` (already live, same contract
   works on whichever network your wallet is pointed at).
2. Try minting a certificate through `thesis-certificate-v2` using the
   contract-owner key (your deploy key, before you transfer ownership to a
   backend wallet) — confirm it succeeds for a hash you *did* anchor, and
   fails (`ERR-NOT-HASH-OWNER`, error code 411) for one you didn't.
3. Submit a review through `thesis-review` from a second wallet, confirm
   self-review is rejected (error code 420).

## 7. Deploy to mainnet

Once you're confident from testnet testing:

```bash
export STACKS_PRIVATE_KEY=your_MAINNET_private_key_here
export STACKS_NETWORK=mainnet
node scripts/deploy-new-contracts.cjs
```

This costs real STX (deployment fees are usually a few STX per contract,
depending on contract size and current network fees). Confirm you have
enough balance first — the script will tell you if the broadcast fails due
to insufficient funds.

## 8. Update environment variables

After both contracts confirm on mainnet, set these (in `.env` for local dev,
and in your Vercel project settings for production):

```bash
VITE_STACKS_THESIS_NFT_V2=<your-deployer-address>.thesis-certificate-v2
VITE_STACKS_THESIS_REVIEW=<your-deployer-address>.thesis-review
```

## 9. Set up the backend signing wallet

Minting through `thesis-certificate-v2` is owner-gated and done by your
backend, not the user's wallet (see `contracts-workspace/contracts/thesis-certificate-v2.clar`
for why). You need a **separate, dedicated wallet** for this — do not reuse
your personal or deployer wallet's private key here, since this key will
live in your server's environment variables.

1. Generate a new wallet (Leather: "Create new wallet"; or use
   `@stacks/wallet-sdk` to generate one programmatically).
2. Fund it with a small amount of STX (enough to cover many mint
   transaction fees — a few STX is plenty to start).
3. Set its private key as `STACKS_BACKEND_PRIVATE_KEY` in your Vercel
   environment variables (never commit this to git).
4. Transfer contract ownership from your deployer address to this backend
   wallet's address, so it — not you manually — can call `mint` going
   forward:

```bash
# From Termux, using the Clarinet console or a short script — transfers
# ownership of thesis-certificate-v2 to the backend wallet address.
# Replace <BACKEND_ADDRESS> with the backend wallet's STX address.
```

You can do this transfer either via the Hiro Explorer's "Call function" UI
(connect your deployer wallet, call `set-contract-owner` with the backend
address as the argument) or via a short script using the same
`makeContractCall` pattern as `scripts/deploy-new-contracts.cjs`. The
Explorer UI is the simplest path from a phone.

## 10. Redeploy the frontend

```bash
git add -A
git commit -m "Deploy thesis-certificate-v2 and thesis-review contracts"
git push
```

If your Vercel project is connected to this repo, pushing triggers a
redeploy automatically and picks up the new environment variables.

## Troubleshooting

**`npm install` hangs or runs out of memory on an older phone** — try
`npm install --prefer-offline` after the first successful install, or
install dependencies one group at a time.

**Deploy script says "Deploy failed... NoSuchContract"** — this usually
means `thesis-registry` isn't deployed on the network you're targeting yet.
Since `thesis-certificate-v2` and `thesis-review` both call
`.thesis-registry` internally, that contract must already exist on whichever
network (testnet/mainnet) you're deploying to. It's already live on mainnet;
if you're testing on testnet, you'll need to deploy a testnet copy of
`thesis-registry` too (it's safe to do this, since it's a separate testnet
contract namespace — it has no effect on the live mainnet one).

**"Fee too low" or transaction stuck pending** — Stacks fees fluctuate; if a
transaction sits pending for a long time, you may need to deploy with a
manually-set higher fee. See the `@stacks/transactions` docs for the `fee`
option in `makeContractDeploy`.
