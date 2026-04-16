import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { rtdb as database } from '../firebase';
import { ref, onValue, get } from 'firebase/database';
import { useProjectStream } from '../hooks/useProjectStream';
import TextItem from './TextItem';

const CF_BASE = import.meta.env.VITE_CF_BASE_URL || 'https://us-central1-translation-comm.cloudfunctions.net';

const HALLUCINATION_BLACKLIST = [
    '자막제작', '자막 제작', 'Subtitles by', 'Subtitle by', 'MBC 뉴스', 'SBS 뉴스', 'KBS 뉴스',
    'Copyright', 'http', '.co.kr',
    '알 수 없는 소리', '(박수)', '[박수]', '(웃음)', '[웃음]', '(환호)', '[환호]',
    '(음악)', '[음악]', '(노래)', '[노래]', '(소음)', '[소음]',
    '[Music]', '(Music)', '[Applause]', '(Applause)', '[Laughter]', '(Laughter)',
    '번역 제공', '자막 제공',
];
const isGarbage = (text: string) => {
    if (!text) return false;
    if (HALLUCINATION_BLACKLIST.some(bad => text.includes(bad))) return true;
    if (/(.+)\1{2,}/.test(text)) return true;
    if (/(.*,){4,}/.test(text)) return true;
    if (/^(Implant, Surgery|임플란트, 보철)/i.test(text)) return true;
    // 전체가 괄호/대괄호 소리 표기인 경우
    if (/^\s*[\[(][^\])]{1,40}[\])]\s*$/.test(text.trim())) return true;
    return false;
};


// ─── Main Component ──────────────────────────────────────────────────────────
const AudienceView: React.FC = () => {
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();
    const activeProjectId = projectId || "default";

    // --- UI State ---
    const [fontSize, setFontSize] = useState<number>(24);
    const [letterSpacing, setLetterSpacing] = useState<number>(0);
    const [lineHeight, setLineHeight] = useState<number>(1.8);
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

    // --- TTS State ---
    const [isTtsEnabled, setIsTtsEnabled] = useState<boolean>(false);
    const [speakingId, setSpeakingId] = useState<string | null>(null);
    const [ttsSpeed, setTtsSpeed] = useState<number>(1.0);
    const [ttsGender, setTtsGender] = useState<'female' | 'male'>('female');
    const [showTtsHint, setShowTtsHint] = useState<boolean>(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioQueueRef = useRef<{ text: string; lang: string; id: string }[]>([]);
    const spokenIdsRef = useRef<Set<string>>(new Set());
    const isSpeakingRef = useRef<boolean>(false);
    // Refs so playNext doesn't need to recreate on speed/gender change
    const ttsSpeedRef = useRef<number>(1.0);
    const ttsGenderRef = useRef<'female' | 'male'>('female');
    ttsSpeedRef.current = ttsSpeed;
    ttsGenderRef.current = ttsGender;

    // 성별 → OpenAI 음성 매핑 (ref 기반 — 재생 중 변경 즉시 반영)
    const ttsVoiceFromRef = (lang: string) =>
        ttsGenderRef.current === 'female'
            ? (lang === 'ko' ? 'nova' : 'shimmer')
            : (lang === 'ko' ? 'onyx' : 'echo');

    // --- Session & Mode State ---
    type SessionItem = {
        id: string;
        startTime: string;
        speaker: string;
        affiliation: string;
        topic: string;
        sourceLanguage?: string;
        targetLanguages?: string[];
    };
    const [sessions, setSessions] = useState<SessionItem[]>([]);
    const [viewMode, setViewMode] = useState<'live' | 'archive'>('live');
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [archiveSessionId, setArchiveSessionId] = useState<string | null>(null);

    // --- Derived Session Info ---
    const activeOrArchiveId = viewMode === 'live' ? activeSessionId : archiveSessionId;
    const currentSession = sessions.find(s => s.id === activeOrArchiveId);

    const sessionInfo = currentSession ? {
        speaker: currentSession.speaker,
        affiliation: currentSession.affiliation,
        topic: currentSession.topic,
        sourceLanguage: currentSession.sourceLanguage
    } : null;
    const currentSessionId = currentSession?.id || null;
    const currentSourceLanguage = currentSession?.sourceLanguage || null;

    // --- Display Info ---
    // 기본 언어: 세션의 첫 번째 타겟 언어 (원본 언어 제외)
    // 세션 로드 전까지는 'en'을 기본으로 사용
    const [activeLang, setActiveLang] = useState<string>('en');
    const [hideRaw, setHideRaw] = useState<boolean>(true); // Default: hide Whisper raw text

    // 세션 정보가 로드되면 기본 언어 자동 전환 (원본 언어가 아닌 첫 번째 타겟 언어)
    useEffect(() => {
        if (!currentSessionId) return;
        const sourceLang = currentSourceLanguage || 'ko';
        setActiveLang(sourceLang === 'ko' ? 'en' : 'ko');
    }, [currentSessionId, currentSourceLanguage]);

    // --- Stream State ---
    const { streamData, loadOlderMessages, hasMore } = useProjectStream(activeProjectId, { subscribe: viewMode === 'live' });
    type SegmentMap = Record<string, {
        original?: string;
        refined?: string;
        status?: string;
        sessionId?: string;
        timestamp?: number;
        mergedIds?: string[];
        [key: string]: string | number | string[] | undefined;
    }>;
    const [segmentsMap, setSegmentsMap] = useState<SegmentMap>({});
    const [segmentsOrder, setSegmentsOrder] = useState<string[]>([]);
    const messagesEndRef = React.useRef<HTMLDivElement | null>(null);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    // --- TTS Functions ---
    const stopAudio = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = "";
            audioRef.current = null;
        }
        audioQueueRef.current = [];
        isSpeakingRef.current = false;
        setSpeakingId(null);
    }, []);

    const playNext = useCallback(() => {
        const next = audioQueueRef.current.shift();
        if (!next) {
            isSpeakingRef.current = false;
            setSpeakingId(null);
            return;
        }
        const voice = ttsVoiceFromRef(next.lang);
        const url = `${CF_BASE}/synthesizeSpeech?text=${encodeURIComponent(next.text)}&lang=${next.lang}&speed=${ttsSpeedRef.current}&voice=${voice}`;
        const audio = new Audio(url);
        audioRef.current = audio;
        setSpeakingId(next.id);
        audio.onended = () => playNext();
        audio.onerror = () => playNext();
        audio.play().catch(() => playNext());
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const enqueueSpeak = useCallback((text: string, lang: string, id: string) => {
        if (!text.trim()) return;
        audioQueueRef.current.push({ text, lang, id });
        if (!isSpeakingRef.current) {
            isSpeakingRef.current = true;
            playNext();
        }
    }, [playNext]);

    // 클릭: 해당 세그먼트부터 이후 모든 세그먼트 연속 재생
    const handleSpeak = useCallback((_text: string, lang: string, id?: string) => {
        stopAudio();

        const startIndex = id ? segmentsOrder.indexOf(id) : -1;
        const fromIndex = startIndex >= 0 ? startIndex : segmentsOrder.length - 1;

        // 클릭한 세그먼트부터 끝까지 final 세그먼트를 큐에 쌓음
        const queue: { text: string; lang: string; id: string }[] = [];
        for (let i = fromIndex; i < segmentsOrder.length; i++) {
            const sid = segmentsOrder[i];
            const seg = segmentsMap[sid];
            if (!seg || seg.status === 'merged') continue;
            const t = (seg[lang] as string) || '';
            if (t.trim()) queue.push({ text: t, lang, id: sid });
        }

        if (queue.length === 0) return;

        isSpeakingRef.current = true;
        audioQueueRef.current = queue;
        playNext();
    }, [stopAudio, playNext, segmentsOrder, segmentsMap]);

    useEffect(() => {
        stopAudio();
        spokenIdsRef.current.clear();
    }, [activeLang, stopAudio]);

    // 5. Scroll & Paging Logic
    useEffect(() => {
        // 새로운 메시지가 도착하거나 처음 로드될 때 스크롤을 맨 아래로
        scrollToBottom();
    }, [segmentsOrder.length, scrollToBottom]);

    // 무한 스크롤 트리거 (Intersection Observer)
    const topObserverRef = React.useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!hasMore || viewMode !== 'live') return;
        
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadOlderMessages();
                }
            },
            { threshold: 0.1 }
        );

        if (topObserverRef.current) {
            observer.observe(topObserverRef.current);
        }

        return () => observer.disconnect();
    }, [hasMore, viewMode, loadOlderMessages]);

    // 연속재생 중 신규 세그먼트 자동 추가 (클릭으로 시작된 재생 중에만)
    // TTS 활성화 단독으로는 재생 시작하지 않음 — 반드시 세그먼트 클릭으로 시작
    useEffect(() => {
        const lastId = segmentsOrder[segmentsOrder.length - 1];
        if (!lastId) return;
        const seg = segmentsMap[lastId];
        if (seg?.status !== 'final') return;
        if (spokenIdsRef.current.has(lastId)) return;

        const text = (seg[activeLang] as string) || '';
        if (!text.trim()) return;

        // 이미 재생 중인 경우에만 새 세그먼트를 큐에 추가
        if (isSpeakingRef.current) {
            spokenIdsRef.current.add(lastId);
            enqueueSpeak(text, activeLang, lastId);
        }
    }, [segmentsOrder, segmentsMap, activeLang, enqueueSpeak]);

    // TTS 비활성화 시 재생 중단 / 활성화 시 힌트 표시
    useEffect(() => {
        if (!isTtsEnabled) {
            stopAudio();
        } else {
            setShowTtsHint(true);
            const t = setTimeout(() => setShowTtsHint(false), 3500);
            return () => clearTimeout(t);
        }
    }, [isTtsEnabled, stopAudio]);

    // 컴포넌트 언마운트 시 오디오 정리
    useEffect(() => {
        return () => stopAudio();
    }, [stopAudio]);

    // 1. Initial Load
    useEffect(() => {
        get(ref(database, `projects/${activeProjectId}/settings`)).then(snap => {
            if (snap.exists()) {
                const settings = snap.val();
                if (settings.hideRaw !== undefined) setHideRaw(settings.hideRaw);
            }
        });

        const sessionsRef = ref(database, `projects/${activeProjectId}/sessions`);
        const unsubSessions = onValue(sessionsRef, (snap) => {
            const data = snap.val();
            if (data) {
                const list = Object.entries(data).map(([k, v]: [string, unknown]) => {
                    const sessionData = v as Omit<SessionItem, 'id'>;
                    return { id: k, ...sessionData };
                });
                setSessions(list.sort((a, b) => a.startTime.localeCompare(b.startTime)));
            } else {
                setSessions([]);
            }
        });

        const activeRef = ref(database, `projects/${activeProjectId}/activeSessionId`);
        const unsubActive = onValue(activeRef, (snap) => {
            const sid = snap.val();
            setActiveSessionId(sid);
        });
        return () => { unsubSessions(); unsubActive(); };
    }, [activeProjectId]);

    useEffect(() => {
        if (viewMode !== 'live') return;
        stopAudio();
        spokenIdsRef.current.clear();
        setSegmentsMap({});
        setSegmentsOrder([]);
    }, [activeSessionId, viewMode, stopAudio]);

    // 2. Data Handling
    useEffect(() => {
        if (viewMode === 'live') {
            if (!streamData) return;
            
            setSegmentsMap(prev => {
                const next = { ...prev };
                let changed = false;
                
                // ── 누락된 로직: streamData에서 삭제된 항목(초기화 등)을 next에서도 삭제 ──
                Object.keys(next).forEach(k => {
                    if (!streamData[k] || (streamData[k] as any).sessionId !== activeSessionId) {
                        delete next[k];
                        changed = true;
                    }
                });

                Object.entries(streamData).forEach(([k, v]: [string, unknown]) => {
                    const segment = v as SegmentMap[string];
                    if (!activeSessionId || segment.sessionId !== activeSessionId) return;
                    
                    // 가비지 처리
                    if (isGarbage(segment.original || "")) {
                        if (next[k]) { delete next[k]; changed = true; }
                        return;
                    }
                    
                    // 병합된 이전 세그먼트 삭제
                    if (segment.mergedIds && Array.isArray(segment.mergedIds)) {
                        segment.mergedIds.forEach((pid: string) => {
                            if (next[pid]) { delete next[pid]; changed = true; }
                        });
                    }
                    
                    // 새로운 데이터 추가 또는 갱신
                    if (JSON.stringify(prev[k]) !== JSON.stringify(segment)) {
                        next[k] = segment;
                        changed = true;
                    }
                });
                return changed ? next : prev;
            });
        } else if (viewMode === 'archive' && archiveSessionId) {
            setSegmentsMap({});
            get(ref(database, `projects/${activeProjectId}/sessions/${archiveSessionId}/transcript`)).then(snap => {
                if (snap.exists()) {
                    setSegmentsMap(snap.val());
                } else {
                    setSegmentsMap({});
                }
            });
        }
    }, [streamData, viewMode, archiveSessionId, activeProjectId, activeSessionId]);

    useEffect(() => {
        setSegmentsOrder(Object.keys(segmentsMap).sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0])));
    }, [segmentsMap]);

    // 3. Time-based Force Final Logic
    const [now, setNow] = useState<number>(() => Date.now());
    useEffect(() => {
        if (viewMode === 'archive') return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [viewMode]);

    // --- Handlers ---
    const handleSelectSession = (sid: string) => {
        if (sid === activeSessionId) {
            setViewMode('live');
            setArchiveSessionId(null);
        } else {
            setViewMode('archive');
            setArchiveSessionId(sid);
        }
        setIsSidebarOpen(false);
    };

    // --- Theme ---
    const bgClass = isDarkMode ? "bg-[#0a0a0a] text-gray-200 selection:bg-blue-500/30" : "bg-white text-black selection:bg-blue-500/30";
    const headerClass = isDarkMode ? "bg-[#0a0a0a] border-white/5 shadow-sm" : "bg-gray-100 border-gray-200 shadow-sm";
    const textClass = isDarkMode ? "text-gray-100" : "text-gray-800";
    const subTextClass = isDarkMode ? "text-gray-500" : "text-gray-500";
    const tabActiveClass = isDarkMode ? "bg-white text-black" : "bg-white text-black shadow";
    const tabInactiveClass = isDarkMode ? "bg-[#111111] text-gray-400 border border-white/5 hover:bg-[#1a1a1a] hover:text-gray-300" : "text-gray-500 hover:text-black";
    const drawerClass = isDarkMode ? "bg-[#0a0a0a] text-gray-200" : "bg-white text-black";

    // ── Normal View ────────────────────────────────────────────
    return (
        <div className={`flex flex-col h-screen font-sans transition-colors duration-300 overflow-hidden ${bgClass}`}>

            {/* CSS Animations */}
            <style>{`
                @keyframes blink-cursor {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0; }
                }
                @keyframes shimmer {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes pulse-green {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.6; transform: scale(0.85); }
                }
                @keyframes fade-in-down {
                    from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
                    to { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
                @keyframes slide-up-in {
                    from { opacity: 0; transform: translateY(12px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .segment-enter {
                    animation: slide-up-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) both;
                }
            `}</style>

            {/* Sidebar Drawer */}
            <div className={`fixed inset-y-0 left-0 w-64 z-50 transform transition-transform duration-300 shadow-2xl border-r ${drawerClass} ${isDarkMode ? 'border-white/5' : 'border-gray-200'} ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className={`px-4 py-3.5 border-b flex justify-between items-center ${isDarkMode ? 'border-white/5' : 'border-gray-200'}`}>
                    <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">Sessions</span>
                    <button onClick={() => setIsSidebarOpen(false)} className="p-1 rounded text-gray-600 hover:text-gray-300 transition-colors">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                </div>
                <div className="overflow-y-auto h-full pb-20">
                    <div onClick={() => navigate('/')} className={`px-4 py-3 border-b cursor-pointer transition-colors flex items-center gap-2 ${isDarkMode ? 'border-white/5 hover:bg-white/5 text-gray-500 hover:text-gray-300' : 'border-gray-200 hover:bg-gray-100 text-gray-500 hover:text-gray-700'}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                        <span className="text-xs font-medium">Switch Hall</span>
                    </div>
                    {sessions.map(s => {
                        const isActive = activeSessionId === s.id;
                        const isSelected = (viewMode === 'live' && isActive) || (viewMode === 'archive' && archiveSessionId === s.id);
                        return (
                            <div key={s.id} onClick={() => handleSelectSession(s.id)}
                                className={`px-4 py-3.5 border-b cursor-pointer transition-colors ${isDarkMode ? 'border-white/5 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-100'} ${isSelected ? (isDarkMode ? 'bg-white/5' : 'bg-gray-100') : ''}`}>
                                <div className="flex items-center gap-2 mb-1">
                                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>}
                                    <span className="text-[10px] text-gray-500 font-mono">{s.startTime}</span>
                                </div>
                                <div className="text-sm font-medium truncate">{s.speaker}</div>
                                <div className="text-xs text-gray-500 truncate mt-0.5">{s.topic}</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Overlay */}
            {isSidebarOpen && <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setIsSidebarOpen(false)}></div>}

            {/* Top Info Bar */}
            <div className={`border-b p-4 flex flex-col md:flex-row items-center justify-between z-10 gap-4 ${headerClass}`}>
                <div className="flex items-center gap-4 w-full md:w-auto">
                    <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-white/10 rounded transition-colors text-gray-400 hover:text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                    </button>

                    {sessionInfo ? (
                        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                            <div className="flex items-center gap-2">
                                {viewMode === 'live' ? (
                                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 font-bold text-[10px] uppercase tracking-widest">
                                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
                                        Live
                                    </span>
                                ) : (
                                    <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-400 font-bold text-[10px] uppercase tracking-widest">
                                        Replay
                                    </span>
                                )}
                                <span className={`text-base font-semibold tracking-tight ${isDarkMode ? 'text-gray-100' : 'text-black'}`}>{sessionInfo.speaker}</span>
                                <span className={`text-xs font-medium ${subTextClass}`}>({sessionInfo.affiliation})</span>
                            </div>
                            <div className={`hidden md:block w-px h-4 ${isDarkMode ? 'bg-white/10' : 'bg-gray-300'}`}></div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Topic</span>
                                <span className={`text-sm font-medium ${textClass}`}>{sessionInfo.topic}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="text-gray-500 text-sm flex items-center gap-2">
                            {viewMode === 'live' ? (
                                <>
                                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse"></span>
                                    <span>대기 중</span>
                                </>
                            ) : "Select a session from menu"}
                        </div>
                    )}
                </div>

                {/* Right Controls */}
                <div className="flex items-center gap-3 flex-wrap justify-end">

                    <div className={`flex items-center gap-1 px-2 py-1 rounded-md border ${isDarkMode ? 'bg-[#111111] border-white/5' : 'bg-white border-gray-200 shadow-sm'}`}>
                        <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-1.5 hover:bg-white/5 rounded text-sm transition-colors text-gray-400 hover:text-white">
                            {isDarkMode ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>}
                        </button>
                        <div className={`w-px h-3 ${isDarkMode ? 'bg-white/10' : 'bg-gray-300'}`}></div>
                        <button onClick={() => setFontSize(Math.max(16, fontSize - 2))} className="p-1.5 hover:bg-white/5 rounded text-xs font-medium text-gray-400 hover:text-white transition-colors">A−</button>
                        <button onClick={() => setFontSize(Math.min(48, fontSize + 2))} className="p-1.5 hover:bg-white/5 rounded text-sm font-bold text-gray-400 hover:text-white transition-colors">A+</button>
                        <div className={`w-px h-3 ${isDarkMode ? 'bg-white/10' : 'bg-gray-300'}`}></div>
                        <button onClick={() => setLetterSpacing(v => Math.max(-1, parseFloat((v - 0.5).toFixed(1))))} className="p-1.5 hover:bg-white/5 rounded text-xs font-medium text-gray-400 hover:text-white transition-colors">↔−</button>
                        <button onClick={() => setLetterSpacing(v => Math.min(8, parseFloat((v + 0.5).toFixed(1))))} className="p-1.5 hover:bg-white/5 rounded text-xs font-medium text-gray-400 hover:text-white transition-colors">↔+</button>
                        <div className={`w-px h-3 ${isDarkMode ? 'bg-white/10' : 'bg-gray-300'}`}></div>
                        <button onClick={() => setLineHeight(v => Math.max(1.0, parseFloat((v - 0.1).toFixed(1))))} className="p-1.5 hover:bg-white/5 rounded text-xs font-medium text-gray-400 hover:text-white transition-colors">↕−</button>
                        <button onClick={() => setLineHeight(v => Math.min(4.0, parseFloat((v + 0.1).toFixed(1))))} className="p-1.5 hover:bg-white/5 rounded text-xs font-medium text-gray-400 hover:text-white transition-colors">↕+</button>
                    </div>

                    {/* TTS Controls */}
                    <div className="relative flex items-center gap-1">
                        <div className={`flex items-center gap-1 px-2 py-1 rounded-md border ${isDarkMode ? 'bg-[#111111] border-white/5' : 'bg-white border-gray-200 shadow-sm'}`}>
                            {/* TTS on/off toggle */}
                            <button
                                onClick={() => setIsTtsEnabled(v => !v)}
                                title={isTtsEnabled ? 'Voice ON — click to turn off' : 'Voice OFF — click to turn on'}
                                className={`px-2 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${isTtsEnabled ? 'bg-blue-500/10 text-blue-400' : (isDarkMode ? 'text-gray-400 hover:bg-white/5 hover:text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-black')}`}
                            >
                                {isTtsEnabled ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg> : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>}
                                {isTtsEnabled ? 'TTS On' : 'TTS Off'}
                            </button>
                            {/* 재생 중 상태 표시 + 정지 버튼 */}
                            {speakingId && (
                                <div className="flex items-center gap-1 ml-1">
                                    <span className={`text-[10px] uppercase tracking-wider font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                        {audioQueueRef.current.length > 0
                                            ? `+${audioQueueRef.current.length} q`
                                            : 'playing'}
                                    </span>
                                    <button
                                        onClick={stopAudio}
                                        title="Stop audio"
                                        className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-all"
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                                    </button>
                                </div>
                            )}
                            {/* Voice gender + speed — TTS 켜졌을 때만 표시 */}
                            {isTtsEnabled && (
                                <>
                                    <div className={`flex rounded overflow-hidden text-[10px] font-medium ml-1 ${isDarkMode ? 'bg-[#1a1a1a]' : 'bg-gray-100'}`}>
                                        <button
                                            onClick={() => setTtsGender('female')}
                                            title="Female voice"
                                            className={`px-2 py-1 transition-colors ${ttsGender === 'female'
                                                ? 'bg-white/10 text-white'
                                                : isDarkMode ? 'text-gray-500 hover:text-white' : 'text-gray-500 hover:text-black'}`}
                                        >
                                            F
                                        </button>
                                        <button
                                            onClick={() => setTtsGender('male')}
                                            title="Male voice"
                                            className={`px-2 py-1 transition-colors ${ttsGender === 'male'
                                                ? 'bg-white/10 text-white'
                                                : isDarkMode ? 'text-gray-500 hover:text-white' : 'text-gray-500 hover:text-black'}`}
                                        >
                                            M
                                        </button>
                                    </div>
                                    <select
                                        value={ttsSpeed}
                                        onChange={e => setTtsSpeed(Number(e.target.value))}
                                        className={`text-[10px] px-1 py-1 rounded ml-1 outline-none font-mono ${isDarkMode ? 'bg-[#1a1a1a] text-gray-300' : 'bg-gray-100 text-gray-700'}`}
                                        title="Playback speed"
                                    >
                                        <option value={0.75}>0.75x</option>
                                        <option value={0.9}>0.90x</option>
                                        <option value={1.0}>1.00x</option>
                                        <option value={1.2}>1.20x</option>
                                        <option value={1.5}>1.50x</option>
                                    </select>
                                </>
                            )}
                        </div>
                        {/* 시작 지점 선택 안내 툴팁 */}
                        {showTtsHint && (
                            <div
                                style={{
                                    position: 'absolute',
                                    top: 'calc(100% + 8px)',
                                    right: 0,
                                    whiteSpace: 'nowrap',
                                    background: isDarkMode ? '#111111' : '#ffffff',
                                    border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                                    borderRadius: '6px',
                                    padding: '6px 10px',
                                    fontSize: '10px',
                                    fontWeight: 500,
                                    color: isDarkMode ? '#9ca3af' : '#4b5563',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                                    animation: 'fade-in-down 0.25s ease both',
                                    zIndex: 100,
                                }}
                            >
                                Click any text segment to start reading
                            </div>
                        )}
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => setActiveLang('ko')}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium uppercase tracking-wider transition-colors ${activeLang === 'ko' ? tabActiveClass : tabInactiveClass}`}
                        >
                            KR
                        </button>
                        <button
                            onClick={() => setActiveLang('en')}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium uppercase tracking-wider transition-colors ${activeLang === 'en' ? tabActiveClass : tabInactiveClass}`}
                        >
                            EN
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Subtitles Area */}
            <div className="flex-1 overflow-y-auto p-6 md:p-12 scroll-smooth">
                <div className="max-w-5xl mx-auto space-y-6">

                    {/* 무한 스크롤(페이징) 트리거 요소 */}
                    {viewMode === 'live' && hasMore && (
                        <div ref={topObserverRef} className="w-full h-8 flex items-center justify-center text-gray-500 text-sm">
                            이전 메시지 불러오는 중...
                        </div>
                    )}

                    {/* Archive — No Transcript */}
                    {viewMode === 'archive' && segmentsOrder.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-64 text-gray-500 space-y-4">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                            <span className="text-sm font-medium">No transcript available for this session.</span>
                        </div>
                    )}

                    {viewMode === 'live' && !sessionInfo && (
                        <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center space-y-4 text-gray-500">
                            <div className="text-sm font-medium">AI 번역 시스템 대기 중</div>
                            <div className="text-xs">세션이 시작되면 자동으로 자막이 표시됩니다</div>
                        </div>
                    )}

                    {/* Live — Empty, session active but no segments yet */}
                    {viewMode === 'live' && sessionInfo && segmentsOrder.length === 0 && (
                        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
                            <div className={`flex items-center gap-3 px-6 py-4 rounded-xl border ${isDarkMode ? 'bg-white/3 border-white/5' : 'bg-gray-50 border-gray-200'}`}>
                                <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin flex-shrink-0"></div>
                                <div>
                                    <div className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                                        AI 번역 시스템 대기 중
                                    </div>
                                    <div className="text-xs text-gray-500 mt-0.5">
                                        음성이 감지되면 자동으로 번역이 시작됩니다
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Segments (Live or Archive) */}
                    <div className="leading-[1.8] text-justify whitespace-pre-wrap break-words" style={{ letterSpacing: `${letterSpacing}px`, lineHeight }}>
                        {(sessionInfo || viewMode === 'archive') && segmentsOrder.map((id) => {
                            const seg = segmentsMap[id]
                            if (!seg || seg.status === 'merged') return null
                            const isTranslating = seg.status === 'translating'
                            const sessionSourceLang = sessionInfo?.sourceLanguage || 'ko'

                            let text = ""
                            if (viewMode === 'live' && isTranslating && activeLang === sessionSourceLang) {
                                text = (seg.refined as string) || (seg.original as string) || ""
                            } else {
                                text = seg[activeLang] as string || ""
                            }

                            if (!text || text.trim() === "") return null

                            const isFinal = seg.status === 'final'
                            const isTimeOut = viewMode === 'live' ? ((now - (seg.timestamp || 0)) > 5000) : true
                            const showAsRaw = viewMode === 'live' ? (!isFinal && !isTimeOut) : false

                            if (activeLang === 'en' && /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(text)) return null

                            if (hideRaw && showAsRaw && activeLang !== sessionSourceLang) return null

                            return (
                                <TextItem
                                    key={id}
                                    id={id}
                                    text={text}
                                    isRaw={showAsRaw}
                                    targetLang={activeLang}
                                    fontSize={`${fontSize}px`}
                                    color={isDarkMode ? "white" : "black"}
                                    opacity={!showAsRaw && !isTranslating ? 1 : 0.7}
                                    isSpeaking={speakingId === id}
                                    onSpeak={isTtsEnabled ? (t, l) => handleSpeak(t, l, id) : undefined}
                                />
                            )
                        })}
                    </div>

                    <div ref={messagesEndRef} className="h-32"></div>
                </div>
            </div>

        </div >
    );
};

export default AudienceView;
