export interface Conference {
  id: string;
  title: string;
  accessCode: string;
  dates: string; // e.g. "2024-10-10 ~ 2024-10-12"
}

export interface ProjectSettings {
  conferenceId?: string; // Parent Conference ID
  name: string;
  slug: string;
  logoUrl?: string;
  date: string;
  accessCode: string; // (Legacy? Or specific to hall?)
  targetLanguages: string[]; // e.g., ["en", "ko"]
  parkingMessage?: string;
  recordMode?: 'chunk' | 'vad';
  hideRaw?: boolean;
  // Overlay Settings
  overlay?: {
      fontSize: number;
      fontColor: string;
      fontWeight: 'normal' | 'bold' | '800';
      bgColor: string;
      bgOpacity: number;
      padding: number;
      textEffect: 'none' | 'shadow' | 'stroke';
      align: 'left' | 'center' | 'right';
      // v2
      displayStyle: 'youtube' | 'typing';
      letterSpacing: number;  // px
      maxLines: number;       // 1-5
      lineHeight: number;
      fontFamily: string;
      typingSpeed: number;    // chars/sec
      bottomOffset: number;   // px from bottom
  };
  // AI Chunking & Buffering Settings
  chunk?: {
      minLength: number;    // 버퍼 flush 최소 글자 수
      timeoutMs: number;    // flush 강제 타임아웃 (ms)
      sentenceEnd: boolean; // . ! ? 기준 flush 여부
      vadMaxCutMs: number;  // VAD 모드 최대 강제 컷 (ms)
      chunkInterval: number; // Chunk 모드 인터벌 (ms)
  };
}

export interface Session {
  id: string;
  speaker: string;
  affiliation: string;
  topic: string;
  abstract: string; // Core for RAG
  keywords: string; // comma-separated string (e.g. "implant, sinus, bone graft")
  startTime: string; // HH:MM
}

export interface StreamSegment {
  original: string;
  refined?: string;
  ko?: string;
  en?: string;
  ja?: string;
  status: 'raw' | 'translating' | 'final' | 'merged';
  timestamp: number;
  seq?: number;
  mergedIds?: string[];
}

export interface ProjectState {
  activeSessionId?: string;
  status: {
    lastActive: number;
    services: Record<string, unknown>;
  };
}
