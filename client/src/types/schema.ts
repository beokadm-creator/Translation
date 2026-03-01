export interface Project {
  id?: string; // Document ID
  slug?: string; // Custom URL slug (optional, unique)
  name: string;
  logoUrl: string;
  accessCode: string | null;
  schedule: {
    date: string; // ISOString
    startTime: string;
    endTime: string;
  };
  status: 'scheduled' | 'live' | 'ended' | 'archived';
  settings: {
    glossaries: string[];
    glossaryId?: string;
    targetLangs?: string[]; // e.g. ["ko", "ja"]
    theme: Record<string, unknown>;
    appearance: {
      backgroundColor: string;
      textColor: string;
      fontSize: 'small' | 'medium' | 'large' | 'xlarge';
      fontFamily: string;
      opacity: number; // 0.0 to 1.0 for background
    };
    parkingMessage?: string;
  };
  currentNotice?: string;
}

export interface TranscriptSegment {
  // transcripts/{projectId}/segments/{segmentId}
  id?: string;
  text: string;
  lang: string;
  timestamp: number;
  isFinal: boolean;
  originalText?: string; // Optional: for debugging or reprocessing
}

// RTDB Schema Interfaces
export interface StreamSegment {
  // /sessions/{projectId}/stream (Push ID as key)
  text: string;
  lang: string;
  timestamp: number;
  isFinal: boolean;
}

export interface SessionStatus {
  // /sessions/{projectId}/status
  value: 'active' | 'paused';
  notice?: string; // Real-time notice
  viewerCount?: number;
}
