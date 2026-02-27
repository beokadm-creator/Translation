// Version: Quality Stable v1
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, rtdb } from "../firebase";
import { ref, onValue, off } from "firebase/database";
import AudioVisualizer from "./AudioVisualizer";
// Status subscription moved to global bar

interface Props {
  projectId: string;
  sourceLabel?: string;
}

const LiveConsole: React.FC<Props> = ({ projectId, sourceLabel = "presenter" }) => {
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
  const segmentBlobRef = useRef<Blob | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const micGainRef = useRef<GainNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  // const [serviceStatus, setServiceStatus] = useState<{openai?: any; gemini?: any; translation?: any}>({});
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadRmsThreshold = 0.01;
  const vadSilenceMs = 1000;
  const maxSegmentMs = 10000;
  const lastVoiceTsRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    const streamRef = ref(rtdb, `sessions/${projectId}/stream`);
    onValue(streamRef, (snap) => {
      const data = snap.val() || {};
      const pairs = Object.entries<any>(data).sort((a, b) => {
        const ta = Number(a[1]?.original?.timestamp || a[1]?.refined?.timestamp || 0);
        const tb = Number(b[1]?.original?.timestamp || b[1]?.refined?.timestamp || 0);
        return ta - tb;
      });
      setSegmentsOrder(pairs.map(([id]) => id));
      const next: Record<string, any> = {};
      pairs.forEach(([id, v]) => {
        next[id] = {
          original: v?.original ? { text: v.original.text, timestamp: Number(v.original.timestamp || 0) } : undefined,
          refined: v?.refined ? { text: v.refined.text, timestamp: Number(v.refined.timestamp || 0) } : undefined,
          status: v?.status || (v?.refined ? 'final' : 'raw')
        };
      });
      setSegmentsMap(next);
    });
    return () => off(streamRef);
  }, [projectId]);

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
      analyserRef.current = analyser;
      const vadSource = ac.createMediaStreamSource(outStream);
      vadSource.connect(analyser);
      lastVoiceTsRef.current = Date.now();
      const mr = new MediaRecorder(outStream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = mr;
      // Restart mode: every 3s stop -> send full blob -> start again
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 1024) segmentBlobRef.current = e.data;
      };
      mr.onstop = async () => {
        const blob = segmentBlobRef.current;
        segmentBlobRef.current = null;
        if (blob && blob.size > 1024) {
          try {
            const buf = await blob.arrayBuffer();
            const token = await auth.currentUser?.getIdToken();
            const isEnd = Date.now() - lastVoiceTsRef.current >= vadSilenceMs ? 1 : 0;
            const url = `https://us-central1-translation-comm.cloudfunctions.net/processAudio?projectId=${encodeURIComponent(projectId)}&sourceLabel=${encodeURIComponent(sourceLabel)}&end=${isEnd}`;
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
      mr.start();
      // VAD loop + max limit safety
      const buf = new Float32Array(analyser.fftSize);
      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        if (rms > vadRmsThreshold) {
          lastVoiceTsRef.current = now;
        }
        // silence for vadSilenceMs
        if (now - lastVoiceTsRef.current >= vadSilenceMs) {
          try { mediaRecorderRef.current?.stop(); } catch {}
          lastVoiceTsRef.current = now; // prevent rapid re-trigger
        } else if (now - lastVoiceTsRef.current >= maxSegmentMs) {
          // safety max segment
          try { mediaRecorderRef.current?.stop(); } catch {}
          lastVoiceTsRef.current = now;
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
      <AudioVisualizer stream={stream} width={600} height={60} />
      <div className="bg-gray-800 rounded p-4">
        <div className="text-xs text-gray-400 mb-2">Paragraph (In-place update)</div>
        <div className="text-lg break-words whitespace-pre-wrap">
          {segmentsOrder.map((id) => {
            const seg = segmentsMap[id];
            const text = seg?.refined?.text || seg?.original?.text || "";
            const isFinal = !!seg?.refined;
            return (
              <span key={id} style={{ opacity: isFinal ? 1 : 0.7, fontWeight: isFinal ? 700 : 500 }}>
                {text + ' '}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default LiveConsole;
