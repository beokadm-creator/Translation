# Development Guide

Complete development workflow for the Translation platform - from local setup to common tasks.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Running Development Servers](#running-development-servers)
- [Building](#building)
- [Linting & Type Checking](#linting--type-checking)
- [Testing](#testing)
- [Environment Configuration](#environment-configuration)
- [Common Development Tasks](#common-development-tasks)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| Node.js | 18+ LTS | JavaScript runtime |
| npm | 9+ | Package manager |
| Git | Latest | Version control |
| Firebase CLI | Latest | Firebase deployment/emulators |

### Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

## Initial Setup

### 1. Clone Repository

```bash
git clone <repository-url>
cd Translation
```

### 2. Install Dependencies

```bash
# Install root dependencies
npm install

# Install client dependencies
cd client && npm install && cd ..

# Install server dependencies
cd server && npm install && cd ..

# Install functions dependencies
cd functions && npm install && cd ..
```

**Quick one-liner:**
```bash
npm install && cd client && npm install && cd ../server && npm install && cd ../functions && npm install
```

### 3. Configure Environment Variables

Create `functions/.env`:

```bash
# OpenAI API Key (Whisper STT)
OPENAI_API_KEY=sk-...

# Google Gemini API Key (text refinement)
GEMINI_API_KEY=...

# Google Cloud TTS API Key
GOOGLE_TTS_API_KEY=...

# Google Cloud API Key (Translate)
GOOGLE_API_KEY=...

# Environment
NODE_ENV=development
```

**⚠️ Security**: Never commit `.env` files. They are already in `.gitignore`.

### 4. Firebase Project Setup

```bash
# List Firebase projects
firebase projects:list

# Set default project (if needed)
firebase use translation-comm

# Or create a new project
firebase projects:create
```

## Running Development Servers

### Option 1: Run All Modules (Recommended)

Start all three modules in parallel:

```bash
cd functions
npm run dev
```

This starts:
- **Client**: Vite dev server at `http://localhost:5173`
- **Server**: Express server at `http://localhost:3000`
- **Functions**: Nodemon watching `functions/src/`

Access the application at `http://localhost:5173`.

### Option 2: Run Individual Modules

#### Client Only

```bash
cd client
npm run dev
```

Opens Vite dev server at `http://localhost:5173` with hot module replacement.

#### Server Only

```bash
cd server
npm run dev
```

Starts Express server at `http://localhost:3000` with Socket.IO.

#### Functions Only

```bash
cd functions
npm run server:dev
```

Starts Cloud Functions emulator with hot reload via nodemon.

### Firebase Emulators (Optional)

For local Firebase testing:

```bash
firebase emulators:start
```

Starts emulators for:
- Firestore
- Realtime Database
- Firebase Auth
- Cloud Functions
- Firebase Storage

Access Firebase Emulator UI at `http://localhost:4000`.

## Building

### Client Production Build

```bash
cd client
npm run build
```

**Process:**
1. TypeScript type check (`tsc -b`)
2. Vite bundling (`vite build`)
3. Output: `client/dist/`

**Preview production build:**
```bash
cd client
npm run preview
```

### Functions Build

```bash
cd functions
npm run build
```

Compiles TypeScript to `lib/` using `tsconfig.functions.json`.

**Build all (client + functions):**
```bash
cd functions
npm run build:all
```

### Server Build

Server doesn't have a build script. To compile TypeScript:

```bash
cd server
npx tsc -p tsconfig.json
```

Output: `server/dist/`

## Linting & Type Checking

### Client

```bash
cd client

# Lint
npm run lint

# Type check (via build)
npx tsc -p tsconfig.app.json --noEmit
```

### Functions

```bash
cd functions

# Lint
npm run lint

# Type check
npm run check
```

### Server

Server has no lint script. Run manually:

```bash
cd server

# Lint (if ESLint is installed)
npx eslint .

# Type check
npx tsc -p tsconfig.json --noEmit
```

## Testing

**Current Status**: No automated tests are configured.

To add tests:

```bash
# Install Vitest (recommended for Vite projects)
cd client
npm install -D vitest @vitest/ui

# Install Jest (alternative)
npm install -D jest @types/jest ts-jest
```

Then add test scripts to `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui"
  }
}
```

## Environment Configuration

### Local Development

Environment variables are loaded from `functions/.env` via `dotenv`.

**Required Variables:**

| Variable | Purpose | Example |
|----------|---------|---------|
| `OPENAI_API_KEY` | Whisper STT | `sk-...` |
| `GEMINI_API_KEY` | Text refinement | `AI...` |
| `GOOGLE_TTS_API_KEY` | Text-to-speech | `AI...` |
| `GOOGLE_API_KEY` | Cloud Translate | `AI...` |
| `NODE_ENV` | Environment | `development` |

### Production (Firebase)

For production, use Firebase Functions config or Secret Manager:

```bash
# Set config values
firebase functions:config:set openai.key="sk-..." gemini.key="AI..."

# Or use Secret Manager (recommended for secrets)
echo "sk-..." | firebase functions:secrets:set OPENAI_API_KEY
```

Access in code:

```javascript
// Via config
const apiKey = functions.config().openai.key;

// Via Secret Manager (recommended)
const apiKey = process.env.OPENAI_API_KEY;
```

### Firebase Client Config

Client-side Firebase config is in `client/src/firebase.ts`:

```typescript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "translation-comm.firebaseapp.com",
  projectId: "translation-comm",
  databaseURL: "https://translation-comm-default-rtdb.firebaseio.com",
  storageBucket: "translation-comm.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

**Note**: These keys are exposed in client code. This is normal for Firebase - security is enforced via [Security Rules](../database.rules.json).

## Common Development Tasks

### Add New Cloud Function

1. Create function in `functions/src/`:

```typescript
// functions/src/myFunction.ts
import * as functions from "firebase-functions/v2/http";

export const myFunction = onRequest(async (req, res) => {
  functions.logger.info("My function called");
  res.json({ success: true });
});
```

2. Export in `functions/src/index.ts`:

```typescript
export { myFunction } from './myFunction';
```

3. Test locally:

```bash
cd functions
npm run server:dev
curl http://localhost:5001/translation-comm/us-central1/myFunction
```

### Add New React Component

1. Create component in `client/src/components/`:

```typescript
// client/src/components/MyComponent.tsx
import React from 'react';

export const MyComponent: React.FC<{ prop1: string }> = ({ prop1 }) => {
  return <div>{prop1}</div>;
};
```

2. Use in other components:

```typescript
import { MyComponent } from './components/MyComponent';
```

### Update Database Schema

1. Modify types in `client/src/types/index.ts`:

```typescript
export interface StreamSegment {
  id: string;
  original: string;
  refined: string;
  timestamp: string;
  // Add new fields
}
```

2. Update security rules (`database.rules.json`, `firestore.rules`)

3. Test in Firebase emulators:

```bash
firebase emulators:start
```

### Change Firebase Project

```bash
# List available projects
firebase projects:list

# Switch project
firebase use <project-id>

# Verify
firebase use
```

### Clear Firebase Emulator Data

```bash
# Clear all emulator data
firebase emulators:start --only firestore,database
# Then in another terminal:
firebase firestore:delete --all-collections
```

## Troubleshooting

### Port Already in Use

**Error**: `Port 5173 is already in use`

**Solution**:
```bash
# Find process
lsof -i :5173  # macOS/Linux
netstat -ano | findstr :5173  # Windows

# Kill process
kill -9 <PID>  # macOS/Linux
taskkill /PID <PID> /F  # Windows
```

### Firebase Emulator Issues

**Error**: `Failed to initialize emulator`

**Solution**:
```bash
# Clear emulator cache
firebase emulators:start --clear
```

### TypeScript Errors

**Error**: `Cannot find module 'firebase/app'`

**Solution**:
```bash
cd client
npm install
```

### Environment Variables Not Loading

**Error**: `undefined` for API keys

**Solution**:
```bash
# Verify .env exists
ls functions/.env

# Check .gitignore (should not ignore .env)
cat .gitignore | grep .env

# Restart dev server
cd functions
npm run dev
```

### Firebase Auth Errors

**Error**: `auth/invalid-api-key`

**Solution**:
1. Verify Firebase config in `client/src/firebase.ts`
2. Check Firebase project settings
3. Ensure correct project is selected: `firebase use`

### Whisper API Timeout

**Error**: `Whisper API request timeout`

**Solution**:
- Reduce audio chunk size
- Check OpenAI API quota
- Verify `OPENAI_API_KEY` is valid

### Realtime Database Not Updating

**Check:**
1. Browser console for errors
2. Firebase Console → Realtime Database → Data
3. Security rules: `database.rules.json`
4. Verify RTDB URL in `client/src/firebase.ts`

## Development Workflow Tips

### 1. Use Firebase Emulators for Local Testing

Avoid hitting production APIs during development:

```bash
firebase emulators:start
```

Then update client to use emulator:

```typescript
// client/src/firebase.ts
if (location.hostname === 'localhost') {
  rtdb.useEmulator('localhost', 9000);
  db.useEmulator('localhost', 8080);
  auth.useEmulator('http://localhost:9099');
}
```

### 2. Hot Reload for Faster Development

All modules support hot reload:
- **Client**: Vite HMR (automatic)
- **Functions**: Nodemon (automatic)
- **Server**: Nodemon (automatic)

### 3. Use React DevTools

Install browser extension for React debugging:
- [React Developer Tools](https://chrome.google.com/webstore/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi)

### 4. Monitor Cloud Functions Logs

```bash
# View real-time logs
firebase functions:log

# View logs for specific function
firebase functions:log --only processAudio
```

### 5. Test Audio Capture

1. Open Admin Dashboard at `http://localhost:5173/admin`
2. Login with Firebase Auth
3. Select audio input device
4. Click "Start Capture"
5. Check browser console for errors
6. Verify Realtime Database updates in Firebase Console

## Performance Optimization

### Client Build Optimization

```bash
# Build with analysis
cd client
npm run build -- --mode analyze
```

### Reduce Bundle Size

```bash
# Check bundle size
cd client
npx vite-bundle-visualizer
```

### Lazy Load Components

```typescript
// client/src/App.tsx
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <AdminDashboard />
    </Suspense>
  );
}
```

## Recommended VS Code Extensions

- **ESLint** - Linting
- **Prettier** - Code formatting
- **Tailwind CSS IntelliSense** - Tailwind classes
- **Firebase Explorer** - Firebase management
- **Thunder Client** - API testing
- **GitLens** - Git supercharged

---

**Related Documentation:**
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [API.md](API.md) - API reference
- [DEPLOYMENT.md](DEPLOYMENT.md) - Deployment guide
- [AGENTS.md](../AGENTS.md) - Code style guidelines
