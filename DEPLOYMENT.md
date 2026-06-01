# ThesisAI Deployment Handoff

This guide keeps deployment notes outside `README.md` and focuses on the fastest path for pushing the latest ThesisAI build from an Android phone with Termux, then deploying it through GitHub, GitLab, or Vercel.

## 1. Download and extract the project zip

Download `ThesisAI-Research-Agent-submit.zip` to the Android `Download` folder, then run:

```bash
pkg update -y
pkg install git unzip nodejs-lts -y
termux-setup-storage
cd ~
rm -rf ThesisAI-Research-Agent
mkdir ThesisAI-Research-Agent
unzip ~/storage/downloads/ThesisAI-Research-Agent-submit.zip -d ThesisAI-Research-Agent
cd ThesisAI-Research-Agent
```

If `package.json` is not visible after `cd ThesisAI-Research-Agent`, run `find . -maxdepth 2 -name package.json -print` and move into the directory that contains it.

## 2. Verify the extracted source before pushing

The project root must contain these files and folders:

```text
.env.example
package.json
package-lock.json
server.ts
src/
vite.config.ts
vercel.json
```

The latest Stacks and Groq build should also contain:

```text
src/components/StacksWallet.tsx
src/services/aiService.ts
```

Do not upload or commit these folders/files:

```text
node_modules/
dist/
.git/
.env
.env.local
```

## 3. Push to GitHub main from Termux

Configure Git once:

```bash
git config --global user.name "fafaonchain"
git config --global user.email "YOUR_GITHUB_EMAIL"
```

Initialize and push the extracted source:

```bash
git init
git add .
git commit -m "Deploy latest ThesisAI research agent"
git branch -M main
git remote add origin https://github.com/fafaonchain/ThesisAI-Research-Agent.git
git push -u origin main --force
```

If `origin` already exists, replace the remote URL:

```bash
git remote set-url origin https://github.com/fafaonchain/ThesisAI-Research-Agent.git
git push -u origin main --force
```

Use a GitHub Personal Access Token with `repo` scope when Git asks for a password.

## 4. Import to GitLab or connect Vercel

After GitHub `main` has the latest source, import the repository into GitLab or connect Vercel directly to GitHub. Make sure the production branch is `main`.

Required Vercel environment variables:

```env
GROQ_API_KEY=your_groq_key
GROQ_PRIMARY_MODEL=llama-3.3-70b-versatile
GROQ_FALLBACK_MODELS=qwen/qwen3-32b,deepseek-r1-distill-llama-70b,llama-3.1-8b-instant
```

Optional Firebase variables for login, saved drafts, and visitor tracking:

```env
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_DATABASE_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
```

## 5. Final deployment check

Before submitting or redeploying, confirm:

- `src/components/StacksWallet.tsx` exists for Stacks wallet connection and donation support.
- `.env.example` includes Groq variables.
- Vercel uses branch `main`.
- Vercel redeploy is run without build cache after a large branch replacement.
