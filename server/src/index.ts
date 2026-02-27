import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

dotenv.config();

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allow all for dev
    methods: ["GET", "POST"]
  }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Session State Interface
interface SessionState {
  audioBuffer: Buffer[];
  lastProcessTime: number;
  isProcessing: boolean;
  transcriptHistory: string[];
}

const sessions: Record<string, SessionState> = {};

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Init session
  sessions[socket.id] = {
    audioBuffer: [],
    lastProcessTime: Date.now(),
    isProcessing: false,
    transcriptHistory: []
  };

  socket.on('audio_stream', async (data: ArrayBuffer) => {
    const session = sessions[socket.id];
    if (!session) return;

    // 1. Append to Buffer
    session.audioBuffer.push(Buffer.from(data));

    // 2. Check Buffer Size / Time (Simulated Streaming)
    // Process every 1 second or if buffer is large enough
    const now = Date.now();
    const totalBytes = session.audioBuffer.reduce((acc, b) => acc + b.length, 0);
    
    // Threshold: 1000ms (approx 32KB for 16kHz mono opus? actually opus is small)
    // Let's rely on time: 1000ms
    if (!session.isProcessing && (now - session.lastProcessTime > 1000) && totalBytes > 0) {
       await processAudioBuffer(socket.id);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    delete sessions[socket.id];
  });
});

async function processAudioBuffer(socketId: string) {
  const session = sessions[socketId];
  if (!session || session.audioBuffer.length === 0) return;

  session.isProcessing = true;
  const rawBuffer = Buffer.concat(session.audioBuffer);
  // Clear buffer immediately for "Real-time" feel (or keep overlap? For now, clear)
  // To avoid cutting words, usually we need overlap. But user said "Pass-through".
  // Let's clear it.
  session.audioBuffer = []; 
  session.lastProcessTime = Date.now();

  try {
    // Save to temp file
    const tempFilePath = path.join(tmpdir(), `audio_${socketId}_${Date.now()}.webm`);
    fs.writeFileSync(tempFilePath, rawBuffer);

    // Call OpenAI Whisper
    // Note: OpenAI API requires a file stream.
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: "whisper-1",
      language: "ko", 
      temperature: 0.0,
      response_format: "json"
    });

    // Cleanup
    fs.unlinkSync(tempFilePath);

    const text = transcription.text.trim();
    if (text) {
        console.log(`[${socketId}] Partial: ${text}`);
        
        // Emit Partial Result
        // We assume this is a "segment". 
        // In a true stream, we would update the *current* segment.
        // Here we just emit 'partial_result'.
        io.to(socketId).emit('partial_result', {
            text: text,
            timestamp: Date.now()
        });

        // Trigger Gemini Refinement (Async)
        // In v4, we refine immediately? Or wait?
        // User said: "Partial -> Gray, Final -> Black (Refined)"
        refineText(socketId, text);
    }

  } catch (error) {
    console.error("Whisper Error:", error);
  } finally {
    session.isProcessing = false;
  }
}

async function refineText(socketId: string, text: string) {
    // TODO: Implement Gemini call here.
    // For now, let's mock it or just echo it as final to prove architecture.
    // User wants "Gemini to refine".
    
    // We can't use the 'functions' code directly here easily without copying logic.
    // Let's just pass-through as final for now, or add simple logic.
    
    // Simulate Gemini delay
    setTimeout(() => {
        io.to(socketId).emit('final_result', {
            text: text, // In real impl, this would be refined text
            original: text,
            timestamp: Date.now()
        });
    }, 500);
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Socket Server running on port ${PORT}`);
});
