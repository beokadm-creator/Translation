import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { rtdb as database, auth } from '../firebase';
import { ref, onValue, push, set, update, get } from 'firebase/database';
import { useParams } from 'react-router-dom';
import TextItem from './TextItem';
import { useProjectStream } from '../hooks/useProjectStream';
import HealthDashboard from './HealthDashboard';
import { VADRecorder } from '../utils/vad';
import type { StreamSegment } from '../types';


interface Session {
    id: string;
    speaker: string;
    affiliation: string;
    topic: string;
    abstract: string;
    keywords: string;
    startTime: string;
    orderIndex?: number;
    sourceLanguage?: 'ko' | 'en';
    targetLanguages?: string[];
}

const LANG_FLAGS: Record<string, string> = {
    ko: '🇰🇷', en: '🇺🇸'
};

const CF_BASE = import.meta.env.VITE_CF_BASE_URL || 'https://us-central1-translation-comm.cloudfunctions.net';

const AdminDashboard: React.FC = () => {
    const { projectId } = useParams<{ projectId: string }>();
    const activeProjectId = projectId || "default";

    // --- CMS State ---
    const [sessions, setSessions] = useState<Session[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string>("");
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [showProjectSettings, setShowProjectSettings] = useState(false);
    const [settingsTab, setSettingsTab] = useState<'overlay' | 'ai'>('overlay');

    interface ProjectSettings {
        fontSize: number;
        fontColor: string;
        fontWeight: string;
        bgColor: string;
        bgOpacity: number;
        padding: number;
        textEffect: string;
        align: string;
        displayStyle: 'youtube' | 'typing';
        letterSpacing: number;
        maxLines: number;
        lineHeight: number;
        fontFamily: string;
        typingSpeed: number;
        bottomOffset: number;
        minLength: number;
        timeoutMs: number;
        sentenceEnd: boolean;
        vadMaxCutMs: number;
        recordMode: 'chunk' | 'vad';
        hideRaw: boolean;
        chunkInterval: number;
    }

    const [projectSettings, setProjectSettings] = useState<ProjectSettings>({
        fontSize: 48, fontColor: '#ffffff', fontWeight: 'bold', bgColor: '#000000', bgOpacity: 0.6,
        padding: 40, textEffect: 'shadow', align: 'center',
        displayStyle: 'youtube', letterSpacing: 0, maxLines: 2, lineHeight: 1.5,
        fontFamily: 'sans-serif', typingSpeed: 35, bottomOffset: 60,
        minLength: 20, timeoutMs: 3000, sentenceEnd: true, vadMaxCutMs: 15000, chunkInterval: 4000,
        recordMode: 'chunk', hideRaw: true,
    });

    // Load Project Settings
    useEffect(() => {


        get(ref(database, `projects/${activeProjectId}/settings`)).then(snap => {
            if (snap.exists()) {
                const val = snap.val();
                // Merge overlay and chunk settings flatly for easier state management, or keep structure
                // Let's keep it flat in state for simplicity, but save structurally
                setProjectSettings((prev) => ({
                    ...prev,
                    ...(val.overlay || {}),
                    ...(val.chunk || {}),
                    vadMaxCutMs: val.chunk?.vadMaxCutMs || 15000,
                    chunkInterval: val.chunk?.chunkInterval || 4000,
                    recordMode: val.recordMode || 'chunk',
                    hideRaw: val.hideRaw !== undefined ? val.hideRaw : true,
                }));
            }
        });
    }, [activeProjectId]);

    const saveProjectSettings = async () => {
        const updates: Record<string, unknown> = {};
        updates[`projects/${activeProjectId}/settings/overlay`] = {
            fontSize: projectSettings.fontSize,
            fontColor: projectSettings.fontColor,
            fontWeight: projectSettings.fontWeight,
            bgColor: projectSettings.bgColor,
            bgOpacity: projectSettings.bgOpacity,
            padding: projectSettings.padding,
            textEffect: projectSettings.textEffect,
            align: projectSettings.align,
            displayStyle: projectSettings.displayStyle,
            letterSpacing: projectSettings.letterSpacing,
            maxLines: projectSettings.maxLines,
            lineHeight: projectSettings.lineHeight,
            fontFamily: projectSettings.fontFamily,
            typingSpeed: projectSettings.typingSpeed,
            bottomOffset: projectSettings.bottomOffset,
        };
        updates[`projects/${activeProjectId}/settings/chunk`] = {
            minLength: Number(projectSettings.minLength),
            timeoutMs: Number(projectSettings.timeoutMs),
            sentenceEnd: Boolean(projectSettings.sentenceEnd),
            vadMaxCutMs: Number(projectSettings.vadMaxCutMs),
            chunkInterval: Number(projectSettings.chunkInterval)
        };
        updates[`projects/${activeProjectId}/settings/recordMode`] = projectSettings.recordMode;
        updates[`projects/${activeProjectId}/settings/hideRaw`] = Boolean(projectSettings.hideRaw);

        await update(ref(database), updates);
        alert("Settings Saved!");
        setShowProjectSettings(false);
    };


    // Form State
    const [formData, setFormData] = useState<Partial<Session>>({});

    // --- Recorder State ---
    const [isRecording, setIsRecording] = useState(false);
    const [status, setStatus] = useState<string>("idle");
    const [currentDb, setCurrentDb] = useState<number>(-90);

    const triggerPurge = async () => {
        if (!activeProjectId) return;
        if (!window.confirm("주의: 현재 라이브 중인 모든 스트림 데이터를 '완전히' 삭제하시겠습니까? (복구 불가)")) return;

        try {
            const token = await auth.currentUser?.getIdToken();
            const res = await fetch(`${CF_BASE}/purgeSession?projectId=${activeProjectId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                }
            });
            const data = await res.json();
            if (data.success) {
                alert("스트림이 초기화되었습니다.");
                setSegmentsMap({});
            } else {
                alert("초기화 실패: " + data.error);
            }
        } catch (e: any) {
            console.error("Purge Failed:", e);
            alert("초기화 실패: " + e.message);
        }
    };


    const [stream, setStream] = useState<MediaStream | null>(null);
    const mr1Ref = useRef<MediaRecorder | null>(null);
    const mr2Ref = useRef<MediaRecorder | null>(null);
    const activeIndexRef = useRef<number>(0);
    const chunks1Ref = useRef<Blob[]>([]);
    const chunks2Ref = useRef<Blob[]>([]);
    const segmentTimerRef = useRef<number | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const rafIdRef = useRef<number | null>(null);
    const [sourceType, setSourceType] = useState<'mic' | 'system'>('mic');
    const vadRef = useRef<VADRecorder | null>(null);

    // Ref로 최신 설정값 추적 (startRecording 클로저 stale 방지)
    const recordModeRef = useRef(projectSettings.recordMode);
    const chunkIntervalRef = useRef(projectSettings.chunkInterval);
    const vadMaxCutMsRef = useRef(projectSettings.vadMaxCutMs);
    useEffect(() => {
        recordModeRef.current = projectSettings.recordMode;
    }, [projectSettings.recordMode]);
    useEffect(() => {
        chunkIntervalRef.current = projectSettings.chunkInterval;
    }, [projectSettings.chunkInterval]);
    useEffect(() => {
        vadMaxCutMsRef.current = projectSettings.vadMaxCutMs;
    }, [projectSettings.vadMaxCutMs]);

    // --- Isolation View State ---
    const [viewMode, setViewMode] = useState<'live' | 'archive'>('live');

    // Hook always runs, but we ignore its data if not in live mode
    const { streamData } = useProjectStream(activeProjectId, { subscribe: true });

    const [segmentsMap, setSegmentsMap] = useState<Record<string, StreamSegment>>({});


    // --- 1. CMS Logic ---
    useEffect(() => {
        const sessionsRef = ref(database, `projects/${activeProjectId}/sessions`);
        const activeRef = ref(database, `projects/${activeProjectId}/activeSessionId`);

        const unsubSessions = onValue(sessionsRef, (snap) => {
            const data = snap.val();
            if (data) {
                const list = Object.entries(data).map(([k, v]: [string, unknown]) => ({ id: k, ...(v as Omit<Session, 'id'>) }));
                // Sort by orderIndex, then startTime
                list.sort((a, b) => {
                    const oa = a.orderIndex ?? 9999;
                    const ob = b.orderIndex ?? 9999;
                    if (oa !== ob) return oa - ob;
                    return a.startTime.localeCompare(b.startTime);
                });
                setSessions(list);
            } else {
                setSessions([]);
            }
        });

        const unsubActive = onValue(activeRef, (snap) => {
            setActiveSessionId(snap.val() || "");
        });

        return () => { unsubSessions(); unsubActive(); };
    }, [activeProjectId]);

    // --- 2. Isolation Data Logic ---
    useEffect(() => {
        if (!selectedSessionId) {
            // Reset to initial state instead of calling setState in effect body
            return;
        }

        if (selectedSessionId === activeSessionId) {
            // Live Mode: Use streamData
            Promise.resolve().then(() => setViewMode('live'));
            if (streamData) {
                Promise.resolve().then(() => setSegmentsMap(prev => {
                    const next = { ...prev };
                    let changed = false;
                    Object.entries(streamData).forEach(([k, v]: [string, unknown]) => {
                        if (!v) return;
                        const value = v as StreamSegment;
                        if (value.mergedIds && Array.isArray(value.mergedIds)) {
                            value.mergedIds.forEach((pid: string) => {
                                if (next[pid]) { delete next[pid]; changed = true; }
                            });
                        }
                        if (JSON.stringify(prev[k]) !== JSON.stringify(v)) {
                            next[k] = value;
                            changed = true;
                        }
                    });
                    return changed ? next : prev;
                }));
            }
        } else {
            // Archive Mode: Fetch Transcript Once
            Promise.resolve().then(() => setViewMode('archive'));
            // Clear by setting to empty object
            const emptySegments: Record<string, StreamSegment> = {};
            Promise.resolve().then(() => setSegmentsMap(emptySegments));
            get(ref(database, `projects/${activeProjectId}/sessions/${selectedSessionId}/transcript`)).then(snap => {
                if (snap.exists()) {
                    Promise.resolve().then(() => setSegmentsMap(snap.val() as Record<string, StreamSegment>));
                } else {
                    Promise.resolve().then(() => setSegmentsMap(emptySegments));
                }
            });
        }
    }, [selectedSessionId, activeSessionId, streamData, activeProjectId]);

    // Derive segmentsOrder from segmentsMap using useMemo instead of useEffect with setState
    const segmentsOrder = useMemo(() => {
        return Object.keys(segmentsMap).sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0]));
    }, [segmentsMap]);

    // --- Handlers ---
    const handleCreateSession = () => {
        const newRef = push(ref(database, `projects/${activeProjectId}/sessions`));
        const maxOrder = sessions.reduce((max, s) => Math.max(max, s.orderIndex || 0), 0);
        const newSession: Session = {
            id: newRef.key!,
            speaker: "New Speaker",
            affiliation: "Affiliation",
            topic: "New Topic",
            abstract: "",
            keywords: "",
            startTime: "09:00",
            orderIndex: maxOrder + 1,
            sourceLanguage: 'ko',
            targetLanguages: ['en']
        };
        set(newRef, newSession);
        setSelectedSessionId(newSession.id);
        setFormData(newSession);
    };

    const handleSelectSession = (s: Session) => {
        setSelectedSessionId(s.id);
        setFormData(s);
    };

    const handleSaveSession = async () => {
        if (!selectedSessionId) return;
        await update(ref(database, `projects/${activeProjectId}/sessions/${selectedSessionId}`), formData);
        alert("Saved!");
    };

    const handleMove = async (index: number, direction: -1 | 1) => {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= sessions.length) return;

        const s1 = sessions[index];
        const s2 = sessions[targetIndex];

        // Swap orderIndex
        // If orderIndex is missing, treat as index
        const o1 = s1.orderIndex ?? index;
        const o2 = s2.orderIndex ?? targetIndex;

        // To ensure swap works even if values are same or missing, we explicitly assign new values
        // But simple swap of existing values might be enough if they are distinct.
        // Let's just swap their entire orderIndex values in DB.
        // If they don't have orderIndex, we should assign to all first? 
        // Assuming they have orderIndex from creation or previous sort.

        await update(ref(database, `projects/${activeProjectId}/sessions/${s1.id}`), { orderIndex: o2 });
        await update(ref(database, `projects/${activeProjectId}/sessions/${s2.id}`), { orderIndex: o1 });
    };

    const triggerArchive = async (sessionIdToArchive: string) => {
        try {
            const token = await auth.currentUser?.getIdToken();
            await fetch(`${CF_BASE}/archiveSession`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ projectId: activeProjectId, sessionId: sessionIdToArchive })
            });
        } catch (e) {
            console.error("Archive Failed:", e);
        }
    };

    const handleDeleteSession = async (s: Session) => {
        if (!window.confirm(`Delete session "${s.speaker}"? This cannot be undone.`)) return;
        if (activeSessionId === s.id) {
            alert("Cannot delete active live session. Stop live first.");
            return;
        }
        await set(ref(database, `projects/${activeProjectId}/sessions/${s.id}`), null);
        if (selectedSessionId === s.id) setSelectedSessionId(null);
    };

    const handleClearTranscript = async () => {
        if (!selectedSessionId) return;
        if (!window.confirm("Clear all transcript data for this session?")) return;
        await set(ref(database, `projects/${activeProjectId}/sessions/${selectedSessionId}/transcript`), null);
        setSegmentsMap({});
    };

    const handleGoLive = async () => {
        if (!selectedSessionId) return;

        if (activeSessionId !== selectedSessionId) {
            const s = sessions.find(s => s.id === selectedSessionId);
            if (s && !s.abstract?.trim()) {
                if (!window.confirm("⚠️ Abstract(초록)가 비어있습니다.\nAI 번역 품질이 낮아질 수 있습니다.\n그래도 라이브를 시작하시겠습니까?")) return;
            }
        }

        if (activeSessionId === selectedSessionId) {
            if (!window.confirm("Stop Live Broadcast? This will archive the current session.")) return;
            await triggerArchive(activeSessionId);
            await set(ref(database, `projects/${activeProjectId}/activeSessionId`), null);
            return;
        }

        if (activeSessionId && activeSessionId !== selectedSessionId) {
            if (!window.confirm(`Switch Live to new session? Current session (${activeSessionId}) will be archived.`)) return;
            await triggerArchive(activeSessionId);
        }

        await set(ref(database, `projects/${activeProjectId}/activeSessionId`), selectedSessionId);
    };

    const handleExport = () => {
        if (!segmentsOrder.length) return;
        let content = `Session Transcript\nSpeaker: ${formData.speaker}\nTopic: ${formData.topic}\n\n`;

        segmentsOrder.forEach(id => {
            const seg = segmentsMap[id];
            if (!seg) return;
            const time = new Date(seg.timestamp || 0).toLocaleTimeString();
            const text = seg.refined || seg.original || "";
            if (text) content += `[${time}] ${text}\n`;
        });

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${formData.speaker}_transcript.txt`;
        a.click();
    };

    // --- Recorder Logic (Keep existing) ---

    // --- Recorder Logic (Keep existing) ---
    const uploadChunks = async (chunks: Blob[]) => {
        if (chunks.length === 0) return;
        const blob = new Blob(chunks, { type: "audio/webm" });
        // CF TooSmall 기준 2000바이트 미만이면 무음/노이즈이므로 스킵
        if (blob.size < 2000) {
            console.log(`[Upload] Skip: too small (${blob.size}B)`);
            return;
        }
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) {
                console.error('[Upload] No auth token - 로그인 필요');
                return;
            }
            const buf = await blob.arrayBuffer();
            const activeSession = sessions.find(s => s.id === activeSessionId);
            const currentLang = activeSession?.sourceLanguage || 'ko';
            const url = `${CF_BASE}/processAudio?projectId=${encodeURIComponent(activeProjectId)}&sourceLabel=admin&sourceLang=${currentLang}`;
            console.log(`[Upload] Sending ${blob.size}B → CF (project=${activeProjectId}, lang=${currentLang})`);
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
                body: buf
            }).then(async r => {
                const data = await r.json().catch(() => ({}));
                if (r.ok && data.success) {
                    if (data.info || data.error === 'TooSmall') {
                        console.log(`[Upload] CF filtered: ${data.error || data.info}`);
                    } else {
                        setStatus('streaming');
                        console.log(`[Upload] ✅ OK - "${data.text ? data.text.slice(0, 50) : 'empty/filtered'}"`);
                    }
                } else if (r.status === 401) {
                    console.error('[Upload] ❌ 401 Unauthorized');
                } else {
                    console.warn('[Upload] CF error:', data);
                    setStatus('error');
                }
            }).catch(e => { console.error('[Upload] Network error:', e); setStatus('error'); });
            setStatus('streaming');
        } catch (e) { console.error('[Upload] Error:', e); setStatus('error'); }
    };

    const startRecording = async () => {
        try {
            let mic: MediaStream;
            if (sourceType === 'system') {
                const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
                displayStream.getVideoTracks().forEach((track: MediaStreamTrack) => track.stop());
                const audioTracks = displayStream.getAudioTracks();
                if (audioTracks.length === 0) { alert("System audio not shared."); return; }
                mic = new MediaStream([audioTracks[0]]);
            } else {
                mic = await navigator.mediaDevices.getUserMedia({ audio: true });
            }
            setStream(mic);
            const ac = new (window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
            audioContextRef.current = ac;
            const source = ac.createMediaStreamSource(mic);
            const gainNode = ac.createGain();
            gainNode.gain.value = 2.5;
            const analyser = ac.createAnalyser();
            analyser.fftSize = 2048;
            analyserRef.current = analyser;
            source.connect(gainNode);
            gainNode.connect(analyser);
            const dest = ac.createMediaStreamDestination();
            gainNode.connect(dest);

            const createRecorder = (targetChunksRef: React.MutableRefObject<Blob[]>) => {
                const mr = new MediaRecorder(dest.stream, { mimeType: "audio/webm" });
                mr.ondataavailable = (e) => { if (e.data.size > 0) targetChunksRef.current.push(e.data); };
                mr.onstop = () => { const chunks = [...targetChunksRef.current]; targetChunksRef.current = []; uploadChunks(chunks); };
                return mr;
            };

            mr1Ref.current = createRecorder(chunks1Ref);
            mr2Ref.current = createRecorder(chunks2Ref);
            activeIndexRef.current = 0;
            mr1Ref.current.start();
            setIsRecording(true);
            setStatus("recording");

            const scheduleNextCut = (ms: number) => {
                if (segmentTimerRef.current) window.clearTimeout(segmentTimerRef.current);
                segmentTimerRef.current = window.setTimeout(() => {
                    console.log("Forced Timeout -> Cutting");
                    switchRecorders();
                }, ms);
            };

            const switchRecorders = () => {
                const nextIndex = activeIndexRef.current === 0 ? 1 : 0;
                const nextMR = nextIndex === 0 ? mr1Ref.current : mr2Ref.current;
                const currentMR = activeIndexRef.current === 0 ? mr1Ref.current : mr2Ref.current;
                if (nextMR && nextMR.state === 'inactive') nextMR.start();
                if (currentMR && currentMR.state === 'recording') currentMR.stop();
                activeIndexRef.current = nextIndex;

                const currentMode = recordModeRef.current || 'chunk';
                const interval = chunkIntervalRef.current || 2000;
                scheduleNextCut(currentMode === 'vad' ? vadMaxCutMsRef.current : interval);
            };

            const currentMode = recordModeRef.current || 'chunk';
            console.log("Start Recording with Mode:", currentMode);

            if (currentMode === 'vad') {
                // VAD Mode: Switch on silence
                console.log("Starting VAD Mode");
                vadRef.current = new VADRecorder(mic, () => {
                    console.log("VAD: Silence Detected -> Cutting");
                    switchRecorders();
                });
                // Safety: Force cut every configured ms if no silence
                scheduleNextCut(vadMaxCutMsRef.current);
            } else {
                // Chunk Mode: Switch every N ms
                const interval = chunkIntervalRef.current || 2000;
                console.log(`Starting Chunk Mode (${interval}ms)`);
                scheduleNextCut(interval);
            }

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
        } catch (e) { console.error(e); setStatus("mic_error"); }
    };

    const stopRecording = useCallback(() => {
        if (segmentTimerRef.current) window.clearTimeout(segmentTimerRef.current);
        if (vadRef.current) {
            vadRef.current.destroy();
            vadRef.current = null;
        }
        if (mr1Ref.current?.state === 'recording') mr1Ref.current.stop();
        if (mr2Ref.current?.state === 'recording') mr2Ref.current.stop();
        stream?.getTracks().forEach(t => t.stop());
        audioContextRef.current?.close();
        if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        setIsRecording(false);
        setStatus("idle");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stream]);

    // Effect: Restart recording if mode changes while recording
    useEffect(() => {
        if (isRecording) {
            console.log("Record Mode Changed, Restarting...");
            stopRecording();
            const t = setTimeout(() => startRecording(), 500);
            return () => clearTimeout(t);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectSettings.recordMode, projectSettings.chunkInterval]);

    return (
        <div className="flex h-screen bg-[#0a0a0a] text-gray-200 overflow-hidden font-sans selection:bg-blue-500/30">
            {/* Sidebar: Agenda */}
            <div className="w-72 bg-[#0a0a0a] border-r border-white/5 flex flex-col z-10 shadow-xl">
                <div className="p-5 border-b border-white/5 flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-300 uppercase tracking-widest">Agenda</span>
                    <div className="flex gap-2">
                        <button onClick={() => setShowProjectSettings(true)} className="text-xs text-gray-400 hover:text-white transition-colors" title="Overlay & AI Settings">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                        </button>
                        <button onClick={handleCreateSession} className="text-xs bg-white text-black px-2.5 py-1 rounded font-medium hover:bg-gray-200 transition-colors">+ New</button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-1">
                    {sessions.map((s, idx) => (
                        <div
                            key={s.id}
                            onClick={() => handleSelectSession(s)}
                            className={`p-3 rounded-lg cursor-pointer transition-all flex gap-3 group ${activeSessionId === s.id ? 'bg-red-500/10 border border-red-500/30' : selectedSessionId === s.id ? 'bg-white/10' : 'hover:bg-white/5'}`}
                        >
                            <div className="flex flex-col gap-1 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={(e) => { e.stopPropagation(); handleMove(idx, -1); }} className="text-gray-500 hover:text-white">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"></path></svg>
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); handleMove(idx, 1); }} className="text-gray-500 hover:text-white">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"></path></svg>
                                </button>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[10px] text-gray-500 font-mono">{s.startTime}</span>
                                    {activeSessionId === s.id && <span className="text-[10px] text-red-400 font-bold flex items-center gap-1"><span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span> LIVE</span>}
                                </div>
                                <div className="font-medium text-sm text-gray-200 truncate group-hover:text-white transition-colors">
                                    <span className="text-xs mr-1 opacity-70">{LANG_FLAGS[s.sourceLanguage || 'ko']}</span>
                                    {s.speaker}
                                </div>
                                <div className="text-[10px] text-gray-500 truncate mt-0.5">{s.topic}</div>
                            </div>
                            <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity justify-center">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const tgtLang = s.sourceLanguage === 'en' ? 'ko' : 'en';
                                        window.open(`/overlay/${activeProjectId}/${tgtLang}`, '_blank');
                                    }}
                                    title="Open Overlay"
                                    className="text-gray-500 hover:text-white"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg>
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteSession(s); }} className="text-gray-500 hover:text-red-400">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>


            {/* Main: Workspace */}
            <div className="flex-1 flex min-w-0">
                {/* Left: Metadata Editor (Session Settings) */}
                <div className="w-1/2 p-6 border-r border-white/5 bg-[#0a0a0a] flex flex-col">
                    {selectedSessionId ? (
                        <div className="max-w-2xl mx-auto flex flex-col h-full w-full">
                            <div className="flex justify-between items-center mb-6 shrink-0">
                                <h2 className="text-xl font-semibold tracking-tight text-gray-100">Session Settings</h2>
                                <div className="flex gap-2">
                                    <button onClick={handleSaveSession} className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-md text-xs font-medium text-gray-300 transition-colors">Save</button>
                                    <button onClick={handleGoLive} className={`px-4 py-2 rounded-md text-xs font-bold transition-colors ${activeSessionId === selectedSessionId ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-600 text-white hover:bg-green-500'}`}>
                                        {activeSessionId === selectedSessionId ? 'Live Active' : 'Go Live'}
                                    </button>
                                </div>
                            </div>

                            {/* Overlay Links */}
                            {(() => {
                                const srcLang = (formData.sourceLanguage || 'ko') as 'ko' | 'en';
                                const tgtLang = srcLang === 'ko' ? 'en' : 'ko';
                                const origin = window.location.origin;
                                const links = [
                                    { lang: tgtLang, label: tgtLang === 'en' ? '🇺🇸 English Overlay' : '🇰🇷 Korean Overlay', primary: true },
                                    { lang: 'refined', label: srcLang === 'ko' ? '🇰🇷 Korean (Raw)' : '🇺🇸 English (Raw)', primary: false },
                                ];
                                return (
                                    <div className="flex gap-2 mb-6 p-3 bg-[#111111] rounded-lg border border-white/5 flex-wrap items-center shrink-0">
                                        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mr-2">Overlays</span>
                                        {links.map(({ lang, label, primary }) => {
                                            const url = `${origin}/overlay/${activeProjectId}/${lang}`;
                                            return (
                                                <div key={lang} className="flex items-center gap-1">
                                                    <button
                                                        onClick={() => window.open(url, '_blank')}
                                                        className={`px-3 py-1.5 rounded-md text-[10px] font-medium transition-colors ${primary ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-white/5 hover:bg-white/10 text-gray-300'}`}
                                                    >
                                                        {label}
                                                    </button>
                                                    <button
                                                        onClick={() => { navigator.clipboard.writeText(url); }}
                                                        title="Copy URL"
                                                        className="text-gray-500 hover:text-gray-300 p-1"
                                                    >
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                            
                            <div className="flex flex-col gap-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">Speaker Name</label>
                                        <input className="w-full bg-[#111111] border border-white/10 rounded-md px-3 py-1.5 text-sm focus:border-white/30 outline-none text-gray-100 placeholder-gray-600 transition-colors" value={formData.speaker || ''} onChange={e => setFormData({ ...formData, speaker: e.target.value })} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">Affiliation</label>
                                        <input className="w-full bg-[#111111] border border-white/10 rounded-md px-3 py-1.5 text-sm focus:border-white/30 outline-none text-gray-100 placeholder-gray-600 transition-colors" value={formData.affiliation || ''} onChange={e => setFormData({ ...formData, affiliation: e.target.value })} />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">Time</label>
                                        <input className="w-full bg-[#111111] border border-white/10 rounded-md px-3 py-1.5 text-sm focus:border-white/30 outline-none text-gray-100 placeholder-gray-600 transition-colors font-mono" value={formData.startTime || ''} onChange={e => setFormData({ ...formData, startTime: e.target.value })} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">Topic</label>
                                        <input className="w-full bg-[#111111] border border-white/10 rounded-md px-3 py-1.5 text-sm focus:border-white/30 outline-none text-gray-100 placeholder-gray-600 transition-colors" value={formData.topic || ''} onChange={e => setFormData({ ...formData, topic: e.target.value })} />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">Source Language</label>
                                        <div className="relative">
                                            <select
                                                className="w-full bg-[#111111] border border-white/10 rounded-md px-3 py-1.5 text-sm focus:border-white/30 outline-none text-gray-100 transition-colors appearance-none"
                                                value={formData.sourceLanguage || 'ko'}
                                                onChange={e => {
                                                    const src = e.target.value as 'ko' | 'en';
                                                    const tgt = src === 'ko' ? ['en'] : ['ko'];
                                                    setFormData({ ...formData, sourceLanguage: src, targetLanguages: tgt });
                                                }}
                                            >
                                                <option value="ko">Korean (한국어)</option>
                                                <option value="en">English (영어)</option>
                                            </select>
                                            <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-gray-500">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"></path></svg>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">Target Language <span className="normal-case tracking-normal text-gray-600 ml-1">(Auto)</span></label>
                                        <div className="flex gap-3 px-3 py-1.5 bg-[#111111]/50 rounded-md border border-white/5 h-[34px] items-center">
                                            {['ko', 'en'].map(l => (
                                                <label key={l} className={`flex items-center gap-2 ${(formData.targetLanguages || []).includes(l) ? 'text-gray-200' : 'text-gray-600'} cursor-not-allowed`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={(formData.targetLanguages || []).includes(l)}
                                                        disabled
                                                        className="rounded border-white/10 bg-black/50 accent-gray-500"
                                                    />
                                                    <span className="uppercase text-xs font-medium">{l}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-1.5 flex flex-col min-h-[80px]">
                                    <label className="flex items-center text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1.5 shrink-0">
                                        Keywords
                                        <span className="ml-2 text-[9px] bg-white/5 border border-white/10 text-gray-400 px-1.5 py-0.5 rounded normal-case tracking-normal">Comma separated</span>
                                    </label>
                                    <textarea className="w-full flex-1 bg-[#111111] border border-white/10 rounded-md px-3 py-2 text-sm focus:border-white/30 outline-none text-gray-100 placeholder-gray-600 transition-colors resize-none leading-relaxed" placeholder="e.g. Implant, Sinus, Bone Graft" value={formData.keywords || ''} onChange={e => setFormData({ ...formData, keywords: e.target.value })} />
                                </div>

                                <div className="space-y-1.5 flex flex-col flex-1 min-h-[120px]">
                                    <label className="flex items-center text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1.5 shrink-0">
                                        Abstract (초록)
                                        <span className="ml-2 text-[9px] bg-white/5 border border-white/10 text-gray-400 px-1.5 py-0.5 rounded normal-case tracking-normal">Improves AI Context</span>
                                    </label>
                                    <textarea className="w-full flex-1 bg-[#111111] border border-white/10 rounded-md px-3 py-3 text-sm focus:border-white/30 outline-none text-gray-100 placeholder-gray-600 transition-colors resize-none leading-relaxed" placeholder="Enter abstract or presentation content. The first 60 characters are sent to the STT model to improve domain terminology recognition." value={formData.abstract || ''} onChange={e => setFormData({ ...formData, abstract: e.target.value })} />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-4">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            <span className="text-sm">Select a session from the agenda</span>
                        </div>
                    )}
                </div>

                {/* Right: Monitor & Controls */}
                <div className="w-1/2 bg-[#0a0a0a] flex flex-col p-6">
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-4">
                            <div className="flex bg-[#111111] rounded-md p-1 border border-white/5">
                                <button onClick={() => setSourceType('mic')} className={`px-3 py-1.5 text-xs font-medium rounded ${sourceType === 'mic' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-400 hover:text-gray-300'}`}>Mic</button>
                                <button onClick={() => setSourceType('system')} className={`px-3 py-1.5 text-xs font-medium rounded ${sourceType === 'system' ? 'bg-white/10 text-white shadow-sm' : 'text-gray-400 hover:text-gray-300'}`}>System</button>
                            </div>
                            <button onClick={isRecording ? stopRecording : startRecording} className={`px-5 py-2 rounded-md text-xs font-bold transition-all ${isRecording ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20" : "bg-white text-black hover:bg-gray-200"}`}>
                                {isRecording ? "STOP BROADCAST" : "START BROADCAST"}
                            </button>

                            {/* Remaster Button for Admin */}
                            {/* REMOVED from here as per user request */}

                            <div className="w-32 h-1.5 bg-white/10 rounded-full ml-2 relative overflow-hidden">
                                <div className="h-full bg-green-500 rounded-full transition-all duration-75" style={{ width: `${Math.min(100, Math.max(0, ((currentDb + 90) / 60) * 100))}%` }} />
                            </div>
                            {/* Health Dashboard */}
                            <HealthDashboard projectId={activeProjectId} />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Status</span>
                            <span className={`text-xs font-medium ${status === 'recording' || status === 'streaming' ? 'text-green-400' : 'text-gray-400'}`}>{status}</span>
                        </div>
                    </div>

                    {/* Log Window with Header */}
                    <div className="flex-1 flex flex-col border border-white/5 rounded-xl overflow-hidden bg-[#111111] shadow-inner">
                        <div className="bg-[#1a1a1a] p-3 flex justify-between items-center border-b border-white/5">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-300">
                                    {selectedSessionId ? `Transcript: ${formData.speaker}` : "Transcript Viewer"}
                                </span>
                                {selectedSessionId && (
                                    <span className={`text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold ${viewMode === 'live' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-white/5 text-gray-400 border border-white/10'}`}>
                                        {viewMode === 'live' ? 'LIVE' : 'ARCHIVED'}
                                    </span>
                                )}
                            </div>

                            <div className="flex gap-2">
                                {/* Manual Remaster Button (For Live Monitoring Cleanup) */}
                                {viewMode === 'live' && activeSessionId && (
                                    <div className="flex gap-1">
                                        <button
                                            onClick={triggerPurge}
                                            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 transition-colors"
                                            title="완전 삭제 (클랜징)"
                                        >
                                            Purge
                                        </button>
                                    </div>
                                )}


                                {viewMode === 'archive' && (
                                    <>
                                        <button onClick={handleExport} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-[10px] font-bold uppercase tracking-wider rounded-md text-gray-300 transition-colors">
                                            Export
                                        </button>
                                        <button onClick={handleClearTranscript} className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-[10px] font-bold uppercase tracking-wider rounded-md text-red-400 border border-red-500/20 transition-colors">
                                            Clear
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5 scroll-smooth">
                            <div className="text-sm break-words leading-relaxed space-y-2">
                                {segmentsOrder.map((id) => {
                                    const seg = segmentsMap[id];
                                    if (seg?.status === 'merged') return null;
                                    if (projectSettings.hideRaw && seg?.status === 'raw') return null;
                                    const text = seg?.refined || seg?.original || "";
                                    const isFinal = seg?.status === 'final';
                                    return <TextItem key={id} id={id} text={text} isRaw={!isFinal} />;
                                })}
                                <div className="h-8" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {/* Settings Modal */}
            {
                showProjectSettings && (
                    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                        <div className="bg-[#111111] p-6 rounded-xl w-full max-w-2xl space-y-5 border border-white/10 shadow-2xl">
                            <div className="flex justify-between items-center border-b border-white/5 pb-4">
                                <h2 className="text-lg font-semibold tracking-tight text-gray-100">Project Settings</h2>
                                <div className="flex gap-2 text-[10px]">
                                    <span className="bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-1 rounded-md font-mono">STT: gpt-4o-transcribe</span>
                                    <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-1 rounded-md font-mono">Trans: gpt-4o-mini</span>
                                </div>
                            </div>

                            {/* Tabs */}
                            <div className="flex border-b border-white/5 mb-4">
                                <button onClick={() => setSettingsTab('overlay')} className={`px-4 py-2 text-sm font-medium transition-colors ${settingsTab === 'overlay' ? 'border-b-2 border-white text-white' : 'text-gray-500 hover:text-gray-300'}`}>Overlay Design</button>
                                <button onClick={() => setSettingsTab('ai')} className={`px-4 py-2 text-sm font-medium transition-colors ${settingsTab === 'ai' ? 'border-b-2 border-white text-white' : 'text-gray-500 hover:text-gray-300'}`}>Audio & AI</button>
                            </div>

                            <div className="space-y-6 overflow-y-auto max-h-[60vh] pr-2 custom-scrollbar">
                                {/* Section 0: Model Info + Audio Engine */}
                                {settingsTab === 'ai' && <>
                                    <div className="bg-[#1a1a1a] border border-white/5 p-4 rounded-lg space-y-3">
                                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Active Models</h3>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="bg-[#111111] rounded-md p-3 border border-white/5">
                                                <div className="text-[10px] text-gray-500 mb-1 uppercase tracking-widest">STT (Speech to Text)</div>
                                                <div className="text-sm font-medium text-green-400">gpt-4o-transcribe</div>
                                            </div>
                                            <div className="bg-[#111111] rounded-md p-3 border border-white/5">
                                                <div className="text-[10px] text-gray-500 mb-1 uppercase tracking-widest">Translation</div>
                                                <div className="text-sm font-medium text-blue-400">gpt-4o-mini</div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-[#1a1a1a] p-4 rounded-lg border border-white/5 space-y-3">
                                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                                            Audio Capture Mode <span className="text-[10px] font-normal normal-case tracking-normal text-gray-400 bg-white/5 px-1.5 py-0.5 rounded">(Can change during live)</span>
                                        </h3>
                                        <div className="flex gap-4">
                                            <label className={`flex-1 p-4 rounded-lg border cursor-pointer transition-all ${projectSettings.recordMode === 'chunk' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-[#111111] border-white/5 hover:border-white/20'}`}>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <input type="radio" name="recordMode" value="chunk" checked={projectSettings.recordMode === 'chunk'} onChange={() => setProjectSettings({ ...projectSettings, recordMode: 'chunk' })} className="hidden" />
                                                    <span className={`font-medium text-sm ${projectSettings.recordMode === 'chunk' ? 'text-blue-400' : 'text-gray-300'}`}>Interval (Chunk)</span>
                                                </div>
                                                <p className="text-xs text-gray-500 leading-relaxed">
                                                    Fixed interval transmission. Recommended for Q&A and multi-speaker.<br/>
                                                    <span className="text-[10px] text-gray-600 mt-1 block">Shorter intervals may reduce context.</span>
                                                </p>
                                            </label>

                                            <label className={`flex-1 p-4 rounded-lg border cursor-pointer transition-all ${projectSettings.recordMode === 'vad' ? 'bg-green-500/10 border-green-500/30' : 'bg-[#111111] border-white/5 hover:border-white/20'}`}>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <input type="radio" name="recordMode" value="vad" checked={projectSettings.recordMode === 'vad'} onChange={() => setProjectSettings({ ...projectSettings, recordMode: 'vad' })} className="hidden" />
                                                    <span className={`font-medium text-sm ${projectSettings.recordMode === 'vad' ? 'text-green-400' : 'text-gray-300'}`}>Silence (VAD)</span>
                                                </div>
                                                <p className="text-xs text-gray-500 leading-relaxed">
                                                    Auto transmission on pause. Recommended for keynotes.<br/>
                                                    <span className="text-[10px] text-gray-600 mt-1 block">May need tuning for fast speakers.</span>
                                                </p>
                                            </label>
                                        </div>
                                    </div>
                                </>}

                                {/* Section 1: Overlay */}
                                {settingsTab === 'overlay' && <div className="space-y-6">

                                    {/* Display Style */}
                                    <div className="space-y-3">
                                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Display Style</h3>
                                        <div className="grid grid-cols-2 gap-3">
                                            {(['youtube', 'typing'] as const).map(style => (
                                                <button key={style}
                                                    onClick={() => setProjectSettings({ ...projectSettings, displayStyle: style })}
                                                    className={`py-3 rounded-lg border text-sm font-medium transition-all ${projectSettings.displayStyle === style ? 'bg-white/10 border-white/20 text-white' : 'bg-[#1a1a1a] border-white/5 text-gray-400 hover:border-white/10 hover:text-gray-300'}`}>
                                                    {style === 'youtube' ? 'YouTube Style' : 'Typing Style'}
                                                </button>
                                            ))}
                                        </div>
                                        {projectSettings.displayStyle === 'typing' && (
                                            <div className="mt-4 bg-[#1a1a1a] p-4 rounded-lg border border-white/5">
                                                <label className="text-xs text-gray-400 flex justify-between mb-2">
                                                    <span>Typing Speed</span>
                                                    <span className="text-gray-200 font-mono">{projectSettings.typingSpeed} chars/s</span>
                                                </label>
                                                <input type="range" min="10" max="100" step="5" className="w-full accent-white"
                                                    value={projectSettings.typingSpeed}
                                                    onChange={e => setProjectSettings({ ...projectSettings, typingSpeed: Number(e.target.value) })} />
                                            </div>
                                        )}
                                    </div>

                                    {/* Layout */}
                                    <div className="space-y-3">
                                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Layout</h3>
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-400 uppercase tracking-wider block">Max Lines</label>
                                                <select className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20" value={projectSettings.maxLines}
                                                    onChange={e => setProjectSettings({ ...projectSettings, maxLines: Number(e.target.value) })}>
                                                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} Lines</option>)}
                                                </select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-400 uppercase tracking-wider block">Align</label>
                                                <select className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20" value={projectSettings.align}
                                                    onChange={e => setProjectSettings({ ...projectSettings, align: e.target.value })}>
                                                    <option value="left">Left</option>
                                                    <option value="center">Center</option>
                                                    <option value="right">Right</option>
                                                </select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-400 uppercase tracking-wider block">Bottom Offset</label>
                                                <input type="number" className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20 font-mono"
                                                    value={projectSettings.bottomOffset}
                                                    onChange={e => setProjectSettings({ ...projectSettings, bottomOffset: Number(e.target.value) })} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Font */}
                                    <div className="space-y-3">
                                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Typography</h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-400 uppercase tracking-wider block">Size (px)</label>
                                                <input type="number" min="12" max="120" className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20 font-mono"
                                                    value={projectSettings.fontSize}
                                                    onChange={e => setProjectSettings({ ...projectSettings, fontSize: Number(e.target.value) })} />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-400 uppercase tracking-wider block">Weight</label>
                                                <select className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20" value={projectSettings.fontWeight}
                                                    onChange={e => setProjectSettings({ ...projectSettings, fontWeight: e.target.value })}>
                                                    <option value="normal">Normal</option>
                                                    <option value="bold">Bold</option>
                                                    <option value="800">Extra Bold</option>
                                                </select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-400 uppercase tracking-wider block">Letter Spacing</label>
                                                <input type="number" min="-5" max="20" step="0.5" className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20 font-mono"
                                                    value={projectSettings.letterSpacing}
                                                    onChange={e => setProjectSettings({ ...projectSettings, letterSpacing: Number(e.target.value) })} />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-400 uppercase tracking-wider block">Line Height</label>
                                                <input type="number" min="1" max="3" step="0.1" className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20 font-mono"
                                                    value={projectSettings.lineHeight}
                                                    onChange={e => setProjectSettings({ ...projectSettings, lineHeight: Number(e.target.value) })} />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-400 uppercase tracking-wider block">Text Color</label>
                                                <div className="flex items-center gap-2">
                                                    <input type="color" className="h-9 w-12 bg-transparent cursor-pointer rounded"
                                                        value={projectSettings.fontColor}
                                                        onChange={e => setProjectSettings({ ...projectSettings, fontColor: e.target.value })} />
                                                    <span className="text-xs font-mono text-gray-500">{projectSettings.fontColor}</span>
                                                </div>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-400 uppercase tracking-wider block">Text Effect</label>
                                                <select className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20" value={projectSettings.textEffect}
                                                    onChange={e => setProjectSettings({ ...projectSettings, textEffect: e.target.value })}>
                                                    <option value="shadow">Drop Shadow</option>
                                                    <option value="stroke">Outline</option>
                                                    <option value="none">None</option>
                                                </select>
                                            </div>
                                            <div className="col-span-2 space-y-1.5">
                                                <label className="text-[10px] text-gray-400 uppercase tracking-wider block">Font Family</label>
                                                <input type="text" className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20 font-mono"
                                                    placeholder="sans-serif, Arial, 'Noto Sans KR', ..."
                                                    value={projectSettings.fontFamily}
                                                    onChange={e => setProjectSettings({ ...projectSettings, fontFamily: e.target.value })} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Background */}
                                    <div className="space-y-3">
                                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Background</h3>
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-400 uppercase tracking-wider block">Color</label>
                                                <div className="flex items-center gap-2">
                                                    <input type="color" className="h-9 w-10 bg-transparent cursor-pointer rounded"
                                                        value={projectSettings.bgColor}
                                                        onChange={e => setProjectSettings({ ...projectSettings, bgColor: e.target.value })} />
                                                </div>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-400 uppercase tracking-wider block">Opacity</label>
                                                <input type="number" step="0.05" min="0" max="1" className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20 font-mono"
                                                    value={projectSettings.bgOpacity}
                                                    onChange={e => setProjectSettings({ ...projectSettings, bgOpacity: Number(e.target.value) })} />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-400 uppercase tracking-wider block">Padding (px)</label>
                                                <input type="number" className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20 font-mono"
                                                    value={projectSettings.padding}
                                                    onChange={e => setProjectSettings({ ...projectSettings, padding: Number(e.target.value) })} />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="text-[10px] text-gray-600 flex items-center gap-2 bg-white/5 p-2 rounded">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                                        Changes apply to overlay in real-time upon saving.
                                    </div>
                                </div>}

                                {/* Section 2: Buffer Tuning */}
                                {settingsTab === 'ai' && <div className="space-y-4">
                                    <div className="space-y-1">
                                        <h3 className="text-sm font-medium text-gray-200">Buffer Tuning</h3>
                                        <p className="text-xs text-gray-500">Adjust translation timing based on speech pace.</p>
                                    </div>

                                    <div className="space-y-5 bg-[#1a1a1a] p-5 rounded-lg border border-white/5">
                                        <div className="space-y-2">
                                            <label className="text-xs text-gray-400 flex justify-between items-end">
                                                <span>Interval <span className="text-[10px] text-gray-600 ml-1">(Chunk mode)</span></span>
                                                <span className="text-gray-200 font-mono">{projectSettings.chunkInterval} ms</span>
                                            </label>
                                            <input type="range" min="2000" max="8000" step="500" className="w-full accent-white"
                                                value={projectSettings.chunkInterval}
                                                onChange={e => setProjectSettings({ ...projectSettings, chunkInterval: Number(e.target.value) })} />
                                            <p className="text-[10px] text-gray-600">Audio chunk size. Longer = better context (Recommended: 3000~5000ms).</p>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-xs text-gray-400 flex justify-between items-end">
                                                <span>Min Characters to Translate</span>
                                                <span className="text-gray-200 font-mono">{projectSettings.minLength} chars</span>
                                            </label>
                                            <input type="range" min="10" max="200" step="5" className="w-full accent-white"
                                                value={projectSettings.minLength}
                                                onChange={e => setProjectSettings({ ...projectSettings, minLength: Number(e.target.value) })} />
                                            <p className="text-[10px] text-gray-600">Lower = faster but less context (Recommended: 20~60).</p>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-xs text-gray-400 flex justify-between items-end">
                                                <span>Force Translate Timeout</span>
                                                <span className="text-gray-200 font-mono">{projectSettings.timeoutMs} ms</span>
                                            </label>
                                            <input type="range" min="1000" max="8000" step="500" className="w-full accent-white"
                                                value={projectSettings.timeoutMs}
                                                onChange={e => setProjectSettings({ ...projectSettings, timeoutMs: Number(e.target.value) })} />
                                            <p className="text-[10px] text-gray-600">Translates if waiting too long (Recommended: 2000~4000ms).</p>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-xs text-gray-400 flex justify-between items-end">
                                                <span>Max Silence Wait</span>
                                                <span className="text-gray-200 font-mono">{projectSettings.vadMaxCutMs} ms</span>
                                            </label>
                                            <input type="range" min="3000" max="20000" step="1000" className="w-full accent-white"
                                                value={projectSettings.vadMaxCutMs}
                                                onChange={e => setProjectSettings({ ...projectSettings, vadMaxCutMs: Number(e.target.value) })} />
                                            <p className="text-[10px] text-gray-600">Forces cut if no silence detected in VAD mode (Recommended: 8000~15000ms).</p>
                                        </div>

                                        <div className="flex items-center gap-3 pt-3 border-t border-white/5">
                                            <input type="checkbox" id="chkSentence"
                                                checked={projectSettings.sentenceEnd}
                                                onChange={e => setProjectSettings({ ...projectSettings, sentenceEnd: e.target.checked })}
                                                className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-white" />
                                            <label htmlFor="chkSentence" className="text-sm text-gray-300 cursor-pointer">Translate immediately on punctuation (. ! ?)</label>
                                        </div>

                                        <div className="flex items-start gap-3 pt-3 border-t border-white/5">
                                            <input type="checkbox" id="chkHideRaw"
                                                checked={projectSettings.hideRaw}
                                                onChange={e => setProjectSettings({ ...projectSettings, hideRaw: e.target.checked })}
                                                className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-800 accent-white" />
                                            <div>
                                                <label htmlFor="chkHideRaw" className="text-sm text-gray-300 cursor-pointer font-medium">
                                                    Hide Raw STT Text
                                                </label>
                                                <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">Only show text after it has been refined by gpt-4o-mini. Prevents raw misrecognitions from appearing on screen.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>}
                            </div>

                            <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                                <button onClick={() => setShowProjectSettings(false)} className="px-5 py-2 text-xs font-medium text-gray-400 hover:text-white transition-colors">Cancel</button>
                                <button onClick={saveProjectSettings} className="px-5 py-2 bg-white text-black rounded-md text-xs font-medium hover:bg-gray-200 transition-colors">Save Changes</button>
                            </div>
                        </div>
                    </div>
                )
            }

        </div >
    );
};

export default AdminDashboard;
