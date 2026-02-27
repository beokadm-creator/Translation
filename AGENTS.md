# Translation App - Agent Guidelines

## Project Overview

Real-time medical conference translation platform with AI-powered speech-to-text, text refinement, and multi-language captioning. Uses Firebase backend, React client, and Socket.IO for real-time audio streaming.

## Project Structure

```
Translation/
├── client/          # React + Vite (TypeScript, ES Modules)
├── functions/       # Firebase Cloud Functions (TypeScript)
├── server/          # Express + Socket.IO (TypeScript, CommonJS)
└── firebase/        # Config (firestore.rules, storage.rules, etc.)
```

## Build/Lint/Test Commands

### Client (`client/`)
```bash
npm run dev          # Start Vite dev server
npm run build        # TypeScript check + build
npm run lint         # ESLint
npm run preview      # Preview production build
```

### Functions (`functions/`)
```bash
npm run build        # Build to lib/
npm run dev          # Start client + server dev
npm run server:dev  # Start nodemon dev server
npm run check        # TypeScript type check only
```

### Server (`server/`)
```bash
npm run dev          # Start with ts-node
npm run start        # Production server
```

### Deployment
```bash
firebase deploy              # Deploy to Firebase
firebase emulators:start     # Local emulation
```

**No test framework configured** - Add Vitest/Jest if needed.

## Code Style Guidelines

### TypeScript
- **Client**: Strict mode, ES2022 target, ESNext modules, `verbatimModuleSyntax: true`
- **Functions**: Relaxed strict mode for Firebase compatibility, path aliases `@/*` → `./src/*`
- **Server**: CommonJS modules, basic type safety

### Import Style
```typescript
// Firebase
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { ref, onValue, off } from "firebase/database";

// React
import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

// Relative
import TextItem from './components/TextItem';
import { useProjectStream } from '../hooks/useProjectStream';

// Named exports preferred
export const MyComponent = () => { ... };
```

### Naming Conventions
```typescript
// Components: PascalCase
const LiveConsole: React.FC = () => { ... };

// Hooks: camelCase with 'use' prefix
const useProjectStream = (projectId: string) => { ... };

// Types: PascalCase
interface ProjectSettings { ... };
type StreamStatus = 'raw' | 'final' | 'merged';

// Constants: UPPER_SNAKE_CASE
const HALLUCINATION_BLACKLIST = ['자막제작', 'Subtitles by'];

// Variables/Functions: camelCase
const handleLogin = async (e: React.FormEvent) => { ... };
```

### React Patterns
```typescript
// Functional components with TypeScript
const ComponentName: React.FC<{ prop1: string }> = ({ prop1 }) => {
  const [state, setState] = useState<string>('');
  const { streamData } = useCustomHook();

  useEffect(() => {
    return () => cleanup(); // cleanup
  }, [dependencies]);

  return <div>{state}</div>;
};

// Custom hooks
export const useProjectStream = (projectId: string) => {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    // Subscribe logic
    return () => unsubscribe();
  }, [projectId]);
  return { data };
};
```

### Error Handling
```typescript
const handleLogin = async (e: React.FormEvent) => {
  e.preventDefault();
  try {
    await signInWithEmailAndPassword(auth, email, password);
    navigate('/admin');
  } catch (error) {
    console.error("Login error:", error);
    alert('Login failed');
  }
};
```

### Firebase Integration
```typescript
// Client-side init (client/src/firebase.ts)
import { initializeApp } from "firebase/app";
import { getFirestore, getDatabase, getAuth, getFunctions, getStorage } from "firebase/auth";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const auth = getAuth(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);

// Realtime Database subscriptions
useEffect(() => {
  const ref_ = ref(rtdb, `projects/${projectId}/stream`);
  const unsubscribe = onValue(ref_, (snapshot) => {
    setStreamData(snapshot.val());
  }, (err) => {
    console.error("Error:", err);
    setError(err.message);
  });
  return () => off(ref_, 'value', unsubscribe);
}, [projectId]);
```

### Firebase Functions (Backend)
```typescript
import * as functions from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

admin.initializeApp();

export const myFunction = onRequest(async (request, response) => {
  functions.logger.info("Processing", { structuredData: true });
  try {
    const { projectId, data } = request.body;
    const db = admin.firestore();
    await db.collection('projects').doc(projectId).update(data);
    response.json({ success: true });
  } catch (error) {
    functions.logger.error("Error:", error);
    response.status(500).json({ error: error.message });
  }
});
```

### Socket.IO Server
```typescript
import express from 'express';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

io.on('connection', (socket) => {
  socket.on('audio_stream', async (data: ArrayBuffer) => {
    io.to(socketId).emit('partial_result', { text, timestamp });
  });
  socket.on('disconnect', () => cleanup());
});
```

### TailwindCSS Styling
```typescript
// Utility-first approach
<div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
  <div className="bg-gray-800 p-8 rounded-lg w-96 space-y-4">
    <h2 className="text-2xl font-bold">Title</h2>
    <button className="w-full bg-blue-600 p-2 rounded font-bold">Submit</button>
  </div>
</div>
```

## Important Notes

1. **No existing tests** - Add Vitest/Jest if writing tests
2. **Firebase config** contains API keys - handle with care
3. **Three TypeScript configs** - Different strictness across monorepo
4. **Server uses CommonJS** - Different from ES modules in client/functions
5. **Real-time features** - Firebase Realtime Database + Socket.IO
6. **AI services** - OpenAI Whisper + Google Gemini for translation/refinement
