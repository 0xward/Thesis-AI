<img width="1744" height="560" alt="1000117517" src="https://github.com/user-attachments/assets/2082b07e-9b05-4af9-b894-e8b0b184ce72" />


# ThesisAI: Research Agent

An elite autonomous AI Research Agent specialized in transforming journals, academic papers, and PDFs into fully structured thesis-quality academic documents.

## Features

- **Automated Structure Generation**: Generate comprehensive academic thesis structures based on your research topic.
- **Content Drafting**: Leverage Gemini AI to draft content for specific chapters.
- **Research Source Persistence**: Manage and track research sources directly within the dashboard.
- **Real-time Metrics**: Track platform usage with a real-time visitor counter.
- **Easy Export/Share**: Share your thesis projects effortlessly.

## Tech Stack

- **Frontend**: React, Vite, Tailwind CSS
- **Backend/Services**: Node.js, Express (proxy/server)
- **Database/Auth**: Firebase Firestore & Authentication
- **AI**: Google Gemini API
- **Web3**: Celo, MiniPay, Wagmi & Viem

## Web3 Integration

ThesisAI is integrated with the Celo blockchain and optimized for **MiniPay** (Opera Mini's built-in wallet).

- **MiniPay Optimized**: Automatic detection and seamless connection when used inside the MiniPay browser.
- **Support Feature**: Users can support development by sending CELO directly to the developer's wallet.
- **WalletConnect Integration**: Utilizes WalletConnect for secure and reliable connection handling.

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm
- **WalletConnect Project ID**: Required for Web3 functionality (get one at [cloud.walletconnect.com](https://cloud.walletconnect.com/)).

### Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```

### Environment Variables

Create a `.env` file based on `.env.example` and populate the required keys:

- `GEMINI_API_KEY`: Google Gemini API key.
- `VITE_WALLET_CONNECT_PROJECT_ID`: Your WalletConnect Project ID.
- `VITE_CELO_WALLET_ADDRESS`: Target CELO wallet address for support payments.

### Firebase Configuration

Since `firebase-applet-config.json` contains public API keys (which GitHub's scanner may flag), it is excluded from the repository. 
To run this project locally, you must create a `firebase-applet-config.json` file in the root directory with the following structure:

```json
{
  "projectId": "your-project-id",
  "appId": "your-app-id",
  "apiKey": "AIza...",
  "authDomain": "your-project.firebaseapp.com",
  "firestoreDatabaseId": "your-db-id",
  "storageBucket": "your-project.firebasestorage.app",
  "messagingSenderId": "your-sender-id",
  "measurementId": ""
}
```

### Development

Start the development server:
```bash
npm run dev
```

## Contributing

Contributions are welcome! Please open an issue to discuss proposed changes.

## License

MIT
