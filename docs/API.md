# API Reference

Complete API reference for the Translation platform - Cloud Functions, WebSocket events, and database schemas.

## Table of Contents

- [Cloud Functions HTTP Endpoints](#cloud-functions-http-endpoints)
- [Cloud Functions Triggers](#cloud-functions-triggers)
- [Socket.IO Events](#socket-io-events)
- [Database Schemas](#database-schemas)
- [Client-Side APIs](#client-side-apis)
- [Authentication](#authentication)
- [Error Codes](#error-codes)

## Cloud Functions HTTP Endpoints

### Base URL

```
https://{region}-translation-comm.cloudfunctions.net
```

**Regions**: `us-central1` (default), `asia-northeast1`, `europe-west1`

---

### 1. processAudio

Processes audio buffer through Whisper STT pipeline.

**Endpoint**: `POST /processAudio`

**Authentication**: Firebase ID Token required

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | string | Yes | Project identifier |
| `sourceLabel` | string | No | Source label (default: "admin") |
| `sourceLang` | string | No | Source language code (default: "ko") |

**Request Headers**:

```
Content-Type: application/octet-stream
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

**Request Body**: Raw audio buffer (WebM/WAV format)

**Response**:

```json
{
  "success": true,
  "segmentId": "unique-segment-id",
  "original": "Original transcript from Whisper",
  "timestamp": "2026-02-28T10:30:00Z",
  "sessionId": "session-id"
}
```

**Status Codes**:

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Invalid request |
| 401 | Unauthorized |
| 413 | Payload too large |
| 500 | Server error |

**Example**:

```bash
curl -X POST \
  "https://us-central1-translation-comm.cloudfunctions.net/processAudio?projectId=abc123&sourceLabel=admin" \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/octet-stream" \
  --data-binary @audio.webm
```

---

### 2. archiveSession

Archives current session transcripts and resets streaming state.

**Endpoint**: `POST /archiveSession`

**Authentication**: Firebase ID Token required

**Request Headers**:

```
Content-Type: application/json
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

**Request Body**:

```json
{
  "projectId": "project-id",
  "sessionId": "session-id"
}
```

**Response**:

```json
{
  "success": true,
  "archivedSegments": 150,
  "transcriptPath": "projects/abc123/transcripts/session123"
}
```

**Example**:

```bash
curl -X POST \
  "https://us-central1-translation-comm.cloudfunctions.net/archiveSession" \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{"projectId": "abc123", "sessionId": "session123"}'
```

---

### 3. purgeSession

Purges all session data from Realtime Database.

**Endpoint**: `POST /purgeSession`

**Authentication**: Firebase ID Token required (Admin only)

**Request Body**:

```json
{
  "projectId": "project-id",
  "sessionId": "session-id"
}
```

**Response**:

```json
{
  "success": true,
  "deletedPaths": [
    "projects/abc123/stream",
    "projects/abc123/sessions/session123"
  ]
}
```

---

### 4. triggerRemaster

Triggers batch reprocessing of transcript segments.

**Endpoint**: `POST /triggerRemaster`

**Authentication**: Firebase ID Token required

**Request Body**:

```json
{
  "projectId": "project-id",
  "sessionId": "session-id",
  "fromTimestamp": "2026-02-28T00:00:00Z"
}
```

**Response**:

```json
{
  "success": true,
  "taskId": "remaster-task-id",
  "status": "queued"
}
```

---

### 5. diagnoseSystem

Health check endpoint for system diagnostics.

**Endpoint**: `GET /diagnoseSystem`

**Authentication**: None (or optional)

**Response**:

```json
{
  "status": "healthy",
  "services": {
    "whisper": "ok",
    "gemini": "ok",
    "translate": "ok",
    "firestore": "ok",
    "rtdb": "ok"
  },
  "timestamp": "2026-02-28T10:30:00Z"
}
```

## Cloud Functions Triggers

### 1. onRefineRequest

**Type**: Realtime Database `onWrite` trigger

**Path**: `projects/{projectId}/stream/{pushId}`

**Trigger condition**: When new stream segment is created

**Actions**:
1. Reads `original` text from RTDB
2. Calls Gemini API for refinement
3. Updates RTDB with `refined`, `en`, `ja` fields
4. Triggers TTS generation (if configured)

**Input Data**:

```json
{
  "original": "임플란트 수술 시 상악동 거상술이 필요합니다",
  "status": "partial",
  "timestamp": "2026-02-28T10:30:00Z"
}
```

**Output Data**:

```json
{
  "refined": "임플란트 수술 시 상악동 거상술(Sinus Graft)이 필요합니다",
  "en": {
    "text": "Sinus graft is required during implant surgery",
    "timestamp": "2026-02-28T10:30:01Z",
    "isFinal": true
  },
  "ja": {
    "text": "インプラント手術時に上顎洞挙上術が必要です",
    "timestamp": "2026-02-28T10:30:01Z",
    "isFinal": true
  },
  "status": "final"
}
```

---

### 2. translateNewSegment

**Type**: Realtime Database `onWrite` trigger

**Path**: `projects/{projectId}/stream/{pushId}`

**Trigger condition**: When `refined` field is updated

**Actions**:
1. Fetches `targetLangs` from Firestore
2. Translates `refined` text to each target language
3. Writes translations to `stream/{pushId}/{langCode}`

**Input Data**:

```json
{
  "refined": "임플란트 수술 시 상악동 거상술이 필요합니다"
}
```

**Output Data** (for each target language):

```json
{
  "stream/{pushId}/en": {
    "text": "Sinus graft is required during implant surgery",
    "timestamp": "2026-02-28T10:30:02Z",
    "isFinal": true
  }
}
```

## Socket.IO Events

**Server**: `server/src/index.ts` (local development only)

**Connection**: `http://localhost:3000`

### Client → Server Events

#### audio_stream

Emits audio buffer chunks to server.

**Event**: `audio_stream`

**Payload**: `ArrayBuffer` (raw audio data)

**Example**:

```javascript
const socket = io('http://localhost:3000');

// Capture audio and emit
mediaRecorder.ondataavailable = (event) => {
  socket.emit('audio_stream', event.data);
};
```

### Server → Client Events

#### partial_result

Emits intermediate transcription result (before refinement).

**Event**: `partial_result`

**Payload**:

```json
{
  "text": "임플란트 수술 시",
  "timestamp": "2026-02-28T10:30:00.500Z",
  "isPartial": true
}
```

#### final_result

Emits final refined transcription.

**Event**: `final_result`

**Payload**:

```json
{
  "original": "임플란트 수술 시 상악동 거상술이 필요합니다",
  "refined": "임플란트 수술 시 상악동 거상술(Sinus Graft)이 필요합니다",
  "translations": {
    "en": "Sinus graft is required during implant surgery",
    "ja": "インプラント手術時に上顎洞挙上術が必要です"
  },
  "timestamp": "2026-02-28T10:30:02Z",
  "isFinal": true
}
```

**Example**:

```javascript
socket.on('final_result', (data) => {
  console.log('Final:', data.refined);
  // Display to user
});
```

## Database Schemas

### Realtime Database Structure

```
projects/
├── {projectId}/
│   ├── stream/
│   │   ├── {segmentId}/
│   │   │   ├── id: string
│   │   │   ├── original: string
│   │   │   ├── refined: string
│   │   │   ├── en/
│   │   │   │   ├── text: string
│   │   │   │   ├── timestamp: string (ISO)
│   │   │   │   └── isFinal: boolean
│   │   │   ├── ja/
│   │   │   │   ├── text: string
│   │   │   │   ├── timestamp: string (ISO)
│   │   │   │   └── isFinal: boolean
│   │   │   ├── status: "partial" | "final"
│   │   │   ├── timestamp: string (ISO)
│   │   │   ├── sessionId: string
│   │   │   ├── seq: number
│   │   │   ├── mergedIds: string[]
│   │   │   └── audioUrl: string (optional)
│   │   └── ...
│   ├── sessions/
│   │   └── {sessionId}/
│   │       ├── speaker: string
│   │       ├── topic: string
│   │       ├── language: string
│   │       ├── startTime: string (ISO)
│   │       ├── endTime: string (ISO, optional)
│   │       └── transcript: string (reference)
│   ├── activeSessionId: string
│   └── settings/
│       ├── overlay/
│       │   ├── fontSize: number (default: 24)
│       │   ├── fontColor: string (default: "#000000")
│       │   ├── bgColor: string (default: "#ffffff")
│       │   ├── alignment: "left" | "center" | "right"
│       │   └── displayMode: "scroll" | "fixed"
│       └── chunk/
│           ├── minLength: number (ms, default: 3000)
│           ├── timeoutMs: number (ms, default: 3000)
│           └── sentenceEnd: boolean
```

### Firestore Structure

```
projects/
└── {projectId}/
    └── settings/
        ├── targetLangs: string[] (e.g., ["en", "ja", "zh"])
        ├── overlay: map (see above)
        └── chunk: map (see above)
```

## Client-Side APIs

### Firebase SDK Initialization

**File**: `client/src/firebase.ts`

```typescript
import { initializeApp } from "firebase/app";
import { getFirestore, getDatabase, getAuth, getFunctions, getStorage } from "firebase/auth";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "translation-comm.firebaseapp.com",
  projectId: "translation-comm",
  databaseURL: "https://translation-comm-default-rtdb.firebaseio.com",
  storageBucket: "translation-comm.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const auth = getAuth(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);
```

### useProjectStream Hook

**File**: `client/src/hooks/useProjectStream.ts`

Subscribes to project stream data in Realtime Database.

```typescript
import { useProjectStream } from '../hooks/useProjectStream';

function AudienceView({ projectId }) {
  const { streamData, loading, error } = useProjectStream(projectId);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {streamData.map(segment => (
        <TextItem key={segment.id} segment={segment} />
      ))}
    </div>
  );
}
```

**Returns**:

| Property | Type | Description |
|----------|------|-------------|
| `streamData` | `StreamSegment[]` | Array of stream segments |
| `loading` | `boolean` | Loading state |
| `error` | `Error` | Error object (if any) |

### Calling Cloud Functions from Client

```typescript
import { httpsCallable } from 'firebase/functions';

// Call processAudio
const processAudio = httpsCallable(functions, 'processAudio');

const audioBuffer = await fetch(audioUrl).then(r => r.arrayBuffer());

const result = await processAudio({
  audio: audioBuffer,
  projectId: 'abc123',
  sourceLabel: 'admin'
});

console.log(result.data);
// { success: true, segmentId: "...", original: "..." }
```

## Authentication

### Firebase Auth (Email/Password)

**Login**:

```typescript
import { signInWithEmailAndPassword } from 'firebase/auth';

const handleLogin = async (email: string, password: string) => {
  try {
    await signInWithEmailAndPassword(auth, email, password);
    // Redirect to admin
  } catch (error) {
    console.error('Login failed:', error);
  }
};
```

**Get ID Token**:

```typescript
const user = auth.currentUser;
const idToken = await user.getIdToken();

// Use in API calls
fetch('https://...cloudfunctions.net/processAudio', {
  headers: {
    'Authorization': `Bearer ${idToken}`
  }
});
```

### Cloud Functions Auth Verification

**Server-side** (in Cloud Function):

```typescript
import * as functions from "firebase-functions/v2/https";

export const protectedEndpoint = onRequest(async (req, res) => {
  // Verify ID token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    // Token is valid, proceed
    res.json({ success: true, uid: decoded.uid });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});
```

## Error Codes

### HTTP Status Codes

| Code | Name | Description |
|------|------|-------------|
| 200 | OK | Request succeeded |
| 400 | Bad Request | Invalid parameters |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 413 | Payload Too Large | Audio file exceeds size limit |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |
| 503 | Service Unavailable | Service temporarily unavailable |

### Application-Specific Errors

| Error Code | Message | Cause | Solution |
|------------|---------|-------|----------|
| `ERR_INVALID_AUDIO` | Invalid audio format | Unsupported audio codec | Use WebM/WAV format |
| `ERR_WHISPER_TIMEOUT` | Whisper API timeout | OpenAI API slow | Retry, reduce chunk size |
| `ERR_GEMINI_QUOTA` | Gemini quota exceeded | API limit reached | Wait or upgrade quota |
| `ERR_PROJECT_NOT_FOUND` | Project not found | Invalid projectId | Verify project exists |
| `ERR_INVALID_TOKEN` | Invalid Firebase token | Expired or invalid token | Re-authenticate |
| `ERR_DATABASE_WRITE` | Database write failed | RTDB/Firestore error | Check permissions |
| `ERR_TRANSLATION_FAILED` | Translation failed | Google Translate error | Check API quota |

**Error Response Format**:

```json
{
  "error": {
    "code": "ERR_WHISPER_TIMEOUT",
    "message": "Whisper API request timed out",
    "details": {
      "timeout": 30000,
      "timestamp": "2026-02-28T10:30:00Z"
    }
  }
}
```

## Rate Limiting

### API Quotas

| Service | Free Tier | Paid Tier |
|---------|-----------|-----------|
| OpenAI Whisper | 3M tokens/month | Pay-per-use |
| Gemini API | 15 requests/minute | Higher tiers |
| Google Translate | 500K characters/day | Pay-per-use |
| Cloud Functions | 125K invocations/month | Pay-per-use |

### Rate Limit Headers

Responses include rate limit headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1677649200
```

---

**Related Documentation:**
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [DEVELOPMENT.md](DEVELOPMENT.md) - Development setup
- [DEPLOYMENT.md](DEPLOYMENT.md) - Deployment guide
