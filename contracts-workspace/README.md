# ThesisAI Smart Contracts (Clarinet workspace)

This folder is a self-contained Clarinet project for all of ThesisAI's
Clarity contracts. It is intentionally separate from the root `package.json`
(which is the Vite/React frontend) so contract tooling never conflicts with
frontend tooling.

## Contracts

| Contract | Status | Purpose |
|---|---|---|
| `thesis-registry.clar` | **Live on mainnet** | Anchors a thesis hash + title to its author's principal. Unchanged. |
| `thesis-certificate.clar` | **Live on mainnet, has a known bug** | v1 NFT certificate. `mint` has no caller check — see vulnerability tests below. Kept as-is; do not modify, it's already deployed. |
| `thesis-certificate-v2.clar` | **New, not yet deployed** | Fixed NFT certificate. `mint` is owner-gated AND requires the hash to be anchored to the exact `recipient` in `thesis-registry`. |
| `thesis-review.clar` | **New, not yet deployed** | Peer-review attestation layer. Reviewers rate (1-5) and comment on an anchored thesis hash. No self-review, no duplicate review per reviewer. |
| `nft-trait.clar` | Test-only helper | Local mirror of the official SIP-009 `nft-trait`, used only as an offline fallback (see note below). Not deployed, not registered as a contract dependency by default. |

## Why v1 is untouched

`thesis-certificate.clar` is already live on mainnet with existing token
holders. We never edit a deployed contract's source after the fact (Clarity
contracts are immutable on-chain anyway — editing the local file wouldn't
change what's deployed, it would just create confusion). Instead, the fix
lives in a new contract, `thesis-certificate-v2.clar`. Going forward, new
certificates should be minted through v2; v1 stays live for historical
holders.

## Running tests

```bash
npm install
npm test
```

This uses `@stacks/clarinet-sdk` + Vitest to run a simulated blockchain
(simnet) and execute `tests/*.test.ts`. No real network, tokens, or wallets
are involved.

### About the `nft-trait` requirement

`Clarinet.toml` declares a `requirements` entry pointing at the official
mainnet SIP-009 trait contract
(`SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait`). The first time you
run `npm test` (or `clarinet check`), Clarinet fetches that contract's source
from the Hiro API and caches it locally — this needs an internet connection
once.

If you're testing in an environment with no internet access at all (e.g. an
offline CI runner), there's a local mirror at `contracts/nft-trait.clar` with
identical content. To use it instead: change the `impl-trait` line in
`thesis-certificate.clar` and `thesis-certificate-v2.clar` from the mainnet
address to `.nft-trait.nft-trait`, and register `nft-trait` as a
`[contracts.*]` entry in `Clarinet.toml`. **Remember to revert this before
deploying for real** — production contracts must reference the actual
mainnet trait address, not a local one.

## Test coverage summary

- `thesis-registry.test.ts` - anchoring, duplicate-hash rejection, per-owner counts.
- `thesis-certificate-v1-vulnerability.test.ts` - **intentionally documents**
  the v1 access-control bug (anyone can mint to anyone, no ownership gate).
  These tests are expected to pass *because the bug exists* — they're proof
  of the issue, not a desired outcome.
- `thesis-certificate-v2.test.ts` - confirms the bug is fixed: non-owner mint
  rejected, unanchored-hash mint rejected, recipient/owner mismatch rejected,
  duplicate-certificate-per-hash rejected, ownership transfer works correctly.
- `thesis-review.test.ts` - rating bounds (1-5), self-review rejection,
  duplicate-review rejection, average rating calculation.

## Deploying

See the root `README.md` and the Termux deployment guide for step-by-step
instructions. In short:

```bash
clarinet deployments generate --testnet --medium-cost
clarinet deployments apply --testnet
# ...verify on testnet, then...
clarinet deployments generate --mainnet --medium-cost
clarinet deployments apply --mainnet
```

Never reuse the mnemonics in `settings/Devnet.toml` for a real wallet — they
are throwaway test phrases for the local simnet only.
