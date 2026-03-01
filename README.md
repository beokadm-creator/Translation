# Translation - Real-time Medical Conference Translation Platform

AI-powered real-time speech-to-text and multi-language captioning system for medical conferences.

## Overview

This platform provides real-time transcription, refinement, and translation for medical conferences using:
- **OpenAI Whisper** for speech-to-text (STT)
- **Google Gemini** for text refinement and medical terminology correction
- **Google Cloud Translate** for multi-language translation
- **Firebase** for real-time data synchronization and cloud backend

## Quick Start

### Prerequisites

- Node.js LTS (18+)
- Firebase CLI: `npm install -g firebase-tools`
- Git

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd Translation

# Install dependencies for all modules
npm install              # Root dependencies
cd client && npm install # Frontend dependencies
cd ../server && npm install # Express server dependencies
cd ../functions && npm install # Cloud Functions dependencies
```

### Development

Run all modules in parallel (recommended):
```bash
cd functions
npm run dev
```

This starts:
- Client dev server (Vite) at `http://localhost:5173`
- Express server (Socket.IO) at `http://localhost:3000`
- Functions dev server with hot reload

Run individual modules:
```bash
# Client only
cd client && npm run dev

# Server only
cd server && npm run dev

# Functions only
cd functions && npm run server:dev
```

### Build

```bash
# Client production build
cd client && npm run build

# Functions build
cd functions && npm run build

# Server TypeScript compilation
cd server && npx tsc -p tsconfig.json
```

### Deployment

```bash
# Build client for production
cd client && npm run build

# Deploy to Firebase (from root)
firebase deploy
```

See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed deployment instructions.

## Project Structure

```
Translation/
├── client/          # React + Vite frontend (TypeScript)
├── server/          # Express + Socket.IO server (TypeScript)
├── functions/       # Firebase Cloud Functions (TypeScript)
├── firebase/        # Firebase configuration (rules, indexes)
└── docs/            # Project documentation
```

## Documentation

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - System architecture, data flow, and technology stack
- **[DEVELOPMENT.md](docs/DEVELOPMENT.md)** - Development setup, workflow, and common tasks
- **[DEPLOYMENT.md](docs/DEPLOYMENT.md)** - Firebase deployment and environment configuration
- **[API.md](docs/API.md)** - API endpoints, WebSocket events, and data schemas
- **[AGENTS.md](AGENTS.md)** - AI Agent guidelines and code style reference

## Technology Stack

### Frontend
- React 19.2.0 + TypeScript
- Vite (build tool)
- TailwindCSS (styling)
- Firebase JS SDK (Auth, Firestore, Realtime DB, Storage, Functions)
- React Router 7.11.0
- Socket.IO Client 4.8.3

### Backend
- Express 5.x + TypeScript
- Socket.IO 4.x
- OpenAI SDK (Whisper STT)
- Google Gemini API (text refinement)
- Google Cloud Translate (multi-language translation)
- Google Text-to-Speech (TTS)

### Firebase Services
- **Firestore** - Project settings and configuration
- **Realtime Database** - Live transcripts and session state
- **Cloud Functions** - Serverless backend (Node.js 20)
- **Firebase Auth** - User authentication
- **Firebase Storage** - Audio assets and TTS outputs
- **Firebase Hosting** - Frontend hosting

## Data Flow

```
Audio Input (Admin)
    ↓
HTTP POST to Cloud Function (processAudio)
    ↓
OpenAI Whisper (STT)
    ↓
Realtime Database (/projects/{id}/stream)
    ↓
Gemini Refinement (medical terminology)
    ↓
Google Cloud Translate (multi-language)
    ↓
Realtime Database Update
    ↓
Client Subscription (AudienceView, OverlayView)
```

## Key Features

- **Real-time Transcription** - Live speech-to-text with 3-second chunking
- **Medical Terminology Refinement** - AI-powered correction using Gemini
- **Multi-language Support** - Real-time translation to Korean, English, Japanese, etc.
- **Caption Overlay** - OBS-compatible overlay display
- **Admin Dashboard** - Conference and session management
- **Archive & Remaster** - Post-processing transcript refinement

## Environment Variables

Create `functions/.env` for local development:

```bash
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
GOOGLE_TTS_API_KEY=...
GOOGLE_API_KEY=...
NODE_ENV=development
```

**⚠️ Security**: Never commit `.env` files. Use Firebase Functions config or Secret Manager for production.

## Common Commands

| Task | Command |
|------|---------|
| Install all dependencies | `npm install && cd client && npm install && cd ../server && npm install && cd ../functions && npm install` |
| Start all dev servers | `cd functions && npm run dev` |
| Build for production | `cd client && npm run build` |
| Lint code | `cd client && npm run lint` or `cd functions && npm run lint` |
| Type check | `cd functions && npm run check` |
| Deploy to Firebase | `firebase deploy` |
| Start Firebase emulators | `firebase emulators:start` |

## Contributing

See [AGENTS.md](AGENTS.md) for code style guidelines and development practices.

## License

Proprietary - Medical Conference Translation System
