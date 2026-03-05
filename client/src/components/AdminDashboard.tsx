import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { rtdb as database, auth } from '../firebase';
import { ref, onValue, push, set, update, get } from 'firebase/database';
import { useParams } from 'react-router-dom';
import AudioVisualizer from './AudioVisualizer';
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
    sourceLanguage?: 'ko' | 'en' | 'ja' | 'zh';
}

const LANG_FLAGS: Record<string, string> = {
    ko: '🇰🇷', en: '🇺🇸', ja: '🇯🇵', zh: '🇨🇳'
};

const AdminDashboard: React.FC = () => {
    const { projectId } = useParams<{ projectId: string }>();
    const activeProjectId = projectId || "default";

    // --- CMS State ---
    const [sessions, setSessions] = useState<Session[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string>("");
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [showProjectSettings, setShowProjectSettings] = useState(false);

    interface ProjectSettings {
        fontSize: number;
        fontColor: string;
        fontWeight: string;
        bgColor: string;
        bgOpacity: number;
        padding: number;
        textEffect: string;
        align: string;
        minLength: number;
        timeoutMs: number;
        sentenceEnd: boolean;
        recordMode: 'chunk' | 'vad';
        hideRaw: boolean;
    }

    const [projectSettings, setProjectSettings] = useState<ProjectSettings>({
        // Overlay Defaults
        fontSize: 48, fontColor: '#ffffff', fontWeight: 'bold', bgColor: '#000000', bgOpacity: 0.6,
        padding: 20, textEffect: 'shadow', align: 'center',
        // AI Tuning Defaults
        minLength: 50,
        timeoutMs: 6000,
        sentenceEnd: true,
        // Record Mode
        recordMode: 'chunk',
        // Display
        hideRaw: true,
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
            align: projectSettings.align
        };
        updates[`projects/${activeProjectId}/settings/chunk`] = {
            minLength: Number(projectSettings.minLength),
            timeoutMs: Number(projectSettings.timeoutMs),
            sentenceEnd: Boolean(projectSettings.sentenceEnd)
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
    const [remasterStatus, setRemasterStatus] = useState<string>("idle"); // idle, processing, done

    const triggerRemaster = async () => {
        if (!activeSessionId) return;
        if (remasterStatus === 'processing') return; // Prevent double click

        setRemasterStatus("processing");
        try {
            const res = await fetch(`https://us-central1-translation-comm.cloudfunctions.net/triggerRemaster?projectId=${activeProjectId}`);
            if (!res.ok) throw new Error("Network error");
            const data = await res.json();
            setRemasterStatus("done");

            if (data.success) {
                if (data.count > 0) {
                    alert(`신규 자막 ${data.count}개에 대한 클랜지(리마스터링)이 완료되었습니다.`);
                } else {
                    alert("클랜징 완료: 현재 상태가 최적화되어 있어 변경할 내용이 없습니다.");
                }
            } else {
                alert("클랜징 요청 실패: " + (data.error || "알 수 없는 오류"));
            }
        } catch (e: any) {
            console.error("Remaster Failed:", e);
            alert("클랜징 실패: " + e.message);
            setRemasterStatus("error");
        } finally {
            setTimeout(() => setRemasterStatus("idle"), 3000);
        }
    };

    const triggerPurge = async () => {
        if (!activeProjectId) return;
        if (!window.confirm("주의: 현재 라이브 중인 모든 스트림 데이터를 '완전히' 삭제하시겠습니까? (복구 불가)")) return;

        try {
            const token = await auth.currentUser?.getIdToken();
            const res = await fetch(`https://us-central1-translation-comm.cloudfunctions.net/purgeSession?projectId=${activeProjectId}`, {
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

    // Ref to track latest recordMode to avoid closure staleness in startRecording
    const recordModeRef = useRef(projectSettings.recordMode);
    useEffect(() => {
        recordModeRef.current = projectSettings.recordMode;
    }, [projectSettings.recordMode]);

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
            abstract: "Abstract here...",
            keywords: "keyword1, keyword2",
            startTime: "09:00",
            orderIndex: maxOrder + 1,
            sourceLanguage: 'ko'
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
            await fetch(`https://us-central1-translation-comm.cloudfunctions.net/archiveSession`, {
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
            const url = `https://us-central1-translation-comm.cloudfunctions.net/processAudio?projectId=${encodeURIComponent(activeProjectId)}&sourceLabel=admin`;
            console.log(`[Upload] Sending ${blob.size}B → CF (project=${activeProjectId})`);
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
                body: buf
            }).then(async r => {
                const data = await r.json().catch(() => ({}));
                if (r.ok && data.success) {
                    setStatus('streaming');
                    console.log(`[Upload] ✅ OK - "${data.text?.slice(0, 50)}"`);
                } else if (r.status === 401) {
                    console.error('[Upload] ❌ 401 Unauthorized');
                } else if (data.error === 'TooSmall' || data.info) {
                    console.log('[Upload] CF filtered:', data.error || data.info);
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

            const switchRecorders = () => {
                const nextIndex = activeIndexRef.current === 0 ? 1 : 0;
                const nextMR = nextIndex === 0 ? mr1Ref.current : mr2Ref.current;
                const currentMR = activeIndexRef.current === 0 ? mr1Ref.current : mr2Ref.current;
                if (nextMR && nextMR.state === 'inactive') nextMR.start();
                if (currentMR && currentMR.state === 'recording') currentMR.stop();
                activeIndexRef.current = nextIndex;
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
                // Safety: Force cut every 10s if no silence
                segmentTimerRef.current = window.setInterval(switchRecorders, 10000);
            } else {
                // Chunk Mode: Switch every 2s
                console.log("Starting Chunk Mode (2s)");
                segmentTimerRef.current = window.setInterval(switchRecorders, 2000);
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
        if (segmentTimerRef.current) clearInterval(segmentTimerRef.current);
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
    }, [projectSettings.recordMode]);

    return (
        <div className="flex h-screen bg-gray-900 text-white overflow-hidden">
            {/* Sidebar: Agenda */}
            <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
                <div className="p-4 border-b border-gray-700 font-bold text-lg flex justify-between items-center">
                    <span>Agenda</span>
                    <button onClick={() => setShowProjectSettings(true)} className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded">⚙️ Set</button>
                    <button onClick={handleCreateSession} className="text-blue-400 hover:text-blue-300 text-sm font-bold">+ New</button>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {sessions.map((s, idx) => (
                        <div
                            key={s.id}
                            onClick={() => handleSelectSession(s)}
                            className={`p-3 border-b border-gray-700 cursor-pointer hover:bg-gray-700 flex gap-2 ${activeSessionId === s.id ? 'bg-red-900/30 border-l-4 border-red-500' : ''} ${selectedSessionId === s.id ? 'bg-gray-700' : ''}`}
                        >
                            <div className="flex flex-col gap-1 justify-center">
                                <button onClick={(e) => { e.stopPropagation(); handleMove(idx, -1); }} className="text-gray-500 hover:text-white text-[10px]">▲</button>
                                <button onClick={(e) => { e.stopPropagation(); handleMove(idx, 1); }} className="text-gray-500 hover:text-white text-[10px]">▼</button>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-gray-400">{s.startTime}</div>
                                <div className="font-semibold truncate">
                                    {LANG_FLAGS[s.sourceLanguage || 'ko']} {s.speaker}
                                </div>
                                <div className="text-xs text-gray-500 truncate">{s.topic}</div>
                                {activeSessionId === s.id && <span className="text-xs text-red-400 font-bold animate-pulse">● LIVE</span>}
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteSession(s); }} className="text-gray-600 hover:text-red-500 p-1">🗑️</button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main: Workspace */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Top: Metadata Editor */}
                <div className="h-1/2 p-6 border-b border-gray-700 bg-gray-900 overflow-y-auto">
                    {selectedSessionId ? (
                        <div className="max-w-3xl mx-auto space-y-4">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-bold">Edit Session</h2>
                                <div className="flex gap-2">
                                    <button onClick={() => { if (window.confirm("Archive this session?")) triggerArchive(selectedSessionId); }} className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm">Force Archive</button>
                                    <button onClick={handleSaveSession} className="px-4 py-2 bg-gray-600 rounded hover:bg-gray-500">Save</button>
                                    <button onClick={handleGoLive} className={`px-4 py-2 rounded font-bold ${activeSessionId === selectedSessionId ? 'bg-red-600 cursor-default' : 'bg-green-600 hover:bg-green-500'}`}>
                                        {activeSessionId === selectedSessionId ? 'Current Live' : 'Go Live'}
                                    </button>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-gray-400">Speaker Name</label>
                                    <input className="w-full bg-gray-800 border border-gray-600 rounded p-2" value={formData.speaker || ''} onChange={e => setFormData({ ...formData, speaker: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400">Time</label>
                                    <input className="w-full bg-gray-800 border border-gray-600 rounded p-2" value={formData.startTime || ''} onChange={e => setFormData({ ...formData, startTime: e.target.value })} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs text-gray-400">Source Language (Speaker's Language)</label>
                                    <select className="w-full bg-gray-800 border border-gray-600 rounded p-2" value={formData.sourceLanguage || 'ko'} onChange={e => setFormData({ ...formData, sourceLanguage: e.target.value as 'ko' | 'en' | 'ja' | 'zh' })}>
                                        <option value="ko">Korean (한국어)</option>
                                        <option value="en">English (영어)</option>
                                        <option value="ja">Japanese (일본어)</option>
                                        <option value="zh">Chinese (중국어)</option>
                                    </select>
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs text-gray-400">Affiliation</label>
                                    <input className="w-full bg-gray-800 border border-gray-600 rounded p-2" value={formData.affiliation || ''} onChange={e => setFormData({ ...formData, affiliation: e.target.value })} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs text-gray-400">Topic</label>
                                    <input className="w-full bg-gray-800 border border-gray-600 rounded p-2" value={formData.topic || ''} onChange={e => setFormData({ ...formData, topic: e.target.value })} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs text-gray-400">Abstract (Context for AI)</label>
                                    <textarea className="w-full bg-gray-800 border border-gray-600 rounded p-2 h-32" value={formData.abstract || ''} onChange={e => setFormData({ ...formData, abstract: e.target.value })} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs text-gray-400">Keywords (Comma separated)</label>
                                    <input className="w-full bg-gray-800 border border-gray-600 rounded p-2" value={formData.keywords || ''} onChange={e => setFormData({ ...formData, keywords: e.target.value })} />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">Select a session to edit</div>
                    )}
                </div>

                {/* Bottom: Monitor & Controls */}
                <div className="h-1/2 bg-black flex flex-col p-4">
                    <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-3">
                            <div className="flex bg-gray-800 rounded p-1">
                                <button onClick={() => setSourceType('mic')} className={`px-3 py-1 text-sm rounded ${sourceType === 'mic' ? 'bg-gray-600 text-white' : 'text-gray-400'}`}>Mic</button>
                                <button onClick={() => setSourceType('system')} className={`px-3 py-1 text-sm rounded ${sourceType === 'system' ? 'bg-gray-600 text-white' : 'text-gray-400'}`}>System</button>
                            </div>
                            <button onClick={isRecording ? stopRecording : startRecording} className={`px-4 py-1 rounded font-bold ${isRecording ? "bg-red-600" : "bg-green-600"}`}>
                                {isRecording ? "ON AIR (Stop)" : "START BROADCAST"}
                            </button>

                            {/* Remaster Button for Admin */}
                            {/* REMOVED from here as per user request */}

                            <div className="w-32 h-2 bg-gray-700 rounded ml-2 relative">
                                <div className="h-2 bg-green-500 rounded" style={{ width: `${Math.min(100, Math.max(0, ((currentDb + 90) / 60) * 100))}%` }} />
                            </div>
                            {/* Health Dashboard */}
                            <HealthDashboard projectId={activeProjectId} />
                        </div>
                        <div className="text-xs text-gray-400">Status: {status}</div>
                    </div>

                    <AudioVisualizer stream={stream} width={800} height={40} />

                    {/* Log Window with Header */}
                    <div className="flex-1 flex flex-col mt-2 border border-gray-800 rounded overflow-hidden">
                        <div className="bg-gray-800 p-2 flex justify-between items-center">
                            <span className="text-xs font-bold text-gray-300">
                                {selectedSessionId ? `Session: ${formData.speaker} (${viewMode === 'live' ? 'LIVE STREAM' : 'ARCHIVED RECORD'})` : "No Session Selected"}
                            </span>

                            <div className="flex gap-2">
                                {/* Manual Remaster Button (For Live Monitoring Cleanup) */}
                                {viewMode === 'live' && activeSessionId && (
                                    <div className="flex gap-1">
                                        <button
                                            onClick={triggerRemaster}
                                            disabled={remasterStatus === 'processing'}
                                            className={`px-2 py-1 text-xs rounded flex items-center gap-1 transition-all ${remasterStatus === 'processing' ? 'bg-yellow-600 cursor-not-allowed opacity-80' : 'bg-purple-600 hover:bg-purple-500 hover:shadow-lg'}`}
                                        >
                                            {remasterStatus === 'processing' ? '⏳ Cleaning...' : (remasterStatus === 'done' ? '✅ Done!' : '✨ Remaster Now')}
                                        </button>
                                        <button
                                            onClick={triggerPurge}
                                            className="px-2 py-1 text-xs rounded bg-red-900/50 hover:bg-red-800 border border-red-700 text-red-100 flex items-center gap-1"
                                            title="완전 삭제 (클랜징)"
                                        >
                                            🧹 Purge
                                        </button>
                                    </div>
                                )}


                                {viewMode === 'archive' && (
                                    <>
                                        <button onClick={handleExport} className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-xs rounded text-white flex items-center gap-1">
                                            📥 Export Script
                                        </button>
                                        <button onClick={handleClearTranscript} className="px-2 py-1 bg-red-900/50 hover:bg-red-900 text-xs rounded text-red-200 border border-red-800 flex items-center gap-1">
                                            🧹 Clear
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto bg-gray-900 p-4">
                            <div className="text-lg break-words leading-relaxed">
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
            {showProjectSettings && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-800 p-6 rounded-lg w-full max-w-lg space-y-4 border border-gray-600">
                        <h2 className="text-xl font-bold">Project Settings</h2>

                        {/* Tabs */}
                        <div className="flex border-b border-gray-600 mb-4">
                            <button className="px-4 py-2 text-sm font-bold border-b-2 border-blue-500 text-blue-400">Overlay Design</button>
                            <button className="px-4 py-2 text-sm font-bold text-gray-400 hover:text-white">AI Tuning (Chunking)</button>
                        </div>

                        <div className="space-y-6 overflow-y-auto max-h-[60vh]">
                            {/* Section 0: Audio Engine */}
                            <div className="bg-gray-700 p-4 rounded-lg">
                                <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                                    🎙️ Audio Engine <span className="text-xs font-normal text-gray-400">(Live Switchable)</span>
                                </h3>
                                <div className="flex gap-4">
                                    <label className={`flex-1 p-3 rounded border cursor-pointer transition-all ${projectSettings.recordMode === 'chunk' ? 'bg-blue-600 border-blue-400' : 'bg-gray-800 border-gray-600 hover:bg-gray-600'}`}>
                                        <div className="flex items-center gap-2 mb-1">
                                            <input type="radio" name="recordMode" value="chunk" checked={projectSettings.recordMode === 'chunk'} onChange={() => setProjectSettings({ ...projectSettings, recordMode: 'chunk' })} className="hidden" />
                                            <span className="font-bold text-white">🔵 Speed (Chunk)</span>
                                        </div>
                                        <p className="text-[10px] text-gray-300 leading-tight">
                                            Sends audio every 2 seconds. Best for fast-paced Q&A.
                                        </p>
                                    </label>

                                    <label className={`flex-1 p-3 rounded border cursor-pointer transition-all ${projectSettings.recordMode === 'vad' ? 'bg-green-600 border-green-400' : 'bg-gray-800 border-gray-600 hover:bg-gray-600'}`}>
                                        <div className="flex items-center gap-2 mb-1">
                                            <input type="radio" name="recordMode" value="vad" checked={projectSettings.recordMode === 'vad'} onChange={() => setProjectSettings({ ...projectSettings, recordMode: 'vad' })} className="hidden" />
                                            <span className="font-bold text-white">🟢 Precision (VAD)</span>
                                        </div>
                                        <p className="text-[10px] text-gray-300 leading-tight">
                                            Sends when you stop talking. Best for Keynotes.
                                        </p>
                                    </label>
                                </div>
                            </div>

                            {/* Section 1: Overlay */}
                            <div>
                                <h3 className="text-sm font-bold text-gray-300 mb-2">Overlay Appearance</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs text-gray-400 block">Font Size (px)</label>
                                        <input type="number" className="w-full bg-gray-700 p-2 rounded" value={projectSettings.fontSize} onChange={e => setProjectSettings({ ...projectSettings, fontSize: Number(e.target.value) })} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400 block">Font Color</label>
                                        <input type="color" className="w-full h-10 bg-gray-700 rounded cursor-pointer" value={projectSettings.fontColor} onChange={e => setProjectSettings({ ...projectSettings, fontColor: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400 block">Font Weight</label>
                                        <select className="w-full bg-gray-700 p-2 rounded" value={projectSettings.fontWeight} onChange={e => setProjectSettings({ ...projectSettings, fontWeight: e.target.value as 'normal' | 'bold' | '800' })}>
                                            <option value="normal">Normal</option>
                                            <option value="bold">Bold</option>
                                            <option value="800">Extra Bold</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400 block">Alignment</label>
                                        <select className="w-full bg-gray-700 p-2 rounded" value={projectSettings.align} onChange={e => setProjectSettings({ ...projectSettings, align: e.target.value as 'left' | 'center' | 'right' })}>
                                            <option value="left">Left</option>
                                            <option value="center">Center</option>
                                            <option value="right">Right</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400 block">Background Color</label>
                                        <input type="color" className="w-full h-10 bg-gray-700 rounded cursor-pointer" value={projectSettings.bgColor} onChange={e => setProjectSettings({ ...projectSettings, bgColor: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400 block">Opacity (0.0 - 1.0)</label>
                                        <input type="number" step="0.1" min="0" max="1" className="w-full bg-gray-700 p-2 rounded" value={projectSettings.bgOpacity} onChange={e => setProjectSettings({ ...projectSettings, bgOpacity: Number(e.target.value) })} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400 block">Text Effect</label>
                                        <select className="w-full bg-gray-700 p-2 rounded" value={projectSettings.textEffect} onChange={e => setProjectSettings({ ...projectSettings, textEffect: e.target.value as 'none' | 'shadow' | 'stroke' })}>
                                            <option value="none">None</option>
                                            <option value="shadow">Drop Shadow</option>
                                            <option value="stroke">Outline (Stroke)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400 block">Padding (px)</label>
                                        <input type="number" className="w-full bg-gray-700 p-2 rounded" value={projectSettings.padding} onChange={e => setProjectSettings({ ...projectSettings, padding: Number(e.target.value) })} />
                                    </div>
                                </div>
                            </div>


                            {/* Section 2: AI Tuning */}
                            <div className="border-t border-gray-700 pt-4">
                                <h3 className="text-sm font-bold text-gray-300 mb-2">AI Processing Tuning</h3>
                                <p className="text-xs text-gray-500 mb-4">Adjust these values to control when the AI refines the text. Useful for fast/slow speakers.</p>

                                <div className="grid grid-cols-1 gap-4">
                                    <div>
                                        <label className="text-xs text-gray-400 block flex justify-between">
                                            <span>Minimum Chunk Length (Characters)</span>
                                            <span className="text-white font-bold">{projectSettings.minLength} chars</span>
                                        </label>
                                        <input type="range" min="20" max="200" step="10" className="w-full mt-1"
                                            value={projectSettings.minLength}
                                            onChange={e => setProjectSettings({ ...projectSettings, minLength: Number(e.target.value) })} />
                                        <p className="text-[10px] text-gray-500">Wait until at least this many characters are collected.</p>
                                    </div>

                                    <div>
                                        <label className="text-xs text-gray-400 block flex justify-between">
                                            <span>Max Wait Time (Timeout)</span>
                                            <span className="text-white font-bold">{projectSettings.timeoutMs} ms</span>
                                        </label>
                                        <input type="range" min="1000" max="10000" step="500" className="w-full mt-1"
                                            value={projectSettings.timeoutMs}
                                            onChange={e => setProjectSettings({ ...projectSettings, timeoutMs: Number(e.target.value) })} />
                                        <p className="text-[10px] text-gray-500">Force processing if silence lasts longer than this.</p>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <input type="checkbox" id="chkSentence"
                                            checked={projectSettings.sentenceEnd}
                                            onChange={e => setProjectSettings({ ...projectSettings, sentenceEnd: e.target.checked })} />
                                        <label htmlFor="chkSentence" className="text-sm text-gray-300">Split by Sentence (. ! ?)</label>
                                    </div>

                                    <div className="flex items-center gap-2 pt-2 border-t border-gray-700">
                                        <input type="checkbox" id="chkHideRaw"
                                            checked={projectSettings.hideRaw}
                                            onChange={e => setProjectSettings({ ...projectSettings, hideRaw: e.target.checked })} />
                                        <label htmlFor="chkHideRaw" className="text-sm text-gray-300">
                                            🔒 Hide Raw STT (Whisper 원문 숨김)
                                        </label>
                                    </div>
                                    <p className="text-[10px] text-gray-500 ml-6">체크 시 Gemini가 정제한 텍스트만 표시됩니다. "쭈꾸미" 같은 오인식 단어가 화면에 노출되지 않습니다.</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-4">
                            <button onClick={() => setShowProjectSettings(false)} className="px-4 py-2 text-gray-400">Cancel</button>
                            <button onClick={saveProjectSettings} className="px-4 py-2 bg-blue-600 rounded font-bold">Save Apply</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default AdminDashboard;
