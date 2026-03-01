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
  targetLanguages: string[]; // e.g., ["en", "ja", "zh"]
  parkingMessage?: string;
  // Overlay Settings
  overlay?: {
      fontSize: number; // px
      fontColor: string; // hex
      fontWeight: 'normal' | 'bold' | '800';
      bgColor: string; // hex
      bgOpacity: number; // 0.0 ~ 1.0
      padding: number; // px
      textEffect: 'none' | 'shadow' | 'stroke';
      align: 'left' | 'center' | 'right';
  }
}

export interface Session {
  id: string;
  speaker: string;
  affiliation: string;
  topic: string;
  abstract: string; // Core for RAG
  keywords: string[];
  startTime: string; // HH:MM
}

export interface StreamSegment {
  original: string;
  refined?: string;
  en?: string;
  ja?: string;
  status: 'raw' | 'final' | 'merged';
  timestamp: number;
  mergedIds?: string[];
}

export interface ProjectState {
  activeSessionId?: string;
  status: {
    lastActive: number;
    services: Record<string, unknown>;
  };
}
