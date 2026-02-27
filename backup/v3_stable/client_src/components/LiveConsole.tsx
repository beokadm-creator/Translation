// Version: Quality Stable v1
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import AudioVisualizer from "./AudioVisualizer";
import TextItem from "./TextItem";
import { parseSmartly } from "../utils/parseSmartly";
import { useProjectStream } from "../hooks/useProjectStream";
// Status subscription moved to global bar

interface Props {
  projectId: string;
  sourceLabel?: string;
}

const LiveConsole: React.FC<Props> = ({ projectId, sourceLabel = "presenter" }) => {
  const { realProjectId, streamData } = useProjectStream(projectId);
  const activeProjectId = realProjectId || projectId;

  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState<string>("idle");
  const [segmentsOrder, setSegmentsOrder] = useState<string[]>([]);
  const [segmentsMap, setSegmentsMap] = useState<Record<string, { original?: { text: string, timestamp: number }, refined?: { text: string, timestamp: number }, status?: string }>>({});
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [systemStream, setSystemStream] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mixedDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const segmentTimerRef = useRef<number | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const micGainRef = useRef<GainNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  // const [serviceStatus, setServiceStatus] = useState<{openai?: any; gemini?: any; translation?: any}>({});
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [silenceMs, setSilenceMs] = useState<number>(() => Number(localStorage.getItem('cfg.silenceMs') || 500));
  const [maxMs, setMaxMs] = useState<number>(() => Number(localStorage.getItem('cfg.maxMs') || 4000));
  const [overlapMs, setOverlapMs] = useState<number>(() => Number(localStorage.getItem('cfg.overlapMs') || 200));
  const [minDb, setMinDb] = useState<number>(() => Number(localStorage.getItem('cfg.minDb') || -50));
  const [currentDb, setCurrentDb] = useState<number>(-90);
  const lastVoiceTsRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const prevTailChunkRef = useRef<Blob | null>(null);
  const currentChunksRef = useRef<Blob[]>([]);

  

  useEffect(() => {
    localStorage.setItem('cfg.silenceMs', String(silenceMs));
    localStorage.setItem('cfg.maxMs', String(maxMs));
    localStorage.setItem('cfg.overlapMs', String(overlapMs));
    localStorage.setItem('cfg.minDb', String(minDb));
  }, [silenceMs, maxMs, overlapMs, minDb]);

  useEffect(() => {
    const data = streamData;
    if (!data) {
        if (data === null && Object.keys(segmentsMap).length > 0) {
             setSegmentsMap({});
             setSegmentsOrder([]);
        }
        return;
    }

    const timer = setTimeout(() => {
        setSegmentsMap(prevMap => {
            const nextMap = { ...prevMap };
            let hasChanges = false;

            Object.entries(data).forEach(([key, val]: [string, any]) => {
                const originalVal = val?.original;
                const refinedVal = val?.refined;
                let originalObj: any = undefined;
                let refinedObj: any = undefined;

                if (typeof originalVal === 'string') {
                    originalObj = { text: originalVal, timestamp: Number(key.split('_')[0]) };
                } else if (originalVal && typeof originalVal === 'object') {
                    originalObj = { text: originalVal.text, timestamp: Number(originalVal.timestamp || key.split('_')[0]) };
                }

                const tryParseIfJSON = (text: string): any | null => {
                    const t = (text || "").trim();
                    if (!t.startsWith("{")) return null;
                    try { return JSON.parse(t.replace(/```json/g, "").replace(/```/g, "")); } catch { return null; }
                };

                if (typeof refinedVal === 'string') {
                    const parsed = tryParseIfJSON(refinedVal);
                    const finalText = parsed ? (parsed.refined || "") : refinedVal;
                    refinedObj = { text: finalText, timestamp: Number(key.split('_')[0]) };
                } else if (refinedVal && typeof refinedVal === 'object') {
                    refinedObj = { text: refinedVal.text, timestamp: Number(refinedVal.timestamp || key.split('_')[0]) };
                }

                // Check if exact same
                const prevItem = prevMap[key];
                const newItem = {
                    original: originalObj,
                    refined: refinedObj,
                    status: val?.status || (refinedObj ? 'final' : 'raw')
                };

                // Deep compare simply
                if (JSON.stringify(prevItem) === JSON.stringify(newItem)) {
                    return;
                }

                hasChanges = true;
                nextMap[key] = newItem;
            });

            if (!hasChanges) return prevMap;
            return nextMap;
        });
    }, 100);
    return () => clearTimeout(timer);
  }, [streamData]);

  // Derive order from Map whenever it changes, with Content-based De-duplication
  useEffect(() => {
      // 1. Sort by timestamp
      const sortedKeys = Object.keys(segmentsMap).sort((a, b) => {
          const tsA = Number(a.split('_')[0]);
          const tsB = Number(b.split('_')[0]);
          return tsA - tsB;
      });

      // 2. Reduce to unique content
      const uniqueKeys = sortedKeys.reduce((acc: string[], key) => {
          if (acc.length === 0) {
              acc.push(key);
              return acc;
          }

          const prevKey = acc[acc.length - 1];
          const prevSeg = segmentsMap[prevKey];
          const currSeg = segmentsMap[key];

          const prevText = (prevSeg.refined?.text || prevSeg.original?.text || "").trim();
          const currText = (currSeg.refined?.text || currSeg.original?.text || "").trim();

          // Exact Match -> Skip current
          if (prevText === currText) return acc;

          // Overlap: Current includes Previous -> Replace Previous with Current
          if (currText.includes(prevText) && currText.length > prevText.length) {
              acc[acc.length - 1] = key;
              return acc;
          }

          // Echo: Previous includes Current -> Skip Current
          if (prevText.includes(currText) && prevText.length > currText.length) {
              return acc;
          }

          // Visual Force Dedup: 50% threshold as requested
          if (prevText && currText) {
              // Calculate ratio
              const textA = prevText.replace(/\s/g, "");
              const textB = currText.replace(/\s/g, "");
              const long = textA.length > textB.length ? textA : textB;
              const short = textA.length > textB.length ? textB : textA;
              
              // If contained or overlap significant
              if (long.includes(short) && short.length / long.length > 0.5) {
                   // Prefer the longer one (usually replaces prev)
                   if (currText.length > prevText.length) {
                       acc[acc.length - 1] = key;
                   }
                   return acc;
              }
          }

          // Suffix/Prefix Overlap (Simple)
          const minOverlap = 5;
          if (currText.length >= minOverlap && prevText.length >= minOverlap) {
              for (let i = minOverlap; i <= 10; i++) {
                 const suffix = prevText.slice(-i);
                 if (currText.startsWith(suffix)) {
                     // Just skip current to be safe in console
                     // Or merge? Console needs debugging, so maybe show both?
                     // But user wants clean view.
                     // Let's replace previous with merged text in console too if possible.
                     // But segmentsMap is source of truth. We can't change text here easily without affecting rendering component.
                     // TextItem takes text prop.
                     // We are just building order array here.
                     // So we can't merge text. We can only choose to include or exclude key.
                     // If overlap, exclude current? or exclude previous?
                     // Usually current has more info. Replace previous.
                     acc[acc.length - 1] = key;
                     return acc;
                 }
              }
          }

          acc.push(key);
          return acc;
      }, []);

      setSegmentsOrder(uniqueKeys);
  }, [segmentsMap]);

  // Status rendering moved to global bar; keep listener optional for future hooks

  const startSystemAudio = async () => {
    try {
      const ds = await (navigator.mediaDevices as any).getDisplayMedia({
        video: true,
        audio: true,
      });
      const audioTracks = ds.getAudioTracks();
      if (audioTracks.length > 0) {
        const onlyAudio = new MediaStream([audioTracks[0]]);
        setSystemStream(onlyAudio);
        setStatus("system_audio_ready");
      } else {
        setStatus("system_audio_missing");
      }
    } catch (e) {
      setStatus("system_audio_error");
    }
  };

  const navigate = useNavigate();
  const startRecording = async () => {
    try {
      let mic: MediaStream | null = null;
      if (micEnabled) {
        try {
          mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          setStream(mic);
        } catch {
          setStatus("mic_denied");
        }
      }

      // Create mix: system(0.8) + mic(0.2) if systemStream exists
      const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ac as AudioContext;
      const dest = ac.createMediaStreamDestination();
      mixedDestRef.current = dest;

      if (mic) {
        const micSource = ac.createMediaStreamSource(mic);
        micSourceRef.current = micSource;
        const micGain = ac.createGain();
        micGainRef.current = micGain;
        micGain.gain.value = micEnabled ? (systemStream ? 0.2 : 1.0) : 0.0;
        if (micEnabled) {
          micSource.connect(micGain).connect(dest);
        }
      }

      if (systemStream) {
        const sysSource = ac.createMediaStreamSource(systemStream);
        const sysGain = ac.createGain();
        sysGain.gain.value = 0.8;
        sysSource.connect(sysGain).connect(dest);
      }

      const outStream = dest.stream;
      if ((!mic) && (!systemStream)) {
        setStatus("no_audio_sources");
        return;
      }
      // Setup VAD analyser
      const analyser = ac.createAnalyser();
      analyser.fftSize = 2048;
      (analyser as any).minDecibels = minDb;
      analyserRef.current = analyser;
      const vadSource = ac.createMediaStreamSource(outStream);
      vadSource.connect(analyser);
      lastVoiceTsRef.current = Date.now();
      const mr = new MediaRecorder(outStream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = mr;
      // Restart mode: every 3s stop -> send full blob -> start again
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 1024) {
          currentChunksRef.current.push(e.data);
        }
      };
      mr.onstop = async () => {
        const tail = prevTailChunkRef.current;
        const chunks = currentChunksRef.current.slice();
        currentChunksRef.current = [];
        const combinedBlob = (() => {
          try {
            if (tail && tail.size > 0) return new Blob([tail, ...chunks], { type: "audio/webm;codecs=opus" });
            return new Blob(chunks, { type: "audio/webm;codecs=opus" });
          } catch {
            return new Blob(chunks, { type: "audio/webm;codecs=opus" });
          }
        })();
        const lastChunk = chunks.length ? chunks[chunks.length - 1] : null;
        prevTailChunkRef.current = lastChunk; // store ~last 500ms chunk as tail for next segment
        if (combinedBlob && combinedBlob.size > 1024) {
          try {
            const buf = await combinedBlob.arrayBuffer();
            const token = await auth.currentUser?.getIdToken();
            const isEnd = Date.now() - lastVoiceTsRef.current >= silenceMs ? 1 : 0;
            const url = `https://us-central1-translation-comm.cloudfunctions.net/processAudio?projectId=${encodeURIComponent(activeProjectId)}&sourceLabel=${encodeURIComponent(sourceLabel)}&end=${isEnd}`;
            const resp = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/octet-stream",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: buf,
            });
            if (!resp.ok) {
              if (resp.status === 401) {
                setStatus("unauthorized");
                navigate("/login");
              } else {
                setStatus("error");
              }
            } else {
              setStatus("streaming");
            }
          } catch {
            setStatus("error");
          }
        }
        // Immediately start next segment
        try { mediaRecorderRef.current?.start(); } catch {}
        // reschedule max limit timer baseline
        lastVoiceTsRef.current = Date.now();
      };
      // emit chunks; overlap equals timeslice
      mr.start(overlapMs);
      // Hard Cut Timer Logic (Force send every 4000ms OR Silence 500ms)
      const HARD_CUT_MS = maxMs; // User configurable Max Duration (default 4000)
      let lastCutTime = Date.now();

      // VAD loop + max limit safety
      const buf = new Float32Array(analyser.fftSize);
      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const db = 20 * Math.log10(Math.max(rms, 1e-8));
        setCurrentDb(db);
        const now = Date.now();
        if (rms > 0.01) { // Threshold for "speaking"
          lastVoiceTsRef.current = now;
        }
        
        // 1. Max Duration Exceeded
        const timeLimitExceeded = (now - lastCutTime) >= HARD_CUT_MS;
        // 2. Silence Detected (if speaking stopped for > silenceMs)
        const silenceDetected = (now - lastVoiceTsRef.current >= silenceMs);

        if (timeLimitExceeded || silenceDetected) {
           // Only cut if we have enough data (avoid empty cuts on silence loop)
           if (currentChunksRef.current.length > 5) { // minimal chunks check
               try { 
                   if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                       mediaRecorderRef.current.stop(); 
                       // Start will be called in onstop
                   }
               } catch {}
               lastCutTime = now;
               lastVoiceTsRef.current = now; // Reset to avoid double trigger
           }
        }

        rafIdRef.current = window.requestAnimationFrame(loop);
      };
      rafIdRef.current = window.requestAnimationFrame(loop);
      setIsRecording(true);
      setStatus("recording");
    } catch (e) {
      setStatus("mic_error");
    }
  };

  const stopRecording = () => {
    try {
      if (segmentTimerRef.current) {
        window.clearInterval(segmentTimerRef.current);
        segmentTimerRef.current = null;
      }
      if (rafIdRef.current) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      mixedDestRef.current?.disconnect();
      audioContextRef.current?.close();
      // Fully stop device tracks for privacy/resource release
      stream?.getTracks().forEach(t => t.stop());
      systemStream?.getTracks().forEach(t => t.stop());
      // Flush chunks
      currentChunksRef.current = [];
      prevTailChunkRef.current = null;
    } catch {}
  };

  return (
    <div className="space-y-4">
      {/* StatusBar moved to Layout/GoLive; avoid duplication in LiveConsole */}
      <div className="flex items-center gap-3">
        <button
          onClick={isRecording ? stopRecording : startRecording}
          className={`px-4 py-2 rounded ${isRecording ? "bg-red-600" : "bg-green-600"}`}
        >
          {isRecording ? "Stop" : "Start"}
        </button>
        <button
          onClick={startSystemAudio}
          className="px-4 py-2 rounded bg-blue-600"
        >
          Share System Audio
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={micEnabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              setMicEnabled(enabled);
              if (enabled) {
                if (micGainRef.current) micGainRef.current.gain.value = systemStream ? 0.2 : 1.0;
                if (stream && micSourceRef.current && mixedDestRef.current) {
                  try { micSourceRef.current.connect(micGainRef.current!).connect(mixedDestRef.current); } catch {}
                  stream.getAudioTracks().forEach(t => t.enabled = true);
                }
              } else {
                if (micGainRef.current) micGainRef.current.gain.value = 0.0;
                if (micSourceRef.current) {
                  try { micSourceRef.current.disconnect(); } catch {}
                }
                if (stream) {
                  stream.getAudioTracks().forEach(t => t.enabled = false);
                }
              }
            }}
          />
          Mic Enable
        </label>
        <span className="text-sm text-gray-400">{status}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 bg-gray-900 rounded p-4 mt-2">
        <div>
          <label className="text-xs text-gray-300">Silence (ms): {silenceMs}</label>
          <input type="range" min={200} max={1500} step={50} value={silenceMs} onChange={(e) => setSilenceMs(Number(e.target.value))} />
        </div>
        <div>
          <label className="text-xs text-gray-300">Max Duration (ms): {maxMs}</label>
          <input type="range" min={1500} max={6000} step={100} value={maxMs} onChange={(e) => setMaxMs(Number(e.target.value))} />
        </div>
        <div>
          <label className="text-xs text-gray-300">Sensitivity (min dB): {minDb}</label>
          <input type="range" min={-90} max={-30} step={1} value={minDb} onChange={(e) => setMinDb(Number(e.target.value))} />
        </div>
        <div>
          <label className="text-xs text-gray-300">Overlap (ms): {overlapMs}</label>
          <input type="range" min={100} max={1000} step={50} value={overlapMs} onChange={(e) => setOverlapMs(Number(e.target.value))} />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-300">Mic Level: {currentDb.toFixed(1)} dB</label>
          <div className="w-full h-2 bg-gray-700 rounded">
            <div className="h-2 bg-green-500 rounded" style={{ width: `${Math.min(100, Math.max(0, ((currentDb + 90) / 60) * 100))}%` }} />
          </div>
        </div>
      </div>
      <AudioVisualizer stream={stream} width={600} height={60} />
      <div className="bg-gray-800 rounded p-4">
        <div className="text-xs text-gray-400 mb-2">Paragraph (In-place update)</div>
        <div className="text-lg break-words whitespace-pre-wrap">
          {segmentsOrder.map((id) => {
            const seg = segmentsMap[id];
            const refinedField = seg?.refined?.text || "";
            const originalField = seg?.original?.text || "";
            const smartRefined = parseSmartly(refinedField);
            if (smartRefined.isFinal && smartRefined.text) {
              return <TextItem id={id} text={smartRefined.text} isRaw={false} />;
            }
            const smartOriginal = parseSmartly(originalField);
            const fallbackText = smartOriginal.text || originalField || refinedField;
            return <TextItem id={id} text={fallbackText} isRaw={!smartOriginal.isFinal} />;
          })}
        </div>
      </div>
    </div>
  );
};

export default LiveConsole;
