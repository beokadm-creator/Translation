import React, { useEffect, useRef, useState } from "react";
import { auth } from "../firebase";
import AudioVisualizer from "./AudioVisualizer";
import TextItem from "./TextItem";
import { useProjectStream } from "../hooks/useProjectStream";

interface Props {
  projectId: string;
  sourceLabel?: string;
}

const LiveConsole: React.FC<Props> = ({ projectId, sourceLabel = "presenter" }) => {
  const { realProjectId, streamData } = useProjectStream(projectId);
  const activeProjectId = realProjectId || projectId;

  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState<string>("idle");
  const [remasterStatus, setRemasterStatus] = useState<string>("idle"); // idle, processing, done

  const triggerRemaster = async () => {
      setRemasterStatus("processing");
      try {
          await fetch(`https://us-central1-translation-comm.cloudfunctions.net/triggerRemaster?projectId=${activeProjectId}`);
          setRemasterStatus("done");
          setTimeout(() => setRemasterStatus("idle"), 3000);
      } catch {
          setRemasterStatus("error");
          setTimeout(() => setRemasterStatus("idle"), 3000);
      }
  };
  
  // Keep using Map for optimistic updates
  const [segmentsMap, setSegmentsMap] = useState<Record<string, any>>({});
  const [segmentsOrder, setSegmentsOrder] = useState<string[]>([]);

  const [stream, setStream] = useState<MediaStream | null>(null);
  
  // DUAL RECORDER REFS
  const mr1Ref = useRef<MediaRecorder | null>(null);
  const mr2Ref = useRef<MediaRecorder | null>(null);
  const activeIndexRef = useRef<number>(0);
  const chunks1Ref = useRef<Blob[]>([]);
  const chunks2Ref = useRef<Blob[]>([]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const [currentDb, setCurrentDb] = useState<number>(-90);
  
  const segmentTimerRef = useRef<number | null>(null);

  // Sync Stream Data to Map (Merge & Purge)
  useEffect(() => {
    if (!streamData) return;
    setSegmentsMap(prev => {
        const next = { ...prev };
        let changed = false;
        
        Object.entries(streamData).forEach(([k, v]: [string, any]) => {
            // Check if this update contains 'mergedIds' (Purge Request)
            if (v?.mergedIds && Array.isArray(v.mergedIds)) {
                v.mergedIds.forEach((pid: string) => {
                    if (next[pid]) {
                        delete next[pid]; // PURGE: Remove merged segment
                        changed = true;
                    }
                });
            }

            // Normal Upsert
            if (JSON.stringify(prev[k]) !== JSON.stringify(v)) {
                next[k] = v;
                changed = true;
            }
        });
        return changed ? next : prev;
    });
  }, [streamData]);

  // Order logic (Timestamp sort)
  useEffect(() => {
      const sorted = Object.keys(segmentsMap).sort((a, b) => {
          return Number(a.split('_')[0]) - Number(b.split('_')[0]);
      });
      setSegmentsOrder(sorted);
  }, [segmentsMap]);

  const [sourceType, setSourceType] = useState<'mic' | 'system'>('mic');

  const uploadChunks = async (chunks: Blob[]) => {
      if (chunks.length === 0) return;
      const blob = new Blob(chunks, { type: "audio/webm" });
      if (blob.size < 1000) return; // Ignore tiny chunks

      try {
          const buf = await blob.arrayBuffer();
          const token = await auth.currentUser?.getIdToken();
          const url = `https://us-central1-translation-comm.cloudfunctions.net/processAudio?projectId=${encodeURIComponent(activeProjectId)}&sourceLabel=${encodeURIComponent(sourceLabel)}`;
          
          fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: buf,
          }).catch(console.error);
          
          setStatus("streaming");
      } catch (e) {
          console.error(e);
          setStatus("error");
      }
  };

  const startRecording = async () => {
    try {
      let mic: MediaStream;
      if (sourceType === 'system') {
         const displayStream = await (navigator.mediaDevices as any).getDisplayMedia({ 
             video: true, 
             audio: {
                 echoCancellation: false,
                 noiseSuppression: false,
                 autoGainControl: false
             }
         });
         displayStream.getVideoTracks().forEach((track: any) => track.stop());
         const audioTracks = displayStream.getAudioTracks();
         if (audioTracks.length === 0) {
             alert("System audio not shared.");
             return;
         }
         mic = new MediaStream([audioTracks[0]]);
      } else {
         mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      setStream(mic);
      
      // Visualizer Setup
      const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ac;
      const source = ac.createMediaStreamSource(mic);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
      source.connect(analyser);

      // --- DUAL RECORDER SETUP ---
      const createRecorder = (targetChunksRef: React.MutableRefObject<Blob[]>) => {
          const mr = new MediaRecorder(mic, { mimeType: "audio/webm" });
          mr.ondataavailable = (e) => {
              if (e.data.size > 0) targetChunksRef.current.push(e.data);
          };
          mr.onstop = () => {
              const chunks = [...targetChunksRef.current];
              targetChunksRef.current = []; // Clear immediately
              uploadChunks(chunks);
          };
          return mr;
      };

      mr1Ref.current = createRecorder(chunks1Ref);
      mr2Ref.current = createRecorder(chunks2Ref);

      // Start first recorder
      activeIndexRef.current = 0;
      mr1Ref.current.start();
      
      setIsRecording(true);
      setStatus("recording");

      // SWITCH LOGIC (Every 2000ms)
      segmentTimerRef.current = window.setInterval(() => {
          const nextIndex = activeIndexRef.current === 0 ? 1 : 0;
          const nextMR = nextIndex === 0 ? mr1Ref.current : mr2Ref.current;
          const currentMR = activeIndexRef.current === 0 ? mr1Ref.current : mr2Ref.current;

          if (nextMR && nextMR.state === 'inactive') {
              nextMR.start(); // Start NEXT first (Overlap 0ms technically, but safe)
          }
          
          if (currentMR && currentMR.state === 'recording') {
              currentMR.stop(); // Then STOP current
          }

          activeIndexRef.current = nextIndex;
      }, 2000);

      // Visualizer Loop
      const buf = new Float32Array(analyser.fftSize);
      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const db = 20 * Math.log10(Math.max(rms, 1e-8));
        setCurrentDb(db);
        rafIdRef.current = window.requestAnimationFrame(loop);
      };
      rafIdRef.current = window.requestAnimationFrame(loop);

    } catch (e) {
      console.error(e);
      setStatus("mic_error");
    }
  };

  const stopRecording = () => {
    if (segmentTimerRef.current) clearInterval(segmentTimerRef.current);
    
    // Stop both
    if (mr1Ref.current?.state === 'recording') mr1Ref.current.stop();
    if (mr2Ref.current?.state === 'recording') mr2Ref.current.stop();

    stream?.getTracks().forEach(t => t.stop());
    audioContextRef.current?.close();
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    setIsRecording(false);
    setStatus("idle");
  };

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex items-center justify-between bg-gray-900 p-3 rounded-lg shadow-md border border-gray-700">
          <div className="flex items-center gap-3">
              <div className="flex bg-gray-800 rounded p-1">
                  <button 
                      onClick={() => setSourceType('mic')}
                      className={`px-3 py-1 text-sm rounded transition-colors ${sourceType === 'mic' ? 'bg-gray-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                  >
                      Mic
                  </button>
                  <button 
                      onClick={() => setSourceType('system')}
                      className={`px-3 py-1 text-sm rounded transition-colors ${sourceType === 'system' ? 'bg-gray-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                  >
                      System
                  </button>
              </div>

              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`px-4 py-1.5 rounded text-sm font-bold shadow transition-all ${isRecording ? "bg-red-600 hover:bg-red-700 animate-pulse" : "bg-green-600 hover:bg-green-700"}`}
              >
                {isRecording ? "🛑 STOP" : "▶ START"}
              </button>
          </div>

          <div className="flex items-center gap-3">
              {/* Manual Remaster Button */}
              <button
                onClick={triggerRemaster}
                disabled={remasterStatus === 'processing'}
                className={`px-4 py-1.5 rounded text-sm font-semibold flex items-center gap-2 shadow transition-all ${remasterStatus === 'processing' ? 'bg-yellow-600 cursor-not-allowed opacity-80' : 'bg-purple-600 hover:bg-purple-500 hover:shadow-lg hover:-translate-y-0.5'}`}
              >
                 {remasterStatus === 'processing' ? (
                     <>
                        <span className="animate-spin">⏳</span> Cleaning...
                     </>
                 ) : (remasterStatus === 'done' ? '✅ Done!' : '✨ Remaster Now')}
              </button>
              
              <span className={`text-xs px-2 py-1 rounded border ${status === 'streaming' ? 'border-green-500 text-green-400' : 'border-gray-600 text-gray-500'}`}>
                  {status.toUpperCase()}
              </span>
          </div>
      </div>

      <div className="bg-gray-900 rounded p-4 mt-2">
         <label className="text-xs text-gray-300">Mic Level: {currentDb.toFixed(1)} dB</label>
         <div className="w-full h-2 bg-gray-700 rounded">
            <div className="h-2 bg-green-500 rounded" style={{ width: `${Math.min(100, Math.max(0, ((currentDb + 90) / 60) * 100))}%` }} />
         </div>
      </div>
      
      <AudioVisualizer stream={stream} width={600} height={60} />
      
      <div className="bg-gray-800 rounded p-4 min-h-[200px]">
        <div className="text-xs text-gray-400 mb-2">Live Transcript (RTDB Stream)</div>
        <div className="text-lg break-words whitespace-pre-wrap space-y-2">
            {segmentsOrder.map((id) => {
                const seg = segmentsMap[id];
                if (seg?.status === 'merged') return null; // Hide merged segments
                const text = seg?.refined || seg?.original || "";
                const isFinal = seg?.status === 'final';
                return (
                    <TextItem key={id} id={id} text={text} isRaw={!isFinal} />
                );
            })}
        </div>
      </div>
    </div>
  );
};

export default LiveConsole;
