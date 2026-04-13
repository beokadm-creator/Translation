import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { rtdb as database, auth } from '../firebase';
import { ref, onValue, push, set, update, get } from 'firebase/database';
import { useParams } from 'react-router-dom';
import AudioVisualizer from './AudioVisualizer';
import TextItem from './TextItem';
import { useProjectStream } from '../hooks/useProjectStream';
import HealthDashboard from './HealthDashboard';
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
        hideRaw: boolean;
        primarySTT: 'openai' | 'deepgram';
        fallbackSTT: 'openai' | 'deepgram';
        primaryTrans: 'openai' | 'claude';
        fallbackTrans: 'openai' | 'claude';
}

const [projectSettings, setProjectSettings] = useState<ProjectSettings>({
    fontSize: 48, fontColor: '#ffffff', fontWeight: 'bold', bgColor: '#000000', bgOpacity: 0.6,
    padding: 40, textEffect: 'shadow', align: 'center',
    displayStyle: 'youtube', letterSpacing: 0, maxLines: 2, lineHeight: 1.5,
    fontFamily: 'sans-serif', typingSpeed: 35, bottomOffset: 60,
    hideRaw: true,
    primarySTT: 'openai', fallbackSTT: 'deepgram',
    primaryTrans: 'openai', fallbackTrans: 'claude'
});

    // Load Project Settings
    useEffect(() => {


        get(ref(database, `projects/${activeProjectId}/settings`)).then(snap => {
            if (snap.exists()) {
                const val = snap.val();
                setProjectSettings((prev) => ({
                ...prev,
                ...(val.overlay || {}),
                hideRaw: val.hideRaw !== undefined ? val.hideRaw : true,
                primarySTT: val.ai?.primarySTT || 'openai',
                fallbackSTT: val.ai?.fallbackSTT || 'deepgram',
                primaryTrans: val.ai?.primaryTrans || 'openai',
                fallbackTrans: val.ai?.fallbackTrans || 'claude',
            }));
            }
        });
    }, [activeProjectId]);

    const saveProjectSettings = async () => {
        try {
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
            updates[`projects/${activeProjectId}/settings/ai`] = {
                primarySTT: projectSettings.primarySTT,
                fallbackSTT: projectSettings.fallbackSTT,
                primaryTrans: projectSettings.primaryTrans,
                fallbackTrans: projectSettings.fallbackTrans,
            };
            updates[`projects/${activeProjectId}/settings/hideRaw`] = Boolean(projectSettings.hideRaw);

            await update(ref(database), updates);
            alert("Settings Saved!");
            setShowProjectSettings(false);
        } catch (e) {
            console.error("설정 저장 실패:", e);
            alert("설정 저장에 실패했습니다. 인터넷 연결을 확인해주세요.");
        }
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
    const handleCreateSession = async () => {
        try {
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
            await set(newRef, newSession);
            setSelectedSessionId(newSession.id);
            setFormData(newSession);
        } catch (e) {
            console.error("세션 생성 실패:", e);
            alert("세션 생성에 실패했습니다. 네트워크를 확인해주세요.");
        }
    };

    const handleSelectSession = (s: Session) => {
        setSelectedSessionId(s.id);
        setFormData(s);
    };

    const handleSaveSession = async () => {
        if (!selectedSessionId) return;
        try {
            const updates: Record<string, any> = {};
            updates[`projects/${activeProjectId}/sessions/${selectedSessionId}`] = formData;
            
            await update(ref(database), updates);
            alert("Saved!");
        } catch (error) {
            console.error("Failed to save session:", error);
            alert("세션 저장에 실패했습니다. 네트워크를 확인해주세요.");
        }
    };

    const handleMove = async (index: number, direction: -1 | 1) => {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= sessions.length) return;

        const s1 = sessions[index];
        const s2 = sessions[targetIndex];

        const o1 = s1.orderIndex ?? index;
        const o2 = s2.orderIndex ?? targetIndex;

        try {
            // ── 3단계 디테일 튜닝: 다중 경로 업데이트(Multi-path Update)로 통신 낭비 및 불일치 방지 ──
            const updates: Record<string, any> = {};
            updates[`projects/${activeProjectId}/sessions/${s1.id}/orderIndex`] = o2;
            updates[`projects/${activeProjectId}/sessions/${s2.id}/orderIndex`] = o1;
            
            await update(ref(database), updates);
        } catch (e) {
            console.error("순서 변경 실패:", e);
            alert("세션 순서 변경에 실패했습니다.");
        }
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
        try {
            await set(ref(database, `projects/${activeProjectId}/sessions/${s.id}`), null);
            if (selectedSessionId === s.id) setSelectedSessionId(null);
        } catch (e) {
            console.error("삭제 실패:", e);
            alert("세션 삭제에 실패했습니다.");
        }
    };

    const handleClearTranscript = async () => {
        if (!selectedSessionId) return;
        if (!window.confirm("Clear all transcript data for this session?")) return;
        try {
            await set(ref(database, `projects/${activeProjectId}/sessions/${selectedSessionId}/transcript`), null);
            setSegmentsMap({});
        } catch (e) {
            console.error("초기화 실패:", e);
            alert("자막 데이터 초기화에 실패했습니다.");
        }
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
            
            // --- 2단계 최적화: 서버 DB 읽기 병목 제거를 위한 헤더 송장(Metadata) 생성 ---
            // 1. Whisper용 단어장 (초록은 앞부분 60자만 포함하여 오인식 방지)
            const speakerTerms = [activeSession?.speaker, activeSession?.affiliation, activeSession?.topic].filter(Boolean).join(', ');
            const abstractSnippet = activeSession?.abstract ? activeSession.abstract.slice(0, 60) : '';
            const customKeywords = [activeSession?.keywords, speakerTerms, abstractSnippet].filter(Boolean).join(', ');

            // 2. GPT 번역용 배경지식 (환각 방지를 위해 초록 제외, 주제/키워드/연자 순으로 똑똑하게 배치)
            const sessionContext = `Topic: ${activeSession?.topic || ''}, Keywords: ${activeSession?.keywords || ''}, Speaker: ${activeSession?.speaker || ''}, Affiliation: ${activeSession?.affiliation || ''}`;

            // 3. 청크 설정값 (Auto-Pilot 기본값 강제 적용)
            const chunkMinLength = "35";
            const chunkTimeoutMs = "6000";
            const chunkSentenceEnd = "true";

            const url = `${CF_BASE}/processAudio?projectId=${encodeURIComponent(activeProjectId)}&sourceLabel=admin&sourceLang=${currentLang}`;
            console.log(`[Upload] Sending ${blob.size}B → CF (project=${activeProjectId}, lang=${currentLang})`);
            
            fetch(url, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/octet-stream', 
                    'Authorization': `Bearer ${token}`,
                    // 한글 깨짐 방지를 위해 encodeURIComponent로 감싸서 헤더에 탑재
                    'X-Active-Session-Id': activeSessionId || '',
                    'X-Custom-Keywords': encodeURIComponent(customKeywords),
                    'X-Session-Context': encodeURIComponent(sessionContext),
                    'X-Chunk-Min-Length': chunkMinLength,
                    'X-Chunk-Timeout-Ms': chunkTimeoutMs,
                    'X-Chunk-Sentence-End': chunkSentenceEnd,
                    'X-STT-Primary': projectSettings.primarySTT,
                    'X-STT-Fallback': projectSettings.fallbackSTT,
                    'X-Trans-Primary': projectSettings.primaryTrans,
                    'X-Trans-Fallback': projectSettings.fallbackTrans
                },
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
                
                // 1. 새로운 레코더를 먼저 시작 (오버랩 시작)
                if (nextMR && nextMR.state === 'inactive') nextMR.start();
                
                // 2. 아주 미세한 오버랩(100ms)을 주어 스위칭 순간의 단어 잘림 방지
                setTimeout(() => {
                    if (currentMR && currentMR.state === 'recording') currentMR.stop();
                    activeIndexRef.current = nextIndex;

                    const interval = 2500;
                    scheduleNextCut(interval);
                }, 100);
            };

            console.log("Starting Chunk Mode (2500ms)");
            scheduleNextCut(2500);

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
        if (mr1Ref.current?.state === 'recording') mr1Ref.current.stop();
        if (mr2Ref.current?.state === 'recording') mr2Ref.current.stop();
        stream?.getTracks().forEach(t => t.stop());
        audioContextRef.current?.close();
        if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        setIsRecording(false);
        setStatus("idle");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stream]);

    return (
        <div className="flex h-screen bg-[#f9fafb] dark:bg-[#111827] text-[#111827] dark:text-[#f9fafb] overflow-hidden">
            {/* Sidebar: Agenda */}
            <div className="w-64 bg-[#ffffff] dark:bg-[#1f2937] border-r border-[#e5e7eb] dark:border-[#374151] flex flex-col">
                <div className="p-4 border-b border-[#e5e7eb] dark:border-[#374151] font-bold text-lg flex justify-between items-center">
                    <span>Agenda</span>
                    <button onClick={() => setShowProjectSettings(true)} className="text-xs bg-[#f3f4f6] dark:bg-[#374151] hover:bg-[#e5e7eb] dark:bg-[#4b5563] px-2 py-1 rounded-xl" title="Overlay & AI Settings">⚙️</button>
                    <button onClick={handleCreateSession} className="text-[#1e3a5f] dark:text-[#d4af37] hover:text-[#24456f] dark:text-[#b5952f] text-sm font-bold">+ New</button>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {sessions.map((s, idx) => (
                        <div
                            key={s.id}
                            onClick={() => handleSelectSession(s)}
                            className={`p-3 border-b border-[#e5e7eb] dark:border-[#374151] cursor-pointer hover:bg-[#f3f4f6] dark:bg-[#374151] flex gap-2 ${activeSessionId === s.id ? 'bg-red-900/30 border-l-4 border-red-500' : ''} ${selectedSessionId === s.id ? 'bg-[#f3f4f6] dark:bg-[#374151]' : ''}`}
                        >
                            <div className="flex flex-col gap-1 justify-center">
                                <button onClick={(e) => { e.stopPropagation(); handleMove(idx, -1); }} className="text-[#6b7280] dark:text-[#9ca3af] hover:text-[#111827] dark:text-[#f9fafb] text-[10px]">▲</button>
                                <button onClick={(e) => { e.stopPropagation(); handleMove(idx, 1); }} className="text-[#6b7280] dark:text-[#9ca3af] hover:text-[#111827] dark:text-[#f9fafb] text-[10px]">▼</button>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-[#6b7280] dark:text-[#9ca3af]">{s.startTime}</div>
                                <div className="font-semibold truncate">
                                    {LANG_FLAGS[s.sourceLanguage || 'ko']} {s.speaker}
                                </div>
                                <div className="text-xs text-[#6b7280] dark:text-[#9ca3af] truncate">{s.topic}</div>
                                {activeSessionId === s.id && <span className="text-xs text-red-400 font-bold animate-pulse">● LIVE</span>}
                            </div>
                            <div className="flex flex-col gap-1">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const tgtLang = s.sourceLanguage === 'en' ? 'ko' : 'en';
                                        window.open(`/overlay/${activeProjectId}/${tgtLang}`, '_blank');
                                    }}
                                    title="오버레이 열기 (번역 언어)"
                                    className="text-[#6b7280] dark:text-[#9ca3af] hover:text-[#1e3a5f] dark:text-[#d4af37] text-sm p-1 leading-none"
                                >🖥️</button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteSession(s); }} className="text-gray-600 hover:text-red-500 p-1 text-sm leading-none">🗑️</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main: Workspace */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Top: Metadata Editor */}
                <div className="h-1/2 p-6 border-b border-[#e5e7eb] dark:border-[#374151] bg-[#f9fafb] dark:bg-[#111827] overflow-y-auto">
                    {selectedSessionId ? (
                        <div className="max-w-3xl mx-auto space-y-4">
                            <div className="flex justify-between items-center mb-3">
                                <h2 className="text-xl font-bold">Edit Session</h2>
                                <div className="flex gap-2">
                                    <button onClick={() => { if (window.confirm("Archive this session?")) triggerArchive(selectedSessionId); }} className="px-4 py-2 bg-[#f3f4f6] dark:bg-[#374151] rounded-xl hover:bg-[#e5e7eb] dark:bg-[#4b5563] text-sm">Force Archive</button>
                                    <button onClick={handleSaveSession} className="px-4 py-2 bg-[#e5e7eb] dark:bg-[#4b5563] rounded-xl hover:bg-gray-500">Save</button>
                                    <button onClick={handleGoLive} className={`px-4 py-2 rounded-xl font-bold ${activeSessionId === selectedSessionId ? 'bg-red-600 cursor-default' : 'bg-green-600 hover:bg-green-500'}`}>
                                        {activeSessionId === selectedSessionId ? 'Current Live' : 'Go Live'}
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
                                    <div className="flex gap-2 mb-4 p-3 bg-[#ffffff] dark:bg-[#1f2937]/60 rounded-xl border border-[#e5e7eb] dark:border-[#374151] flex-wrap">
                                        <span className="text-xs text-[#6b7280] dark:text-[#9ca3af] self-center mr-1 font-bold">🖥️ Overlay</span>
                                        {links.map(({ lang, label, primary }) => {
                                            const url = `${origin}/overlay/${activeProjectId}/${lang}`;
                                            return (
                                                <div key={lang} className="flex items-center gap-1">
                                                    <button
                                                        onClick={() => window.open(url, '_blank')}
                                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${primary ? 'bg-[#1e3a5f] text-[#ffffff] hover:bg-[#24456f] text-[#111827] dark:text-[#f9fafb]' : 'bg-[#f3f4f6] dark:bg-[#374151] hover:bg-[#e5e7eb] dark:bg-[#4b5563] text-[#4b5563] dark:text-[#d1d5db]'}`}
                                                    >
                                                        {label}
                                                    </button>
                                                    <button
                                                        onClick={() => { navigator.clipboard.writeText(url); }}
                                                        title="URL 복사"
                                                        className="text-[#6b7280] dark:text-[#9ca3af] hover:text-[#4b5563] dark:text-[#d1d5db] text-xs px-1"
                                                    >📋</button>
                                                </div>
                                            );
                                        })}
                                        <button
                                            onClick={() => window.open(`${origin}/overlay/${activeProjectId}/${tgtLang}?debug=true`, '_blank')}
                                            className="px-2 py-1.5 rounded-xl text-xs bg-[#ffffff] dark:bg-[#1f2937] hover:bg-[#f3f4f6] dark:bg-[#374151] text-[#6b7280] dark:text-[#9ca3af] border border-[#e5e7eb] dark:border-[#374151] ml-auto"
                                        >Debug</button>
                                    </div>
                                );
                            })()}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-[#6b7280] dark:text-[#9ca3af]">Speaker Name</label>
                                    <input className="w-full bg-[#ffffff] dark:bg-[#1f2937] border border-[#d1d5db] dark:border-[#4b5563] rounded-xl p-2" value={formData.speaker || ''} onChange={e => setFormData({ ...formData, speaker: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-xs text-[#6b7280] dark:text-[#9ca3af]">Time</label>
                                    <input className="w-full bg-[#ffffff] dark:bg-[#1f2937] border border-[#d1d5db] dark:border-[#4b5563] rounded-xl p-2" value={formData.startTime || ''} onChange={e => setFormData({ ...formData, startTime: e.target.value })} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs text-[#6b7280] dark:text-[#9ca3af]">Source Language (Speaker's Language)</label>
                                    <select
                                        className="w-full bg-[#ffffff] dark:bg-[#1f2937] border border-[#d1d5db] dark:border-[#4b5563] rounded-xl p-2"
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
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs text-[#6b7280] dark:text-[#9ca3af]">Target Languages (Automatically mapped)</label>
                                    <div className="flex gap-4 p-2 bg-[#ffffff] dark:bg-[#1f2937] rounded-xl border border-[#d1d5db] dark:border-[#4b5563] opacity-70">
                                        {['ko', 'en'].map(l => (
                                            <label key={l} className="flex items-center gap-2 cursor-not-allowed">
                                                <input
                                                    type="checkbox"
                                                    checked={(formData.targetLanguages || []).includes(l)}
                                                    disabled
                                                    className="cursor-not-allowed"
                                                />
                                                <span className="uppercase font-bold text-sm">{l}</span>
                                            </label>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-[#6b7280] dark:text-[#9ca3af] mt-1">※ Target language is automatically set based on the source language.</p>
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs text-[#6b7280] dark:text-[#9ca3af]">Affiliation</label>
                                    <input className="w-full bg-[#ffffff] dark:bg-[#1f2937] border border-[#d1d5db] dark:border-[#4b5563] rounded-xl p-2" value={formData.affiliation || ''} onChange={e => setFormData({ ...formData, affiliation: e.target.value })} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs text-[#6b7280] dark:text-[#9ca3af]">Topic</label>
                                    <input className="w-full bg-[#ffffff] dark:bg-[#1f2937] border border-[#d1d5db] dark:border-[#4b5563] rounded-xl p-2" value={formData.topic || ''} onChange={e => setFormData({ ...formData, topic: e.target.value })} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs text-[#6b7280] dark:text-[#9ca3af]">
                                        Abstract (Context for AI)
                                        <span className="ml-2 text-[10px] text-[#1e3a5f] dark:text-[#d4af37] font-normal">STT 인식 + 번역 품질 모두 향상</span>
                                    </label>
                                    <textarea className="w-full bg-[#ffffff] dark:bg-[#1f2937] border border-[#d1d5db] dark:border-[#4b5563] rounded-xl p-2 h-32" placeholder="강연 초록 또는 발표 내용을 입력하세요. 앞부분 60자는 Whisper STT에도 직접 전달되어 도메인 용어 인식 정확도가 높아집니다." value={formData.abstract || ''} onChange={e => setFormData({ ...formData, abstract: e.target.value })} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs text-[#6b7280] dark:text-[#9ca3af]">Keywords (Comma separated)</label>
                                    <input className="w-full bg-[#ffffff] dark:bg-[#1f2937] border border-[#d1d5db] dark:border-[#4b5563] rounded-xl p-2" value={formData.keywords || ''} onChange={e => setFormData({ ...formData, keywords: e.target.value })} />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-[#6b7280] dark:text-[#9ca3af]">Select a session to edit</div>
                    )}
                </div>

                {/* Bottom: Monitor & Controls */}
                <div className="h-1/2 bg-black flex flex-col p-4">
                    <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-3">
                            <div className="flex bg-[#ffffff] dark:bg-[#1f2937] rounded-xl p-1">
                                <button onClick={() => setSourceType('mic')} className={`px-3 py-1 text-sm rounded-xl ${sourceType === 'mic' ? 'bg-[#e5e7eb] dark:bg-[#4b5563] text-[#111827] dark:text-[#f9fafb]' : 'text-[#6b7280] dark:text-[#9ca3af]'}`}>Mic</button>
                                <button onClick={() => setSourceType('system')} className={`px-3 py-1 text-sm rounded-xl ${sourceType === 'system' ? 'bg-[#e5e7eb] dark:bg-[#4b5563] text-[#111827] dark:text-[#f9fafb]' : 'text-[#6b7280] dark:text-[#9ca3af]'}`}>System</button>
                            </div>
                            <button onClick={isRecording ? stopRecording : startRecording} className={`px-4 py-1 rounded-xl font-bold ${isRecording ? "bg-red-600" : "bg-green-600"}`}>
                                {isRecording ? "ON AIR (Stop)" : "START BROADCAST"}
                            </button>

                            {/* Remaster Button for Admin */}
                            {/* REMOVED from here as per user request */}

                            <div className="w-32 h-2 bg-[#f3f4f6] dark:bg-[#374151] rounded-xl ml-2 relative">
                                <div className="h-2 bg-green-500 rounded-xl" style={{ width: `${Math.min(100, Math.max(0, ((currentDb + 90) / 60) * 100))}%` }} />
                            </div>
                            {/* Health Dashboard */}
                            <HealthDashboard projectId={activeProjectId} />
                        </div>
                        <div className="text-xs text-[#6b7280] dark:text-[#9ca3af]">Status: {status}</div>
                    </div>

                    <AudioVisualizer stream={stream} width={800} height={40} />

                    {/* Log Window with Header */}
                    <div className="flex-1 flex flex-col mt-2 border border-[#e5e7eb] dark:border-[#1f2937] rounded-xl overflow-hidden">
                        <div className="bg-[#ffffff] dark:bg-[#1f2937] p-2 flex justify-between items-center">
                            <span className="text-xs font-bold text-[#4b5563] dark:text-[#d1d5db]">
                                {selectedSessionId ? `Session: ${formData.speaker} (${viewMode === 'live' ? 'LIVE STREAM' : 'ARCHIVED RECORD'})` : "No Session Selected"}
                            </span>

                            <div className="flex gap-2">
                                {/* Manual Remaster Button (For Live Monitoring Cleanup) */}
                                {viewMode === 'live' && activeSessionId && (
                                    <div className="flex gap-1">
                                        <button
                                            onClick={triggerPurge}
                                            className="px-2 py-1 text-xs rounded-xl bg-red-900/50 hover:bg-red-800 border border-red-700 text-red-100 flex items-center gap-1"
                                            title="완전 삭제 (클랜징)"
                                        >
                                            🧹 Purge
                                        </button>
                                    </div>
                                )}


                                {viewMode === 'archive' && (
                                    <>
                                        <button onClick={handleExport} className="px-2 py-1 bg-[#1e3a5f] text-[#ffffff] hover:bg-[#24456f] text-xs rounded-xl text-[#111827] dark:text-[#f9fafb] flex items-center gap-1">
                                            📥 Export Script
                                        </button>
                                        <button onClick={handleClearTranscript} className="px-2 py-1 bg-red-900/50 hover:bg-red-900 text-xs rounded-xl text-red-200 border border-red-800 flex items-center gap-1">
                                            🧹 Clear
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto bg-[#f9fafb] dark:bg-[#111827] p-4">
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
            {
                showProjectSettings && (
                    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                        <div className="bg-[#ffffff] dark:bg-[#1f2937] p-6 rounded-xl w-full max-w-xl space-y-4 border border-[#d1d5db] dark:border-[#4b5563]">
                            <div className="flex justify-between items-start">
                                <h2 className="text-xl font-bold">Project Settings</h2>
                                <div className="flex gap-1.5 text-[10px]">
                                    <span className="bg-green-900/50 text-green-400 border border-green-700 px-2 py-0.5 rounded-full font-mono">STT: gpt-4o-transcribe</span>
                                    <span className="bg-blue-900/50 text-[#1e3a5f] dark:text-[#d4af37] border border-blue-700 px-2 py-0.5 rounded-full font-mono">Trans: gpt-4o-mini</span>
                                </div>
                            </div>

                            {/* Tabs */}
                            <div className="flex border-b border-[#d1d5db] dark:border-[#4b5563] mb-4">
                                <button onClick={() => setSettingsTab('overlay')} className={`px-4 py-2 text-sm font-bold ${settingsTab === 'overlay' ? 'border-b-2 border-blue-500 text-[#1e3a5f] dark:text-[#d4af37]' : 'text-[#6b7280] dark:text-[#9ca3af] hover:text-[#111827] dark:text-[#f9fafb]'}`}>Overlay Design</button>
                                <button onClick={() => setSettingsTab('ai')} className={`px-4 py-2 text-sm font-bold ${settingsTab === 'ai' ? 'border-b-2 border-blue-500 text-[#1e3a5f] dark:text-[#d4af37]' : 'text-[#6b7280] dark:text-[#9ca3af] hover:text-[#111827] dark:text-[#f9fafb]'}`}>Audio & AI</button>
                            </div>

                            <div className="space-y-6 overflow-y-auto max-h-[60vh]">
                                {/* Section 0: Model Info + Audio Engine */}
                                {settingsTab === 'ai' && <>
                                    <div className="bg-[#f9fafb] dark:bg-[#111827] border border-[#d1d5db] dark:border-[#4b5563] p-3 rounded-xl">
                                        <h3 className="text-xs font-bold text-[#6b7280] dark:text-[#9ca3af] uppercase tracking-wider mb-2 flex justify-between">
                                            <span>AI 모델 설정</span>
                                        </h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            {/* STT 엔진 설정 */}
                                            <div className="space-y-3">
                                                <h4 className="text-sm font-bold text-[#4b5563] dark:text-[#d1d5db]">🎙️ STT (음성인식)</h4>
                                                <div>
                                                    <label className="text-[10px] text-[#6b7280] dark:text-[#9ca3af] mb-1 block">메인 엔진 (Primary)</label>
                                                    <select 
                                                        className="w-full bg-[#ffffff] dark:bg-[#1f2937] border border-[#e5e7eb] dark:border-[#374151] rounded-xl p-2 text-xs font-bold text-green-400"
                                                        value={projectSettings.primarySTT}
                                                        onChange={e => setProjectSettings({...projectSettings, primarySTT: e.target.value as 'openai' | 'deepgram'})}
                                                    >
                                                        <option value="openai">OpenAI (gpt-4o-transcribe)</option>
                                                        <option value="deepgram">Deepgram (Nova-3)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-[#6b7280] dark:text-[#9ca3af] mb-1 block">보조 엔진 (Fallback)</label>
                                                    <select 
                                                        className="w-full bg-[#ffffff] dark:bg-[#1f2937] border border-[#e5e7eb] dark:border-[#374151] rounded-xl p-2 text-xs font-bold text-[#6b7280] dark:text-[#9ca3af]"
                                                        value={projectSettings.fallbackSTT}
                                                        onChange={e => setProjectSettings({...projectSettings, fallbackSTT: e.target.value as 'openai' | 'deepgram'})}
                                                    >
                                                        <option value="deepgram">Deepgram (Nova-3)</option>
                                                        <option value="openai">OpenAI (gpt-4o-transcribe)</option>
                                                    </select>
                                                </div>
                                            </div>

                                            {/* 번역 엔진 설정 */}
                                            <div className="space-y-3 border-l border-[#e5e7eb] dark:border-[#374151] pl-4">
                                                <h4 className="text-sm font-bold text-[#4b5563] dark:text-[#d1d5db]">🌐 Translation (번역)</h4>
                                                <div>
                                                    <label className="text-[10px] text-[#6b7280] dark:text-[#9ca3af] mb-1 block">메인 엔진 (Primary)</label>
                                                    <select 
                                                        className="w-full bg-[#ffffff] dark:bg-[#1f2937] border border-[#e5e7eb] dark:border-[#374151] rounded-xl p-2 text-xs font-bold text-[#1e3a5f] dark:text-[#d4af37]"
                                                        value={projectSettings.primaryTrans}
                                                        onChange={e => setProjectSettings({...projectSettings, primaryTrans: e.target.value as 'openai' | 'claude'})}
                                                    >
                                                        <option value="openai">OpenAI (gpt-4o-mini)</option>
                                                        <option value="claude">Anthropic (Claude 3 Haiku)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-[#6b7280] dark:text-[#9ca3af] mb-1 block">보조 엔진 (Fallback)</label>
                                                    <select 
                                                        className="w-full bg-[#ffffff] dark:bg-[#1f2937] border border-[#e5e7eb] dark:border-[#374151] rounded-xl p-2 text-xs font-bold text-[#6b7280] dark:text-[#9ca3af]"
                                                        value={projectSettings.fallbackTrans}
                                                        onChange={e => setProjectSettings({...projectSettings, fallbackTrans: e.target.value as 'openai' | 'claude'})}
                                                    >
                                                        <option value="claude">Anthropic (Claude 3 Haiku)</option>
                                                        <option value="openai">OpenAI (gpt-4o-mini)</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-blue-900/20 border border-blue-700/50 p-4 rounded-xl">
                                        <h3 className="text-sm font-bold text-[#1e3a5f] dark:text-[#d4af37] mb-2 flex items-center gap-2">
                                            🤖 Auto-Pilot 활성화됨
                                        </h3>
                                        <p className="text-xs text-[#4b5563] dark:text-[#d1d5db] leading-relaxed">
                                            가장 안정적이고 빠른 <strong>"2.5초 간격 연속 전송(Chunk)"</strong> 모드가 기본으로 적용되어 있습니다.<br/>
                                            오디오 유실이나 지연 없이 서버가 알아서 문맥을 재조립하여 최적의 번역을 수행합니다.
                                        </p>
                                    </div>
                                    
                                    <div className="flex items-start gap-2 pt-2 border-t border-[#e5e7eb] dark:border-[#374151]">
                                        <input type="checkbox" id="chkHideRaw"
                                            checked={projectSettings.hideRaw}
                                            onChange={e => setProjectSettings({ ...projectSettings, hideRaw: e.target.checked })}
                                            className="mt-0.5" />
                                        <div>
                                            <label htmlFor="chkHideRaw" className="text-sm text-[#4b5563] dark:text-[#d1d5db] cursor-pointer font-bold">
                                                🔒 Raw STT 숨김 (번역 완료 전 원문 미표시)
                                            </label>
                                            <p className="text-[10px] text-[#6b7280] dark:text-[#9ca3af] mt-0.5">체크 시 번역기가 정제한 텍스트만 청중 화면에 표시됩니다.</p>
                                        </div>
                                    </div>
                                </>}

                                {/* Section 1: Overlay */}
                                {settingsTab === 'overlay' && <div className="space-y-5">

                                    {/* Display Style */}
                                    <div>
                                        <h3 className="text-xs font-bold text-[#6b7280] dark:text-[#9ca3af] uppercase tracking-wider mb-2">Display Style</h3>
                                        <div className="grid grid-cols-2 gap-2">
                                            {(['youtube', 'typing'] as const).map(style => (
                                                <button key={style}
                                                    onClick={() => setProjectSettings({ ...projectSettings, displayStyle: style })}
                                                    className={`py-3 rounded-xl border text-sm font-bold transition-all ${projectSettings.displayStyle === style ? 'bg-[#1e3a5f] text-[#ffffff] border-blue-500 text-[#111827] dark:text-[#f9fafb]' : 'bg-[#ffffff] dark:bg-[#1f2937] border-[#d1d5db] dark:border-[#4b5563] text-[#6b7280] dark:text-[#9ca3af] hover:border-gray-400'}`}>
                                                    {style === 'youtube' ? '🎬 YouTube 스타일' : '⌨️ 타이핑 스타일'}
                                                </button>
                                            ))}
                                        </div>
                                        {projectSettings.displayStyle === 'typing' && (
                                            <div className="mt-3">
                                                <label className="text-xs text-[#6b7280] dark:text-[#9ca3af] block flex justify-between">
                                                    <span>타이핑 속도 (글자/초)</span>
                                                    <span className="text-[#111827] dark:text-[#f9fafb] font-bold">{projectSettings.typingSpeed} chars/s</span>
                                                </label>
                                                <input type="range" min="10" max="100" step="5" className="w-full mt-1"
                                                    value={projectSettings.typingSpeed}
                                                    onChange={e => setProjectSettings({ ...projectSettings, typingSpeed: Number(e.target.value) })} />
                                            </div>
                                        )}
                                    </div>

                                    {/* Layout */}
                                    <div>
                                        <h3 className="text-xs font-bold text-[#6b7280] dark:text-[#9ca3af] uppercase tracking-wider mb-2">Layout</h3>
                                        <div className="grid grid-cols-3 gap-3">
                                            <div>
                                                <label className="text-xs text-[#6b7280] dark:text-[#9ca3af] block mb-1">표시 줄 수</label>
                                                <select className="w-full bg-[#f3f4f6] dark:bg-[#374151] p-2 rounded-xl text-sm" value={projectSettings.maxLines}
                                                    onChange={e => setProjectSettings({ ...projectSettings, maxLines: Number(e.target.value) })}>
                                                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}줄</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-xs text-[#6b7280] dark:text-[#9ca3af] block mb-1">정렬</label>
                                                <select className="w-full bg-[#f3f4f6] dark:bg-[#374151] p-2 rounded-xl text-sm" value={projectSettings.align}
                                                    onChange={e => setProjectSettings({ ...projectSettings, align: e.target.value })}>
                                                    <option value="left">왼쪽</option>
                                                    <option value="center">가운데</option>
                                                    <option value="right">오른쪽</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-xs text-[#6b7280] dark:text-[#9ca3af] block mb-1">하단 여백 (px)</label>
                                                <input type="number" className="w-full bg-[#f3f4f6] dark:bg-[#374151] p-2 rounded-xl text-sm"
                                                    value={projectSettings.bottomOffset}
                                                    onChange={e => setProjectSettings({ ...projectSettings, bottomOffset: Number(e.target.value) })} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Font */}
                                    <div>
                                        <h3 className="text-xs font-bold text-[#6b7280] dark:text-[#9ca3af] uppercase tracking-wider mb-2">Font</h3>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-xs text-[#6b7280] dark:text-[#9ca3af] block mb-1">크기 (px)</label>
                                                <input type="number" min="12" max="120" className="w-full bg-[#f3f4f6] dark:bg-[#374151] p-2 rounded-xl text-sm"
                                                    value={projectSettings.fontSize}
                                                    onChange={e => setProjectSettings({ ...projectSettings, fontSize: Number(e.target.value) })} />
                                            </div>
                                            <div>
                                                <label className="text-xs text-[#6b7280] dark:text-[#9ca3af] block mb-1">굵기</label>
                                                <select className="w-full bg-[#f3f4f6] dark:bg-[#374151] p-2 rounded-xl text-sm" value={projectSettings.fontWeight}
                                                    onChange={e => setProjectSettings({ ...projectSettings, fontWeight: e.target.value })}>
                                                    <option value="normal">Normal</option>
                                                    <option value="bold">Bold</option>
                                                    <option value="800">Extra Bold</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-xs text-[#6b7280] dark:text-[#9ca3af] block mb-1">자간 (px)</label>
                                                <input type="number" min="-5" max="20" step="0.5" className="w-full bg-[#f3f4f6] dark:bg-[#374151] p-2 rounded-xl text-sm"
                                                    value={projectSettings.letterSpacing}
                                                    onChange={e => setProjectSettings({ ...projectSettings, letterSpacing: Number(e.target.value) })} />
                                            </div>
                                            <div>
                                                <label className="text-xs text-[#6b7280] dark:text-[#9ca3af] block mb-1">행간</label>
                                                <input type="number" min="1" max="3" step="0.1" className="w-full bg-[#f3f4f6] dark:bg-[#374151] p-2 rounded-xl text-sm"
                                                    value={projectSettings.lineHeight}
                                                    onChange={e => setProjectSettings({ ...projectSettings, lineHeight: Number(e.target.value) })} />
                                            </div>
                                            <div>
                                                <label className="text-xs text-[#6b7280] dark:text-[#9ca3af] block mb-1">글자 색</label>
                                                <input type="color" className="w-full h-9 bg-[#f3f4f6] dark:bg-[#374151] rounded-xl cursor-pointer"
                                                    value={projectSettings.fontColor}
                                                    onChange={e => setProjectSettings({ ...projectSettings, fontColor: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="text-xs text-[#6b7280] dark:text-[#9ca3af] block mb-1">텍스트 효과</label>
                                                <select className="w-full bg-[#f3f4f6] dark:bg-[#374151] p-2 rounded-xl text-sm" value={projectSettings.textEffect}
                                                    onChange={e => setProjectSettings({ ...projectSettings, textEffect: e.target.value })}>
                                                    <option value="shadow">드롭 쉐도우</option>
                                                    <option value="stroke">아웃라인</option>
                                                    <option value="none">없음</option>
                                                </select>
                                            </div>
                                            <div className="col-span-2">
                                                <label className="text-xs text-[#6b7280] dark:text-[#9ca3af] block mb-1">폰트 패밀리 (CSS)</label>
                                                <input type="text" className="w-full bg-[#f3f4f6] dark:bg-[#374151] p-2 rounded-xl text-sm"
                                                    placeholder="sans-serif, Arial, 'Noto Sans KR', ..."
                                                    value={projectSettings.fontFamily}
                                                    onChange={e => setProjectSettings({ ...projectSettings, fontFamily: e.target.value })} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Background */}
                                    <div>
                                        <h3 className="text-xs font-bold text-[#6b7280] dark:text-[#9ca3af] uppercase tracking-wider mb-2">Background</h3>
                                        <div className="grid grid-cols-3 gap-3">
                                            <div>
                                                <label className="text-xs text-[#6b7280] dark:text-[#9ca3af] block mb-1">배경색</label>
                                                <input type="color" className="w-full h-9 bg-[#f3f4f6] dark:bg-[#374151] rounded-xl cursor-pointer"
                                                    value={projectSettings.bgColor}
                                                    onChange={e => setProjectSettings({ ...projectSettings, bgColor: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="text-xs text-[#6b7280] dark:text-[#9ca3af] block mb-1">투명도 (0~1)</label>
                                                <input type="number" step="0.05" min="0" max="1" className="w-full bg-[#f3f4f6] dark:bg-[#374151] p-2 rounded-xl text-sm"
                                                    value={projectSettings.bgOpacity}
                                                    onChange={e => setProjectSettings({ ...projectSettings, bgOpacity: Number(e.target.value) })} />
                                            </div>
                                            <div>
                                                <label className="text-xs text-[#6b7280] dark:text-[#9ca3af] block mb-1">좌우 패딩 (px)</label>
                                                <input type="number" className="w-full bg-[#f3f4f6] dark:bg-[#374151] p-2 rounded-xl text-sm"
                                                    value={projectSettings.padding}
                                                    onChange={e => setProjectSettings({ ...projectSettings, padding: Number(e.target.value) })} />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="text-[10px] text-[#6b7280] dark:text-[#9ca3af]">※ 저장 즉시 오버레이에 실시간 반영됩니다.</div>
                                </div>}
                            </div>

                            <div className="flex justify-end gap-2 mt-4">
                                <button onClick={() => setShowProjectSettings(false)} className="px-4 py-2 text-[#6b7280] dark:text-[#9ca3af]">Cancel</button>
                                <button onClick={saveProjectSettings} className="px-4 py-2 bg-[#1e3a5f] text-[#ffffff] rounded-xl font-bold">Save Apply</button>
                            </div>
                        </div>
                    </div>
                )
            }

        </div >
    );
};

export default AdminDashboard;
