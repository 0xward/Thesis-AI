# ThesisAI - Autonomous Research Agent

> Turn raw research sources into a polished, on-chain verified thesis - in minutes.

ThesisAI is a full-stack Web3 academic research platform built on the **Stacks blockchain**. It combines Groq-powered AI models, citation-aware drafting, multi-format export, and Stacks smart contracts to give students and researchers a workspace that goes from raw sources to structured academic work - with verifiable on-chain provenance.

---

## Features

### AI Research Engine
- **Groq AI Model Mesh** - automatically routes tasks across Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill, and fast fallback models based on server load
- Generates titles, chapter structures, content, references, and revisions in one workspace
- Modular chapter writer - generate each chapter independently with streaming output

### Source Ingestion
- Upload **PDF**, **TXT**, **MD** files as a knowledge base
- Paste a URL - auto-fetch and parse article content
- Paste raw text as a research source
- All sources become guided AI context before generation

### Multi-Format Export
- **DOCX** - print-ready / submission-ready Word document
- **PDF** - rendered via html2pdf
- **PPTX** - auto-generated presentation from thesis structure

### Stacks Web3 Layer
- **Wallet Connect** - via the official `@stacks/connect` library, supporting Leather, Xverse, and any other SIP-030-compatible wallet on Stacks mainnet
- **$THESIS Token** - SIP-010 fungible token on Stacks mainnet
- **Anchor Thesis** - SHA-256 hash of thesis anchored to the blockchain via Clarity smart contract
- **NFT Certificate (v2)** - mint a `thesis-certificate-v2` NFT as verifiable proof of authorship, issued by the backend only after confirming the hash is anchored to the claiming address (see Migration section below)
- **Peer Review** - anyone with a wallet can rate (1-5) and comment on an anchored thesis via `thesis-review`; no self-review, no duplicate reviews per reviewer
- **Verify Thesis** - public, walletless lookup: paste a hash (or the original text) and see its anchor proof, certificate status, and review stats straight from mainnet
- **Token-gated features** - holders of >=1,000 $THESIS unlock full platform access

### Cloud Save (Firebase)
- Google Sign-In to save and reload thesis drafts
- Personal dashboard library - manage all drafts from one place
- Revisions saved with timestamps

### Multilingual UI
- Interface available in **English** and **Bahasa Indonesia**
- Thesis output can target any language (English, Indonesian, Malay, Arabic, and more)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS v4, Vite 6 |
| Animation | Motion (Framer Motion) |
| AI | Groq API - Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill |
| Blockchain | Stacks mainnet, Clarity smart contracts |
| Wallet | `@stacks/connect` (Leather, Xverse, and any SIP-030 wallet) |
| Transactions | `@stacks/transactions`, `@stacks/network` |
| Chain API | Hiro API (`api.hiro.so`) |
| Contract testing | Clarinet SDK + Vitest (`contracts-workspace/`) |
| Auth | Firebase Authentication (Google Sign-In) |
| Database | Firebase Firestore |
| Export | html-to-docx, html2pdf.js, pptxgenjs |
| Backend | Express.js + Vercel Serverless Functions |
| Deploy | Vercel |

---

## Project Structure

```
thesis-ai/
├── src/
│   ├── App.tsx                      # Main app - UI, routing, all views
│   ├── Web3Provider.tsx             # Stacks wallet context (@stacks/connect)
│   ├── thesisPersistenceService.ts  # Firestore CRUD for thesis drafts
│   ├── components/
│   │   ├── ChatAssistant.tsx        # AI chat sidebar
│   │   ├── ReviewAction.tsx         # Submit an on-chain peer review
│   │   ├── VerifyThesisModal.tsx    # Public, walletless thesis verification
│   │   └── ModularChapterWriter.tsx # Per-chapter streaming generator
│   ├── services/
│   │   └── aiService.ts             # Groq API calls and prompt engineering
│   └── lib/
│       ├── firebase.ts              # Firebase init (Auth + Firestore)
│       ├── stacksContracts.ts       # Contract addresses and Hiro API helpers
│       └── utils.ts                 # Utility: cn() classname merger
├── api/
│   └── index.ts                     # Express server - Groq proxy, PDF/URL parser, certificate minting
├── contracts-workspace/              # Clarinet project: contracts, tests, deployment config
│   ├── Clarinet.toml
│   ├── contracts/
│   │   ├── thesis-registry.clar         # Live on mainnet - anchor thesis hash
│   │   ├── thesis-certificate.clar      # Live on mainnet (v1, deprecated - see Migration)
│   │   ├── thesis-certificate-v2.clar   # Live on mainnet (v2, current) - mint NFT certificate
│   │   ├── thesis-review.clar           # Live on mainnet - peer-review attestations
│   │   └── nft-trait.clar               # Local SIP-009 trait mirror, offline test fallback only
│   └── tests/                       # Vitest + Clarinet SDK test suite
├── scripts/
│   ├── deploy-new-contracts.cjs     # Deploy thesis-certificate-v2 + thesis-review
│   └── deploy-contracts.legacy.cjs.bak  # Old v1 deploy script, kept for reference only
├── index.html
├── vite.config.ts
├── vercel.json
├── DEPLOY_TERMUX.md                  # Step-by-step contract deployment guide from Termux
└── .env.example
```

---

## Migration: thesis-certificate v1 to v2

`thesis-certificate.clar` (v1) shipped with a real access-control bug: its `mint` function had no caller restriction at all, meaning anyone could mint a certificate to any recipient for any hash, with no proof the hash was ever anchored. This was found, documented with automated tests, and fixed - not patched in place, since v1 was already live on mainnet with existing token holders, and Clarity contracts are immutable once deployed anyway.

**v1 (`thesis-certificate.clar`) is left untouched and still live.** Its existing certificates and holders are unaffected. We do not delete or hide it - it stays as part of the project's on-chain history.

**v2 (`thesis-certificate-v2.clar`) is a new, separate contract** that all new certificate mints go through from now on. It closes the gap with two checks: only the backend (contract owner) may call `mint`, and the hash must already be anchored in `thesis-registry` under the exact recipient being minted to - so a certificate can only ever be issued to the address that actually anchored that thesis.

Alongside v2, a new `thesis-review.clar` contract was added for peer-review attestations - a natural extension of `thesis-registry` that lets reviewers rate and comment on an anchored thesis on-chain, with no self-review and no duplicate reviews per reviewer.

See `contracts-workspace/tests/thesis-certificate-v1-vulnerability.test.ts` for tests that intentionally reproduce the v1 bug (proof it exists), and `thesis-certificate-v2.test.ts` for tests confirming the fix.

---

## Setup & Development

### 1. Clone and Install

```bash
git clone https://github.com/0xward/Thesis-AI.git
cd Thesis-AI
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Fill in the required values:

```env
# Groq AI (required) - https://console.groq.com
GROQ_API_KEY=your_groq_api_key_here

# Firebase (required for Save/Login) - https://console.firebase.google.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_DATABASE_ID=(default)
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id

# Stacks - contracts are live on mainnet
VITE_STACKS_DONATION_ADDRESS=SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF
VITE_STACKS_THESIS_REGISTRY=SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-registry
VITE_STACKS_THESIS_NFT=SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-certificate
VITE_STACKS_THESIS_NFT_V2=SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-certificate-v2
VITE_STACKS_THESIS_REVIEW=SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-review

# Backend signing wallet (server-side only - required for certificate minting)
STACKS_BACKEND_PRIVATE_KEY=your_backend_wallet_private_key_here
STACKS_NETWORK=mainnet
```

### 3. Run Development Server

```bash
npm run dev
```

App runs at `http://localhost:5173` (frontend) and `http://localhost:3000` (API backend).

### 4. Build for Production

```bash
npm run build
```

### 5. Run Contract Tests

```bash
cd contracts-workspace
npm install
npm test
```

See `contracts-workspace/README.md` for details on the test suite and the offline fallback for the SIP-009 trait dependency.

---

## Firebase Setup

1. Go to Firebase Console (console.firebase.google.com) and create a new project
2. **Authentication** → Sign-in method → enable **Google**
3. Add your deployed domain under: Authentication → Settings → Authorized domains
4. **Firestore** → create database → select a region (e.g. `asia-southeast2` for Indonesia)
5. Deploy Firestore rules:
   ```bash
   firebase deploy --only firestore:rules
   ```
6. Copy all config values to `.env`

> **Note:** Ensure `VITE_FIREBASE_DATABASE_ID` matches your actual Firestore database ID. Use `(default)` unless you created a named database.

---

## Stacks Smart Contracts

All contracts below are deployed and live on **Stacks mainnet**.

| Contract | Address | Status |
|---|---|---|
| Thesis Registry | `SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-registry` | Live, current |
| Thesis Certificate (v1) | `SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-certificate` | Live, deprecated - see Migration section |
| Thesis Certificate (v2) | `SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-certificate-v2` | Live, current |
| Thesis Review | `SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-review` | Live, current |

### thesis-registry.clar

Stores a SHA-256 hash of the thesis document on-chain as immutable proof of existence.

```clarity
;; Anchor a thesis hash - callable once per hash
(anchor-thesis (hash (buff 32)) (title (string-utf8 200)))

;; Read proof for any hash
(get-proof (hash (buff 32)))

;; Get total anchored count for an address
(get-thesis-count (owner principal))
```

### thesis-certificate-v2.clar

Issues a non-fungible token (NFT) as proof of authorship, implementing the SIP-009 NFT trait. Minting is performed by the backend only, after independently verifying the hash is anchored to the claiming recipient.

```clarity
;; Mint a certificate NFT - owner-gated, requires the hash to already be
;; anchored to `recipient` in thesis-registry
(mint (recipient principal) (thesis-hash (buff 32)) (metadata-uri (string-ascii 256)))

;; Transfer certificate to another address
(transfer (token-id uint) (sender principal) (recipient principal))

;; Look up the certificate token-id already issued for a given hash, if any
(get-certificate-for-hash (thesis-hash (buff 32)))
```

### thesis-review.clar

Lets any wallet attest to an already-anchored thesis with a 1-5 rating and a short comment. No self-review, no duplicate reviews per reviewer per hash.

```clarity
;; Submit a review for an anchored thesis hash
(submit-review (thesis-hash (buff 32)) (rating uint) (comment (string-utf8 280)))

;; Read a specific reviewer's review for a hash
(get-review (thesis-hash (buff 32)) (reviewer principal))

;; Read aggregate stats (total rating, review count) for a hash
(get-review-stats (thesis-hash (buff 32)))
```

### thesis-certificate.clar (v1, deprecated)

Kept live for historical holders only. Do not mint new certificates through this contract - its `mint` function has no caller restriction. See the Migration section above.

---

## Deploy to Vercel

1. Push repository to GitHub
2. Import project at vercel.com
3. Add all environment variables from `.env` in the Vercel dashboard, including `STACKS_BACKEND_PRIVATE_KEY` for a dedicated backend signing wallet
4. Deploy - Vercel auto-detects config from `vercel.json`

> `VERCEL_TOOLBAR_ENABLED=0` is set in `vercel.json` to disable the Vercel toolbar in production.

For deploying the Clarity contracts themselves (not the web app), see `DEPLOY_TERMUX.md` for a full walkthrough, including doing it from an Android phone via Termux.

---

## $THESIS Token

| Property | Value |
|---|---|
| Name | ThesisAI |
| Ticker | $THESIS |
| Total Supply | 999,000,000 |
| Standard | SIP-010 Fungible Token |
| Contract | `SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesisai` |
| Network | Stacks Mainnet |
| Decimals | 6 |

**Token utility:**
- Hold >=1,000 $THESIS to unlock full platform access
- Planned: reward certificate minters and reviewers with $THESIS distributions
- Planned: governance over platform roadmap

---

## Roadmap

- [x] Groq AI multi-model routing
- [x] Source ingestion (PDF, URL, Text, MD)
- [x] Thesis generation and export (DOCX, PDF, PPTX)
- [x] Firebase auth and Firestore persistence
- [x] Stacks wallet integration via `@stacks/connect` (Leather, Xverse, any SIP-030 wallet)
- [x] $THESIS token and live holder tracking
- [x] Clarity smart contract: thesis-registry (live on mainnet)
- [x] Clarity smart contract: NFT certificate v1 to v2 migration, access-control bug fixed
- [x] Clarity smart contract: thesis-review peer-review attestations (live on mainnet)
- [x] Verify Thesis - public, walletless on-chain lookup page
- [x] Multilingual UI (English / Bahasa Indonesia)
- [ ] sBTC incentive layer
- [ ] Governance voting via $THESIS

---

## Compatibility

| Platform | Status |
|---|---|
| Desktop Chrome / Edge | Full support - Leather and Xverse extensions |
| Desktop Firefox | Full support - Leather extension |
| Desktop Safari | Limited wallet extension support |
| Mobile Chrome (Android) | Responsive UI - use Xverse or Leather in-app browser for wallet |
| Mobile Safari (iOS) | Responsive UI - use Leather or Xverse in-app browser for wallet |

---

## Feedback

Have a feature request or found a bug? Send suggestions to:

**0xward.dev@gmail.com**

Or use the **Suggest a Feature** button in the bottom-right corner of the app.

---

## License

MIT License

Copyright (c) 2026 ThesisAI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Built on the Stacks Layer for verifiable research provenance.
