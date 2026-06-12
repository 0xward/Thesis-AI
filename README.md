# ThesisAI — Autonomous Research Agent

> Turn raw research sources into a polished, on-chain verified thesis — in minutes.

ThesisAI is a full-stack Web3 academic research platform built on the **Stacks blockchain**. It combines Groq-powered AI models, citation-aware drafting, multi-format export, and Stacks smart contracts to give students and researchers a workspace that goes from raw sources to structured academic work — with verifiable on-chain provenance.

---

## Features

### AI Research Engine
- **Groq AI Model Mesh** — automatically routes tasks across Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill, and fast fallback models based on server load
- Generates titles, chapter structures, content, references, and revisions in one workspace
- Modular chapter writer — generate each chapter independently with streaming output

### Source Ingestion
- Upload **PDF**, **TXT**, **MD** files as a knowledge base
- Paste a URL — auto-fetch and parse article content
- Paste raw text as a research source
- All sources become guided AI context before generation

### Multi-Format Export
- **DOCX** — print-ready / submission-ready Word document
- **PDF** — rendered via html2pdf
- **PPTX** — auto-generated presentation from thesis structure

### Stacks Web3 Layer
- **Wallet Connect** — supports Leather & Xverse on Stacks mainnet
- **$THESIS Token** — SIP-010 fungible token on Stacks mainnet
- **Anchor Thesis** — SHA-256 hash of thesis anchored to the blockchain via Clarity smart contract
- **NFT Certificate** — mint a `ThesisCertificate` NFT as verifiable proof of authorship
- **Token-gated features** — holders of ≥10,000 $THESIS unlock Full Research mode

### Cloud Save (Firebase)
- Google Sign-In to save and reload thesis drafts
- Personal dashboard library — manage all drafts from one place
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
| AI | Groq API — Llama 3.3 70B, Qwen3 32B, DeepSeek R1 Distill |
| Blockchain | Stacks mainnet, Clarity smart contracts |
| Wallet | Leather, Xverse (via `window.LeatherProvider` / `window.XverseProviders`) |
| Chain API | Hiro API (`api.hiro.so`) |
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
│   ├── App.tsx                      # Main app — UI, routing, all views
│   ├── Web3Provider.tsx             # Stacks wallet context (detect, connect, sign tx)
│   ├── thesisPersistenceService.ts  # Firestore CRUD for thesis drafts
│   ├── components/
│   │   ├── ChatAssistant.tsx        # AI chat sidebar
│   │   ├── DonateAction.tsx         # STX transfer widget
│   │   └── ModularChapterWriter.tsx # Per-chapter streaming generator
│   ├── services/
│   │   └── aiService.ts             # Groq API calls and prompt engineering
│   └── lib/
│       ├── firebase.ts              # Firebase init (Auth + Firestore)
│       ├── stacksContracts.ts       # Contract addresses and Hiro API helpers
│       └── utils.ts                 # Utility: cn() classname merger
├── api/
│   └── index.ts                     # Express server — Groq proxy, PDF/URL parser
├── contracts/
│   ├── thesis-registry.clar         # Clarity: anchor thesis hash on-chain
│   └── thesis-certificate.clar      # Clarity: mint NFT certificate
├── scripts/
│   └── deploy-contracts.cjs         # Deploy Clarity contracts to Stacks mainnet
├── index.html
├── vite.config.ts
├── vercel.json
└── .env.example
```

---

## Setup & Development

### 1. Clone and Install

```bash
git clone https://github.com/your-username/thesis-ai.git
cd thesis-ai
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Fill in the required values:

```env
# Groq AI (required) — https://console.groq.com
GROQ_API_KEY=your_groq_api_key_here

# Firebase (required for Save/Login) — https://console.firebase.google.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_DATABASE_ID=(default)
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id

# Stacks — contracts are live on mainnet
VITE_STACKS_DONATION_ADDRESS=SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF
VITE_STACKS_THESIS_REGISTRY=SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-registry
VITE_STACKS_THESIS_NFT=SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-certificate
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

---

## Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com) → create a new project
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

Both contracts are deployed and live on **Stacks mainnet**.

| Contract | Address |
|---|---|
| Thesis Registry | `SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-registry` |
| Thesis Certificate NFT | `SPQ189E66S20X7ATY7794HBY6743JE9YJMCKHAEF.thesis-certificate` |

### thesis-registry.clar

Stores a SHA-256 hash of the thesis document on-chain as immutable proof of existence.

```clarity
;; Anchor a thesis hash — callable once per hash
(anchor-thesis (hash (buff 32)) (title (string-utf8 200)))

;; Read proof for any hash
(get-proof (hash (buff 32)))

;; Get total anchored count for an address
(get-thesis-count (owner principal))
```

### thesis-certificate.clar

Issues a non-fungible token (NFT) as proof of authorship, implementing the SIP-009 NFT trait.

```clarity
;; Mint a certificate NFT to a recipient
(mint (recipient principal) (thesis-hash (buff 32)) (metadata-uri (string-ascii 256)))

;; Transfer certificate to another address
(transfer (token-id uint) (sender principal) (recipient principal))
```

---

## Deploy to Vercel

1. Push repository to GitHub
2. Import project at [vercel.com](https://vercel.com)
3. Add all environment variables from `.env` in the Vercel dashboard
4. Deploy — Vercel auto-detects config from `vercel.json`

> `VERCEL_TOOLBAR_ENABLED=0` is set in `vercel.json` to disable the Vercel toolbar in production.

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
- Hold ≥10,000 $THESIS → unlocks Full Research (Comprehensive) mode
- Planned: reward certificate minters with $THESIS distributions
- Planned: governance over platform roadmap

---

## Roadmap

- [x] Groq AI multi-model routing
- [x] Source ingestion (PDF, URL, Text, MD)
- [x] Thesis generation and export (DOCX, PDF, PPTX)
- [x] Firebase auth and Firestore persistence
- [x] Stacks wallet integration (Leather, Xverse)
- [x] $THESIS token and live holder tracking
- [x] Clarity smart contract: thesis-registry (live on mainnet)
- [x] Clarity smart contract: NFT certificate (live on mainnet)
- [x] Multilingual UI (English / Bahasa Indonesia)
- [ ] On-chain anchor UI — full hash verification flow
- [ ] sBTC incentive layer
- [ ] Reviewer badge NFT
- [ ] Governance voting via $THESIS

---

## Compatibility

| Platform | Status |
|---|---|
| Desktop Chrome / Edge | ✅ Full support — Leather and Xverse extensions |
| Desktop Firefox | ✅ Full support — Leather extension |
| Desktop Safari | ⚠️ Limited wallet extension support |
| Mobile Chrome (Android) | ✅ Responsive UI — use Xverse in-app browser for wallet |
| Mobile Safari (iOS) | ✅ Responsive UI — use Leather or Xverse in-app browser for wallet |

---

## Feedback

Have a feature request or found a bug? Send suggestions to:

**0xward.dev@gmail.com**

Or use the **Suggest a Feature** button in the bottom-right corner of the app.

---

## License

MIT © 2026 ThesisAI — Built on the Stacks Layer for verifiable research provenance.
