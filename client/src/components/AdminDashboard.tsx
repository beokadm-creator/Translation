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
    sourceLanguage?: 'ko' | 'en' | 'ja' | 'zh';
    targetLanguages?: string[];
}

const LANG_FLAGS: Record<string, string> = {
    ko: '🇰🇷', en: '🇺🇸', ja: '🇯🇵', zh: '🇨🇳'
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
    const [settingsTab, setSettingsTab] = useState<'overlay' | 'ai' | 'persona'>('overlay');

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
        targetLanguages?: string[];
        persona?: {
            enabled: boolean;
            basePromptKo?: string;
            basePromptEn?: string;
            basePromptJa?: string;
            basePromptZh?: string;
            customInstructions: string;
            medicalTerms: string;
        };
        chunk?: {
            minLength?: number;
            timeoutMs?: number;
            sentenceEnd?: boolean;
            chunkInterval?: number;
            vadMaxCutMs?: number;
        };
}

const [projectSettings, setProjectSettings] = useState<ProjectSettings>({
    fontSize: 48, fontColor: '#ffffff', fontWeight: 'bold', bgColor: '#000000', bgOpacity: 0.6,
    padding: 40, textEffect: 'shadow', align: 'center',
    displayStyle: 'youtube', letterSpacing: 0, maxLines: 2, lineHeight: 1.5,
    fontFamily: 'sans-serif', typingSpeed: 35, bottomOffset: 60,
    hideRaw: true,
    primarySTT: 'openai', fallbackSTT: 'deepgram',
    primaryTrans: 'openai', fallbackTrans: 'claude',
    targetLanguages: ['ko', 'en', 'ja', 'zh'],
    persona: {
        enabled: false,
        basePromptKo: '',
        basePromptEn: '',
        basePromptJa: '',
        basePromptZh: '',
        customInstructions: '',
        medicalTerms: ''
    }
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
                targetLanguages: val.targetLanguages || ['ko', 'en', 'ja', 'zh'],
                chunk: val.chunk || { minLength: 35, timeoutMs: 5000, sentenceEnd: true },
                persona: val.persona || {
                    enabled: false,
                    basePromptKo: '',
                    basePromptEn: '',
                    basePromptJa: '',
                    basePromptZh: '',
                    customInstructions: '',
                    medicalTerms: ''
                }
            }));
            }
        }).catch(err => console.error("설정 로드 실패:", err));
    }, [activeProjectId]);

    const saveProjectSettings = async () => {
        if (!projectSettings.targetLanguages || projectSettings.targetLanguages.length === 0) {
            alert("최소 1개의 Target Language를 선택해야 합니다.");
            return;
        }
        if (projectSettings.persona?.enabled) {
            if ((projectSettings.persona.customInstructions || '').length > 500) {
                alert("Custom Instructions는 500자를 초과할 수 없습니다.");
                return;
            }
            if ((projectSettings.persona.medicalTerms || '').length > 1000) {
                alert("Medical Terms는 1000자를 초과할 수 없습니다.");
                return;
            }
        }
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
            updates[`projects/${activeProjectId}/settings/targetLanguages`] = projectSettings.targetLanguages;
            updates[`projects/${activeProjectId}/settings/chunk`] = projectSettings.chunk;
            updates[`projects/${activeProjectId}/settings/persona`] = projectSettings.persona;

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
        } catch (e: unknown) {
            const errorStr = e instanceof Error ? e.message : String(e);
            console.error("Purge Failed:", e);
            alert("초기화 실패: " + errorStr);
        }
    };


    const [stream, setStream] = useState<MediaStream | null>(null);
    const mr1Ref = useRef<MediaRecorder | null>(null);
    const mr2Ref = useRef<MediaRecorder | null>(null);
    const switchRecordersRef = useRef<(() => void) | null>(null);
    const liveSourceLangOverrideRef = useRef<'ko' | 'en' | 'ja' | 'zh' | null>(null);
    const activeIndexRef = useRef<number>(0);
    const chunks1Ref = useRef<Blob[]>([]);
    const chunks2Ref = useRef<Blob[]>([]);
    const segmentTimerRef = useRef<number | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const rafIdRef = useRef<number | null>(null);
    const chunkMaxDbRef = useRef<number>(-100);
    const forceFlushNextChunkRef = useRef<boolean>(false);
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
                    
                    // ── 누락된 로직: streamData에서 삭제된 항목(초기화/아카이브 등)을 next에서도 삭제 ──
                    Object.keys(next).forEach(k => {
                        // 현재 라이브 세션의 데이터만 남겨야 함 (streamData에 없거나, 세션ID가 다르면 지움)
                        const streamItem = streamData[k] as { sessionId?: string } | undefined;
                        if (!streamItem || streamItem.sessionId !== activeSessionId) {
                            delete next[k];
                            changed = true;
                        }
                    });

                    Object.entries(streamData).forEach(([k, v]: [string, unknown]) => {
                        if (!v) return;
                        const value = v as StreamSegment & { sessionId?: string };
                        
                        // 현재 라이브 세션의 데이터만 처리
                        if (value.sessionId !== activeSessionId) return;

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
                targetLanguages: ['ko', 'en', 'ja', 'zh']
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
            const updates: Record<string, unknown> = {};
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
            const updates: Record<string, unknown> = {};
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
            const response = await fetch(`${CF_BASE}/archiveSession`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ projectId: activeProjectId, sessionId: sessionIdToArchive })
            });
            
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.message || `HTTP error! status: ${response.status}`);
            }
        } catch (e: unknown) {
            const errorStr = e instanceof Error ? e.message : String(e);
            console.error("Archive Failed:", e);
            alert(`세션 아카이브에 실패했습니다. 이전 데이터가 남아있을 수 있습니다.\n에러: ${errorStr}`);
            throw e; // 호출한 곳(handleGoLive)에서 후속 처리 중단할 수 있도록 throw
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
            const updates: Record<string, unknown> = {};
            updates[`projects/${activeProjectId}/sessions/${selectedSessionId}/transcript`] = null;
            
            // 만약 현재 라이브 중인 세션을 초기화한다면, stream과 state도 같이 비워야 고스트 데이터가 남지 않음
            if (selectedSessionId === activeSessionId) {
                const streamSnap = await get(ref(database, `projects/${activeProjectId}/stream`));
                if (streamSnap.exists()) {
                    Object.entries(streamSnap.val() as Record<string, unknown>).forEach(([k, v]) => {
                        const val = v as { sessionId?: string };
                        if (val && val.sessionId === selectedSessionId) {
                            updates[`projects/${activeProjectId}/stream/${k}`] = null;
                        }
                    });
                }
                // 기존 데이터가 삭제되었음을 확실히 기록하기 위해 lastSequence는 유지하되 버퍼만 비움
                updates[`projects/${activeProjectId}/state`] = {
                    bufferText: "",
                    bufferIds: [],
                    lastRefinedList: [],
                    lastFlushTime: Date.now()
                };
            } else {
                // 라이브 중이 아닌 세션을 지울 때도 혹시 stream에 남아있을 수 있는 쓰레기 데이터를 정리
                const streamSnap = await get(ref(database, `projects/${activeProjectId}/stream`));
                if (streamSnap.exists()) {
                    Object.entries(streamSnap.val() as Record<string, unknown>).forEach(([k, v]) => {
                        const val = v as { sessionId?: string };
                        if (val && val.sessionId === selectedSessionId) {
                            updates[`projects/${activeProjectId}/stream/${k}`] = null;
                        }
                    });
                }
            }

            await update(ref(database), updates);
            
            // 즉시 로컬 상태 초기화하여 화면에서 삭제
            setSegmentsMap({});
            alert("자막 데이터가 완벽하게 초기화되었습니다.");
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
            try {
                await triggerArchive(activeSessionId);
            } catch (e) {
                alert("아카이브에 실패하여 세션 종료를 중단합니다.");
                return;
            }
            await set(ref(database, `projects/${activeProjectId}/activeSessionId`), null);
            return;
        }

        if (activeSessionId && activeSessionId !== selectedSessionId) {
            if (!window.confirm(`Switch Live to new session? Current session (${activeSessionId}) will be archived.`)) return;
            try {
                await triggerArchive(activeSessionId);
            } catch (e) {
                alert("이전 세션 아카이브에 실패하여 세션 전환을 중단합니다.");
                return;
            }
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
        if (blob.size === 0) return;
        // CF TooSmall 기준 2000바이트 미만이면 무음/노이즈이므로 스킵
        if (blob.size < 2000) {
            console.debug(`[Upload] Skip: too small (${blob.size}B)`);
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
            const liveLang = activeSessionId && selectedSessionId === activeSessionId
                ? (liveSourceLangOverrideRef.current || formData.sourceLanguage)
                : undefined;
            const currentLang = liveLang || activeSession?.sourceLanguage || 'ko';
            
            // --- 2단계 최적화: 서버 DB 읽기 병목 제거를 위한 헤더 송장(Metadata) 생성 ---
            // 초록(Abstract)은 환각의 주범이므로 STT(Whisper) 힌트에서 완전히 제외합니다.
            // STT 프롬프트에는 오직 연자명, 소속, 주제, 사용자가 직접 입력한 Keyword만 들어갑니다.
            const speakerTerms = [activeSession?.speaker, activeSession?.affiliation, activeSession?.topic].filter(Boolean).join(', ');
            const customKeywords = [activeSession?.keywords, speakerTerms].filter(Boolean).join(', ');

            // GPT 번역용 배경지식 (번역 모델에서도 환각 가능성을 원천 차단하기 위해 초록은 제외)
            const sessionContext = `Topic: ${activeSession?.topic || ''}, Keywords: ${activeSession?.keywords || ''}, Speaker: ${activeSession?.speaker || ''}, Affiliation: ${activeSession?.affiliation || ''}`;

            // 3. 청크 설정값 (과거 안정화 버전 롤백 대신 설정 UI와 연동)
            const chunkMinLength = (projectSettings.chunk?.minLength ?? 35).toString();
            const chunkTimeoutMs = (projectSettings.chunk?.timeoutMs ?? 5000).toString();
            const chunkSentenceEnd = (projectSettings.chunk?.sentenceEnd ?? true).toString();

            const isForceFlush = forceFlushNextChunkRef.current;
            if (isForceFlush) forceFlushNextChunkRef.current = false;

            const url = `${CF_BASE}/processAudio?projectId=${encodeURIComponent(activeProjectId)}&sourceLabel=admin&sourceLang=${currentLang}`;
            console.debug(`[Upload] Sending ${blob.size}B → CF (project=${activeProjectId}, lang=${currentLang}, flush=${isForceFlush})`);
            
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
                    'X-Force-Flush': isForceFlush ? 'true' : 'false',
                    'X-Target-Languages': (projectSettings.targetLanguages || ['ko', 'en', 'ja', 'zh']).join(','),
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
                        console.debug(`[Upload] CF filtered: ${data.error || data.info}`);
                    } else {
                        setStatus('streaming');
                        console.debug(`[Upload] ✅ OK - "${data.text ? data.text.slice(0, 50) : 'empty/filtered'}"`);
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
                mr.onstop = () => { 
                    const chunks = [...targetChunksRef.current]; 
                    const skipVAD = (targetChunksRef.current as any).skipVAD;
                    targetChunksRef.current = []; 
                    (targetChunksRef.current as any).skipVAD = false;
                    
                    if (skipVAD) {
                        console.debug("[VAD] Client dropped chunk (silence detected).");
                    } else {
                        uploadChunks(chunks); 
                    }
                };
                return mr;
            };

            mr1Ref.current = createRecorder(chunks1Ref);
            mr2Ref.current = createRecorder(chunks2Ref);
            activeIndexRef.current = 0;
            mr1Ref.current.start();
            setIsRecording(true);
            setStatus("recording");
            chunkMaxDbRef.current = -100;

            const scheduleNextCut = (ms: number) => {
                if (segmentTimerRef.current) window.clearTimeout(segmentTimerRef.current);
                segmentTimerRef.current = window.setTimeout(() => {
                    console.debug("Forced Timeout -> Cutting");
                    switchRecorders();
                }, ms);
            };

            const switchRecorders = () => {
                const nextIndex = activeIndexRef.current === 0 ? 1 : 0;
                const nextMR = nextIndex === 0 ? mr1Ref.current : mr2Ref.current;
                const currentMR = activeIndexRef.current === 0 ? mr1Ref.current : mr2Ref.current;
                const currentChunksRef = activeIndexRef.current === 0 ? chunks1Ref : chunks2Ref;
                
                // 1. 새로운 레코더를 먼저 시작 (오버랩 시작)
                if (nextMR && nextMR.state === 'inactive') nextMR.start();
                
                // VAD 판단 (2.5초 동안 최대 볼륨이 -45dB 이하면 무음으로 간주)
                const maxDb = chunkMaxDbRef.current;
                chunkMaxDbRef.current = -100; // 리셋
                if (maxDb < -45 && !forceFlushNextChunkRef.current) {
                    (currentChunksRef.current as any).skipVAD = true;
                }

                // 2. 아주 미세한 오버랩(100ms)을 주어 스위칭 순간의 단어 잘림 방지
                setTimeout(() => {
                    if (currentMR && currentMR.state === 'recording') currentMR.stop();
                    activeIndexRef.current = nextIndex;

                    const interval = 2500;
                    scheduleNextCut(interval);
                }, 100);
            };
            switchRecordersRef.current = switchRecorders;

            console.debug("Starting Chunk Mode (2500ms)");
            scheduleNextCut(2500);

            const buf = new Float32Array(analyser.fftSize);
            const loop = () => {
                analyser.getFloatTimeDomainData(buf);
                let sum = 0;
                for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
                const rms = Math.sqrt(sum / buf.length);
                const db = 20 * Math.log10(Math.max(rms, 1e-8));
                setCurrentDb(db);
                if (db > chunkMaxDbRef.current) chunkMaxDbRef.current = db;
                rafIdRef.current = window.requestAnimationFrame(loop);
            };
            rafIdRef.current = window.requestAnimationFrame(loop);
        } catch (e) { console.error(e); setStatus("mic_error"); }
    };

    const stopRecording = useCallback(() => {
        if (segmentTimerRef.current) window.clearTimeout(segmentTimerRef.current);
        if (mr1Ref.current?.state === 'recording') mr1Ref.current.stop();
        if (mr2Ref.current?.state === 'recording') mr2Ref.current.stop();
        switchRecordersRef.current = null;
        liveSourceLangOverrideRef.current = null;
        stream?.getTracks().forEach(t => t.stop());
        audioContextRef.current?.close();
        if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        setIsRecording(false);
        setStatus("idle");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stream]);

    return (
        <div className="flex h-screen bg-[#0a0a0a] text-gray-200 overflow-hidden font-sans selection:bg-blue-500/30">
            {/* Sidebar: Agenda */}
            <div className="w-72 bg-[#0a0a0a] border-r border-white/5 flex flex-col z-10 shadow-xl">
                <div className="p-5 border-b border-white/5 flex justify-between items-center">
                    <span className="text-xs font-medium text-gray-400 uppercase tracking-widest">Agenda</span>
                    <div className="flex gap-2">
                        <button onClick={() => setShowProjectSettings(true)} className="text-gray-500 hover:text-white transition-colors p-1" title="Overlay & AI Settings">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
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
                                        const tgtLang = (projectSettings.targetLanguages && projectSettings.targetLanguages.length > 0) ? projectSettings.targetLanguages[0] : 'en';
                                        window.open(`/overlay/${activeProjectId}/${tgtLang}`, '_blank');
                                    }}
                                    title="Open Overlay"
                                    className="text-gray-500 hover:text-white transition-colors"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg>
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteSession(s); }} className="text-gray-500 hover:text-red-400 transition-colors">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main: Workspace */}
            <div className="flex-1 flex min-w-0">
                {/* Left: Session Settings */}
                <div className="w-1/2 p-6 border-r border-white/5 bg-[#0a0a0a] flex flex-col overflow-y-auto">
                    {selectedSessionId ? (
                        <div className="max-w-2xl mx-auto flex flex-col h-full w-full">
                            <div className="flex justify-between items-center mb-6 shrink-0">
                                <h2 className="text-base font-semibold tracking-tight text-gray-100">Session Settings</h2>
                                <div className="flex gap-2">
                                    <button onClick={() => { if (window.confirm("Archive this session?")) triggerArchive(selectedSessionId); }} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-md text-xs font-medium text-gray-400 transition-colors">Archive</button>
                                    <button onClick={handleSaveSession} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-md text-xs font-medium text-gray-300 transition-colors">Save</button>
                                    <button onClick={handleGoLive} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${activeSessionId === selectedSessionId ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-600 text-white hover:bg-green-500'}`}>
                                        {activeSessionId === selectedSessionId ? 'Stop Live' : 'Go Live'}
                                    </button>
                                </div>
                            </div>

                            {/* Overlay Links */}
                            {(() => {
                                const srcLang = (formData.sourceLanguage || 'ko') as 'ko' | 'en' | 'ja' | 'zh';
                                const targets = projectSettings.targetLanguages || ['ko', 'en', 'ja', 'zh'];
                                const origin = window.location.origin;
                                
                                const links = targets.map(lang => ({
                                    lang,
                                    label: `${lang.toUpperCase()} Overlay`,
                                    primary: true
                                }));
                                links.push({ lang: 'refined', label: `${srcLang.toUpperCase()} (Raw)`, primary: false });

                                return (
                                    <div className="flex gap-2 mb-6 p-3 bg-[#111111] rounded-lg border border-white/5 flex-wrap items-center shrink-0">
                                        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-medium mr-2">Overlays</span>
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
                                                        className="text-gray-500 hover:text-gray-300 p-1 transition-colors"
                                                    >
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
                                                    </button>
                                                </div>
                                            );
                                        })}
                                        <button
                                            onClick={() => window.open(`${origin}/overlay/${activeProjectId}/${targets[0]}?debug=true`, '_blank')}
                                            className="px-2 py-1.5 rounded-md text-[10px] bg-white/5 hover:bg-white/10 text-gray-500 ml-auto transition-colors"
                                        >Debug</button>
                                    </div>
                                );
                            })()}

                            <div className="flex flex-col gap-4 flex-1 overflow-y-auto">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">Speaker Name</label>
                                        <input className="w-full bg-[#111111] border border-white/10 rounded-md px-3 py-1.5 text-sm focus:border-white/30 outline-none text-gray-100 placeholder-gray-600 transition-colors" value={formData.speaker || ''} onChange={e => setFormData({ ...formData, speaker: e.target.value })} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">Time</label>
                                        <input className="w-full bg-[#111111] border border-white/10 rounded-md px-3 py-1.5 text-sm focus:border-white/30 outline-none text-gray-100 placeholder-gray-600 transition-colors font-mono" value={formData.startTime || ''} onChange={e => setFormData({ ...formData, startTime: e.target.value })} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">Source Language</label>
                                        <select
                                            className="w-full bg-[#111111] border border-white/10 rounded-md px-3 py-1.5 text-sm focus:border-white/30 outline-none text-gray-100 transition-colors"
                                            value={formData.sourceLanguage || 'ko'}
                                            onChange={async e => {
                                                const src = e.target.value as 'ko' | 'en' | 'ja' | 'zh';
                                                
                                                if (selectedSessionId && selectedSessionId === activeSessionId) {
                                                    // 1. 현재 녹음 중인 청크를 강제로 컷하고 서버 버퍼를 즉시 번역(flush)하도록 플래그 세팅
                                                    if (isRecording) {
                                                        forceFlushNextChunkRef.current = true;
                                                        switchRecordersRef.current?.();
                                                    }
                                                    
                                                    // 2. 약간의 지연(200ms)을 주어, 방금 컷된 청크가 '이전 언어'로 업로드되게 보장한 후 새 언어 적용
                                                    setTimeout(async () => {
                                                        liveSourceLangOverrideRef.current = src;
                                                        setFormData(prev => ({ ...prev, sourceLanguage: src }));
                                                        try {
                                                            const updates: Record<string, unknown> = {};
                                                            updates[`projects/${activeProjectId}/sessions/${selectedSessionId}/sourceLanguage`] = src;
                                                            await update(ref(database), updates);
                                                        } catch (err) {
                                                            console.error("LIVE 언어 자동 반영 실패:", err);
                                                        }
                                                    }, 200);
                                                } else {
                                                    setFormData({ ...formData, sourceLanguage: src });
                                                }
                                            }}
                                        >
                                            <option value="ko">Korean (한국어)</option>
                                            <option value="en">English (영어)</option>
                                            <option value="ja">Japanese (일본어)</option>
                                            <option value="zh">Chinese (중국어)</option>
                                        </select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">Target Language <span className="normal-case tracking-normal text-gray-600 ml-1">(Auto-derived)</span></label>
                                        <div className="flex gap-3 px-3 py-1.5 bg-[#111111]/50 rounded-md border border-white/5 h-[34px] items-center">
                                            {(projectSettings.targetLanguages || ['ko', 'en', 'ja', 'zh'])
                                                .filter(l => l !== (formData.sourceLanguage || 'ko'))
                                                .map(l => (
                                                <label key={l} className={`flex items-center gap-2 text-gray-200 cursor-not-allowed`}>
                                                    <input type="checkbox" checked disabled className="cursor-not-allowed accent-blue-500" />
                                                    <span className="uppercase text-xs font-medium">{l}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">Affiliation</label>
                                    <input className="w-full bg-[#111111] border border-white/10 rounded-md px-3 py-1.5 text-sm focus:border-white/30 outline-none text-gray-100 placeholder-gray-600 transition-colors" value={formData.affiliation || ''} onChange={e => setFormData({ ...formData, affiliation: e.target.value })} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">Topic</label>
                                    <input className="w-full bg-[#111111] border border-white/10 rounded-md px-3 py-1.5 text-sm focus:border-white/30 outline-none text-gray-100 placeholder-gray-600 transition-colors" value={formData.topic || ''} onChange={e => setFormData({ ...formData, topic: e.target.value })} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">
                                        Abstract (Context for AI)
                                        <span className="ml-2 text-[9px] bg-white/5 border border-white/10 text-blue-400 px-1.5 py-0.5 rounded normal-case tracking-normal">Improves STT + Translation</span>
                                    </label>
                                    <textarea className="w-full bg-[#111111] border border-white/10 rounded-md px-3 py-2 text-sm focus:border-white/30 outline-none text-gray-100 placeholder-gray-600 transition-colors resize-none h-28 leading-relaxed" placeholder="Enter abstract or presentation content. First 60 characters are used by Whisper STT for domain terminology recognition." value={formData.abstract || ''} onChange={e => setFormData({ ...formData, abstract: e.target.value })} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-medium">Keywords <span className="normal-case tracking-normal text-gray-600 ml-1">(Comma separated)</span></label>
                                    <input className="w-full bg-[#111111] border border-white/10 rounded-md px-3 py-1.5 text-sm focus:border-white/30 outline-none text-gray-100 placeholder-gray-600 transition-colors" placeholder="e.g. Implant, Sinus, Bone Graft" value={formData.keywords || ''} onChange={e => setFormData({ ...formData, keywords: e.target.value })} />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-600 space-y-3">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-40"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            <span className="text-sm">Select a session from the agenda</span>
                        </div>
                    )}
                </div>

                {/* Right: Monitor & Controls */}
                <div className="w-1/2 bg-[#0a0a0a] flex flex-col p-6">
                    <div className="flex justify-between items-center mb-4 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="flex bg-[#111111] rounded-md p-1 border border-white/5">
                                <button onClick={() => setSourceType('mic')} className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${sourceType === 'mic' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-300'}`}>Mic</button>
                                <button onClick={() => setSourceType('system')} className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${sourceType === 'system' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-300'}`}>System</button>
                            </div>
                            <button onClick={isRecording ? stopRecording : startRecording} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${isRecording ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20" : "bg-white text-black hover:bg-gray-200"}`}>
                                {isRecording ? "STOP BROADCAST" : "START BROADCAST"}
                            </button>

                            <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div className="h-full bg-green-500 rounded-full transition-all duration-75" style={{ width: `${Math.min(100, Math.max(0, ((currentDb + 90) / 60) * 100))}%` }} />
                            </div>
                            <HealthDashboard projectId={activeProjectId} />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-600 uppercase tracking-widest">Status</span>
                            <span className={`text-xs font-medium font-mono ${status === 'recording' || status === 'streaming' ? 'text-green-400' : 'text-gray-500'}`}>{status}</span>
                        </div>
                    </div>

                    <AudioVisualizer stream={stream} width={800} height={36} />

                    {/* Transcript Viewer */}
                    <div className="flex-1 flex flex-col mt-4 border border-white/5 rounded-xl overflow-hidden bg-[#111111]">
                        <div className="bg-[#1a1a1a] px-4 py-2.5 flex justify-between items-center border-b border-white/5 shrink-0">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-400">
                                    {selectedSessionId ? `Transcript — ${formData.speaker}` : "Transcript Viewer"}
                                </span>
                                {selectedSessionId && (
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold ${viewMode === 'live' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-white/5 text-gray-500 border border-white/10'}`}>
                                        {viewMode === 'live' ? 'LIVE' : 'ARCHIVED'}
                                    </span>
                                )}
                            </div>
                            <div className="flex gap-1.5">
                                {viewMode === 'live' && activeSessionId && (
                                    <button
                                        onClick={triggerPurge}
                                        className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 transition-colors"
                                        title="완전 삭제"
                                    >
                                        Purge
                                    </button>
                                )}
                                {viewMode === 'archive' && (
                                    <>
                                        <button onClick={handleExport} className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-[10px] font-bold uppercase tracking-wider rounded-md text-gray-300 transition-colors">
                                            Export
                                        </button>
                                        <button onClick={handleClearTranscript} className="px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-[10px] font-bold uppercase tracking-wider rounded-md text-red-400 border border-red-500/20 transition-colors">
                                            Clear
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5">
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
            {showProjectSettings && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                    <div className="bg-[#111111] p-6 rounded-xl w-full max-w-2xl space-y-5 border border-white/10 shadow-2xl">
                        <div className="flex justify-between items-center border-b border-white/5 pb-4">
                            <h2 className="text-base font-semibold tracking-tight text-gray-100">Project Settings</h2>
                            <div className="flex gap-2 text-[10px]">
                                <span className="bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-1 rounded-md font-mono">STT: gpt-4o-transcribe</span>
                                <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-1 rounded-md font-mono">Trans: gpt-4o-mini</span>
                            </div>
                        </div>

                        {/* Tabs */}
                        <div className="flex border-b border-white/5">
                            <button onClick={() => setSettingsTab('overlay')} className={`px-4 py-2 text-sm font-medium transition-colors ${settingsTab === 'overlay' ? 'border-b-2 border-white text-white' : 'text-gray-500 hover:text-gray-300'}`}>Overlay Design</button>
                            <button onClick={() => setSettingsTab('ai')} className={`px-4 py-2 text-sm font-medium transition-colors ${settingsTab === 'ai' ? 'border-b-2 border-white text-white' : 'text-gray-500 hover:text-gray-300'}`}>Audio & AI</button>
                            <button onClick={() => setSettingsTab('persona')} className={`px-4 py-2 text-sm font-medium transition-colors ${settingsTab === 'persona' ? 'border-b-2 border-white text-white' : 'text-gray-500 hover:text-gray-300'}`}>AI Persona (Prompt)</button>
                        </div>

                        <div className="space-y-5 overflow-y-auto max-h-[60vh] pr-1">
                            {/* Persona Settings */}
                            {settingsTab === 'persona' && <>
                                <div className="space-y-4 mb-6">
                                    <div className="space-y-2 bg-[#1a1a1a] border border-white/5 p-4 rounded-lg">
                                        <label className="text-[10px] text-gray-500 uppercase tracking-wider block font-bold">Target Languages (Global Setting)</label>
                                        <p className="text-[10px] text-gray-500 mb-2">Select which languages to generate translations for. These will appear as tabs in the Audience View.</p>
                                        <div className="flex flex-wrap gap-2">
                                            {['ko', 'en', 'ja', 'zh'].map(lang => (
                                                <label key={lang} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-md cursor-pointer transition-colors ${(projectSettings.targetLanguages || []).includes(lang) ? 'bg-blue-600/20 border-blue-500/30 text-blue-400' : 'bg-[#111111] border-white/5 text-gray-400 hover:bg-white/5'} border`}>
                                                    <input type="checkbox" className="accent-blue-500" 
                                                        checked={(projectSettings.targetLanguages || []).includes(lang)}
                                                        onChange={e => {
                                                            const langs = new Set(projectSettings.targetLanguages || []);
                                                            if (e.target.checked) langs.add(lang);
                                                            else langs.delete(lang);
                                                            setProjectSettings({ ...projectSettings, targetLanguages: Array.from(langs) });
                                                        }}
                                                    />
                                                    <span className="uppercase font-medium">{lang}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between bg-[#1a1a1a] border border-white/5 p-4 rounded-lg">
                                    <div>
                                        <h3 className="text-sm font-medium text-gray-200">Enable Custom Persona</h3>
                                        <p className="text-[10px] text-gray-500 mt-1">Override default AI prompts with your custom instructions per language.</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" className="sr-only peer" checked={projectSettings.persona?.enabled || false}
                                            onChange={e => setProjectSettings({ ...projectSettings, persona: { ...projectSettings.persona!, enabled: e.target.checked } })} />
                                        <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                                    </label>
                                </div>
                                
                                {projectSettings.persona?.enabled && (
                                    <div className="space-y-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block font-medium">Global Custom Instructions</label>
                                            <textarea className="w-full bg-[#111111] border border-white/5 rounded-md p-3 text-sm text-gray-200 outline-none focus:border-white/20 resize-none h-20 placeholder-gray-600"
                                                placeholder="e.g. Always output professional and academic tone..."
                                                value={projectSettings.persona?.customInstructions || ''}
                                                onChange={e => setProjectSettings({ ...projectSettings, persona: { ...projectSettings.persona!, customInstructions: e.target.value } })}
                                            />
                                        </div>

                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block font-medium">Medical Terms / Dictionary</label>
                                            <textarea className="w-full bg-[#111111] border border-white/5 rounded-md p-3 text-sm text-gray-200 outline-none focus:border-white/20 resize-none h-20 placeholder-gray-600"
                                                placeholder="e.g. Fixture: 픽스쳐, Abutment: 지대주..."
                                                value={projectSettings.persona?.medicalTerms || ''}
                                                onChange={e => setProjectSettings({ ...projectSettings, persona: { ...projectSettings.persona!, medicalTerms: e.target.value } })}
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            {(projectSettings.targetLanguages || []).includes('ko') && (
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Base Prompt (Korean)</label>
                                                    <textarea className="w-full bg-[#111111] border border-white/5 rounded-md p-2 text-xs text-gray-300 outline-none focus:border-white/20 resize-none h-16"
                                                        value={projectSettings.persona?.basePromptKo || ''}
                                                        onChange={e => setProjectSettings({ ...projectSettings, persona: { ...projectSettings.persona!, basePromptKo: e.target.value } })}
                                                    />
                                                </div>
                                            )}
                                            {(projectSettings.targetLanguages || []).includes('en') && (
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Base Prompt (English)</label>
                                                    <textarea className="w-full bg-[#111111] border border-white/5 rounded-md p-2 text-xs text-gray-300 outline-none focus:border-white/20 resize-none h-16"
                                                        value={projectSettings.persona?.basePromptEn || ''}
                                                        onChange={e => setProjectSettings({ ...projectSettings, persona: { ...projectSettings.persona!, basePromptEn: e.target.value } })}
                                                    />
                                                </div>
                                            )}
                                            {(projectSettings.targetLanguages || []).includes('ja') && (
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Base Prompt (Japanese)</label>
                                                    <textarea className="w-full bg-[#111111] border border-white/5 rounded-md p-2 text-xs text-gray-300 outline-none focus:border-white/20 resize-none h-16"
                                                        value={projectSettings.persona?.basePromptJa || ''}
                                                        onChange={e => setProjectSettings({ ...projectSettings, persona: { ...projectSettings.persona!, basePromptJa: e.target.value } })}
                                                    />
                                                </div>
                                            )}
                                            {(projectSettings.targetLanguages || []).includes('zh') && (
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Base Prompt (Chinese)</label>
                                                    <textarea className="w-full bg-[#111111] border border-white/5 rounded-md p-2 text-xs text-gray-300 outline-none focus:border-white/20 resize-none h-16"
                                                        value={projectSettings.persona?.basePromptZh || ''}
                                                        onChange={e => setProjectSettings({ ...projectSettings, persona: { ...projectSettings.persona!, basePromptZh: e.target.value } })}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </>}

                            {/* AI Settings */}
                            {settingsTab === 'ai' && <>
                                <div className="bg-[#1a1a1a] border border-white/5 p-4 rounded-lg space-y-4">
                                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">AI Models</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-3">
                                            <p className="text-xs font-medium text-gray-400">STT (Speech to Text)</p>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-600 uppercase tracking-wider block">Primary</label>
                                                <select
                                                    className="w-full bg-[#111111] border border-white/5 rounded-md p-2 text-xs font-medium text-green-400 outline-none focus:border-white/20"
                                                    value={projectSettings.primarySTT}
                                                    onChange={e => setProjectSettings({...projectSettings, primarySTT: e.target.value as 'openai' | 'deepgram'})}
                                                >
                                                    <option value="openai">OpenAI (gpt-4o-transcribe)</option>
                                                    <option value="deepgram">Deepgram (Nova-3)</option>
                                                </select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-600 uppercase tracking-wider block">Fallback</label>
                                                <select
                                                    className="w-full bg-[#111111] border border-white/5 rounded-md p-2 text-xs font-medium text-gray-400 outline-none focus:border-white/20"
                                                    value={projectSettings.fallbackSTT}
                                                    onChange={e => setProjectSettings({...projectSettings, fallbackSTT: e.target.value as 'openai' | 'deepgram'})}
                                                >
                                                    <option value="deepgram">Deepgram (Nova-3)</option>
                                                    <option value="openai">OpenAI (gpt-4o-transcribe)</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="space-y-3 border-l border-white/5 pl-4">
                                            <p className="text-xs font-medium text-gray-400">Translation</p>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-600 uppercase tracking-wider block">Primary</label>
                                                <select
                                                    className="w-full bg-[#111111] border border-white/5 rounded-md p-2 text-xs font-medium text-blue-400 outline-none focus:border-white/20"
                                                    value={projectSettings.primaryTrans}
                                                    onChange={e => setProjectSettings({...projectSettings, primaryTrans: e.target.value as 'openai' | 'claude'})}
                                                >
                                                    <option value="openai">OpenAI (gpt-4o-mini)</option>
                                                    <option value="claude">Anthropic (Claude 3 Haiku)</option>
                                                </select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-gray-600 uppercase tracking-wider block">Fallback</label>
                                                <select
                                                    className="w-full bg-[#111111] border border-white/5 rounded-md p-2 text-xs font-medium text-gray-400 outline-none focus:border-white/20"
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

                                <div className="bg-blue-500/5 border border-blue-500/15 p-4 rounded-lg">
                                    <p className="text-xs font-medium text-blue-400 mb-1">Auto-Pilot Active</p>
                                    <p className="text-xs text-gray-500 leading-relaxed">
                                        2.5s interval chunk mode is enabled by default — the most stable and low-latency configuration.
                                        The server reassembles context automatically for optimal translation quality.
                                    </p>
                                </div>

                                <div className="flex items-start gap-3 pt-3 border-t border-white/5">
                                    <input type="checkbox" id="chkHideRaw"
                                        checked={projectSettings.hideRaw}
                                        onChange={e => setProjectSettings({ ...projectSettings, hideRaw: e.target.checked })}
                                        className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-[#111111] accent-white" />
                                    <div>
                                        <label htmlFor="chkHideRaw" className="text-sm text-gray-300 cursor-pointer font-medium">
                                            Hide Raw STT Text
                                        </label>
                                        <p className="text-[10px] text-gray-500 mt-0.5">Only display text after refinement. Prevents unprocessed STT output from appearing on the audience screen.</p>
                                    </div>
                                </div>
                            </>}

                            {/* Overlay Settings */}
                            {settingsTab === 'overlay' && <div className="space-y-6">
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
                                        <div className="mt-3 bg-[#1a1a1a] p-4 rounded-lg border border-white/5">
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

                                <div className="space-y-3">
                                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Layout</h3>
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Max Lines</label>
                                            <select className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20" value={projectSettings.maxLines}
                                                onChange={e => setProjectSettings({ ...projectSettings, maxLines: Number(e.target.value) })}>
                                                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} Lines</option>)}
                                            </select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Align</label>
                                            <select className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20" value={projectSettings.align}
                                                onChange={e => setProjectSettings({ ...projectSettings, align: e.target.value })}>
                                                <option value="left">Left</option>
                                                <option value="center">Center</option>
                                                <option value="right">Right</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Bottom Offset</label>
                                            <input type="number" className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20 font-mono"
                                                value={projectSettings.bottomOffset}
                                                onChange={e => setProjectSettings({ ...projectSettings, bottomOffset: Number(e.target.value) })} />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Typography</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Size (px)</label>
                                            <input type="number" min="12" max="120" className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20 font-mono"
                                                value={projectSettings.fontSize}
                                                onChange={e => setProjectSettings({ ...projectSettings, fontSize: Number(e.target.value) })} />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Weight</label>
                                            <select className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20" value={projectSettings.fontWeight}
                                                onChange={e => setProjectSettings({ ...projectSettings, fontWeight: e.target.value })}>
                                                <option value="normal">Normal</option>
                                                <option value="bold">Bold</option>
                                                <option value="800">Extra Bold</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Letter Spacing</label>
                                            <input type="number" min="-5" max="20" step="0.5" className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20 font-mono"
                                                value={projectSettings.letterSpacing}
                                                onChange={e => setProjectSettings({ ...projectSettings, letterSpacing: Number(e.target.value) })} />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Line Height</label>
                                            <input type="number" min="1" max="3" step="0.1" className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20 font-mono"
                                                value={projectSettings.lineHeight}
                                                onChange={e => setProjectSettings({ ...projectSettings, lineHeight: Number(e.target.value) })} />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Text Color</label>
                                            <div className="flex items-center gap-2">
                                                <input type="color" className="h-9 w-12 bg-transparent cursor-pointer rounded"
                                                    value={projectSettings.fontColor}
                                                    onChange={e => setProjectSettings({ ...projectSettings, fontColor: e.target.value })} />
                                                <span className="text-xs font-mono text-gray-500">{projectSettings.fontColor}</span>
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Text Effect</label>
                                            <select className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20" value={projectSettings.textEffect}
                                                onChange={e => setProjectSettings({ ...projectSettings, textEffect: e.target.value })}>
                                                <option value="shadow">Drop Shadow</option>
                                                <option value="stroke">Outline</option>
                                                <option value="none">None</option>
                                            </select>
                                        </div>
                                        <div className="col-span-2 space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Font Family</label>
                                            <input type="text" className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20 font-mono"
                                                placeholder="sans-serif, Arial, 'Noto Sans KR', ..."
                                                value={projectSettings.fontFamily}
                                                onChange={e => setProjectSettings({ ...projectSettings, fontFamily: e.target.value })} />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Background</h3>
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Color</label>
                                            <div className="flex items-center gap-2">
                                                <input type="color" className="h-9 w-10 bg-transparent cursor-pointer rounded"
                                                    value={projectSettings.bgColor}
                                                    onChange={e => setProjectSettings({ ...projectSettings, bgColor: e.target.value })} />
                                                <span className="text-xs font-mono text-gray-600">{projectSettings.bgColor}</span>
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Opacity</label>
                                            <input type="number" step="0.05" min="0" max="1" className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20 font-mono"
                                                value={projectSettings.bgOpacity}
                                                onChange={e => setProjectSettings({ ...projectSettings, bgOpacity: Number(e.target.value) })} />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-gray-500 uppercase tracking-wider block">Padding (px)</label>
                                            <input type="number" className="w-full bg-[#1a1a1a] border border-white/5 p-2 rounded-md text-sm text-gray-200 outline-none focus:border-white/20 font-mono"
                                                value={projectSettings.padding}
                                                onChange={e => setProjectSettings({ ...projectSettings, padding: Number(e.target.value) })} />
                                        </div>
                                    </div>
                                </div>

                                <div className="text-[10px] text-gray-600 flex items-center gap-2 bg-white/5 p-2 rounded-md">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                                    Changes apply to overlay in real-time upon saving.
                                </div>
                            </div>}
                        </div>

                        <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                            <button onClick={() => setShowProjectSettings(false)} className="px-4 py-2 text-xs font-medium text-gray-500 hover:text-white transition-colors">Cancel</button>
                            <button onClick={saveProjectSettings} className="px-4 py-2 bg-white text-black rounded-md text-xs font-medium hover:bg-gray-200 transition-colors">Save Changes</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default AdminDashboard;
