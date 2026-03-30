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
    if (/^\s*[\(\[][^\)\]]{1,40}[\)\]]\s*$/.test(text.trim())) return true;
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
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioQueueRef = useRef<{ text: string; lang: string; id: string }[]>([]);
    const spokenIdsRef = useRef<Set<string>>(new Set());
    const isSpeakingRef = useRef<boolean>(false);

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

    const targetLanguages = (currentSession?.targetLanguages?.length ? currentSession.targetLanguages : ['ko', 'en'])
        .filter(l => l !== 'ja');

    // --- Display Info ---
    // 기본 언어: 세션의 첫 번째 타겟 언어 (원본 언어 제외)
    // 세션 로드 전까지는 'en'을 기본으로 사용
    const [activeLang, setActiveLang] = useState<string>('en');
    const [hideRaw, setHideRaw] = useState<boolean>(true); // Default: hide Whisper raw text

    // 세션 정보가 로드되면 기본 언어 자동 전환 (원본 언어가 아닌 첫 번째 타겟 언어)
    useEffect(() => {
        if (currentSession) {
            const sourceLang = currentSession.sourceLanguage || 'ko';
            const targets = currentSession.targetLanguages?.filter(l => l !== sourceLang) || [];
            const firstTarget = targets[0] || (sourceLang === 'ko' ? 'en' : 'ko');
            setActiveLang(firstTarget);
        }
    }, [currentSession?.id]);

    // --- Stream State ---
    const { streamData } = useProjectStream(activeProjectId, { subscribe: viewMode === 'live' });
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
        const url = `${CF_BASE}/synthesizeSpeech?text=${encodeURIComponent(next.text)}&lang=${next.lang}&speed=${ttsSpeed}`;
        const audio = new Audio(url);
        audioRef.current = audio;
        setSpeakingId(next.id);
        audio.onended = () => playNext();
        audio.onerror = () => playNext();
        audio.play().catch(() => playNext());
    }, [ttsSpeed]);

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
            const t = (seg[lang] as string) || (seg.refined as string) || '';
            if (t.trim()) queue.push({ text: t, lang, id: sid });
        }

        if (queue.length === 0) return;

        isSpeakingRef.current = true;
        audioQueueRef.current = queue;
        playNext();
    }, [stopAudio, playNext, segmentsOrder, segmentsMap]);

    useEffect(() => {
        scrollToBottom();
    }, [segmentsOrder, scrollToBottom]);

    // Auto-play + 연속재생 중 신규 세그먼트 자동 추가
    // isTtsEnabled: 자동재생 켜져 있을 때 새 final 세그먼트 자동 큐잉
    // isSpeakingRef: 클릭 연속재생 중에도 새 세그먼트를 큐 끝에 추가
    useEffect(() => {
        const lastId = segmentsOrder[segmentsOrder.length - 1];
        if (!lastId) return;
        const seg = segmentsMap[lastId];
        if (seg?.status !== 'final') return;
        if (spokenIdsRef.current.has(lastId)) return;

        const text = (seg[activeLang] as string) || (seg.refined as string) || '';
        if (!text.trim()) return;

        // 자동재생 켜져 있거나, 클릭 연속재생 진행 중일 때 새 세그먼트 큐에 추가
        if (isTtsEnabled || isSpeakingRef.current) {
            spokenIdsRef.current.add(lastId);
            enqueueSpeak(text, activeLang, lastId);
        }
    }, [segmentsOrder, segmentsMap, isTtsEnabled, activeLang, enqueueSpeak]);

    // TTS 비활성화 시 재생 중단
    useEffect(() => {
        if (!isTtsEnabled) stopAudio();
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
        onValue(sessionsRef, (snap) => {
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
        onValue(activeRef, (snap) => {
            const sid = snap.val();
            setActiveSessionId(sid);
        });
        // Cleanup: onValue listeners should be unsubscribed
        // Note: we return nothing here because onValue returns unsubscribe fn
        // but we're calling it inline. This is acceptable for this use case.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeProjectId]);

    // 2. Data Handling
    useEffect(() => {
        if (viewMode === 'live') {
            if (!streamData) {
                return;
            }
            Promise.resolve().then(() => {
                setSegmentsMap(prev => {
                    const next = { ...prev };
                    let changed = false;
                    Object.keys(next).forEach(key => {
                        if (!activeSessionId || next[key].sessionId !== activeSessionId) {
                            delete next[key];
                            changed = true;
                        }
                    });
                    Object.entries(streamData).forEach(([k, v]: [string, unknown]) => {
                        const segment = v as SegmentMap[string];
                        if (!activeSessionId || segment.sessionId !== activeSessionId) return;
                        if (isGarbage(segment.original || "")) {
                            if (next[k]) { delete next[k]; changed = true; }
                            return;
                        }
                        if (segment.mergedIds && Array.isArray(segment.mergedIds)) {
                            segment.mergedIds.forEach((pid: string) => {
                                if (next[pid]) { delete next[pid]; changed = true; }
                            });
                        }
                        if (JSON.stringify(prev[k]) !== JSON.stringify(segment)) {
                            next[k] = segment;
                            changed = true;
                        }
                    });
                    return changed ? next : prev;
                });
            });
        } else if (viewMode === 'archive' && archiveSessionId) {
            Promise.resolve().then(() => setSegmentsMap({}));
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
        const sorted = Object.keys(segmentsMap).sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0]));
        Promise.resolve().then(() => setSegmentsOrder(sorted));
    }, [segmentsMap]);

    // 3. Time-based Force Final Logic
    const [now, setNow] = useState<number>(() => Date.now());
    useEffect(() => {
        if (viewMode === 'archive') return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [viewMode]);

    // 4. Next Session Logic
    const [nextSession, setNextSession] = useState<SessionItem | null>(null);
    useEffect(() => {
        if (sessions.length === 0) {
            Promise.resolve().then(() => setNextSession(null));
            return;
        }
        const currentTime = new Date().toTimeString().slice(0, 5);
        const upcoming = sessions.find(s => s.startTime > currentTime);
        Promise.resolve().then(() => setNextSession(upcoming || sessions[sessions.length - 1]));
    }, [sessions, now]);


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
    const bgClass = isDarkMode ? "bg-black text-white" : "bg-white text-black";
    const headerClass = isDarkMode ? "bg-gray-900 border-gray-800" : "bg-gray-100 border-gray-200";
    const textClass = isDarkMode ? "text-gray-200" : "text-gray-800";
    const subTextClass = isDarkMode ? "text-gray-400" : "text-gray-500";
    const tabActiveClass = isDarkMode ? "bg-gray-700 text-white" : "bg-white text-black shadow";
    const tabInactiveClass = isDarkMode ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-black";
    const drawerClass = isDarkMode ? "bg-gray-900 text-white" : "bg-white text-black";

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
            <div className={`fixed inset-y-0 left-0 w-64 z-50 transform transition-transform duration-300 shadow-2xl border-r ${drawerClass} ${isDarkMode ? 'border-gray-800' : 'border-gray-200'} ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="font-bold text-lg">Sessions</h2>
                    <button onClick={() => setIsSidebarOpen(false)} className="text-gray-500 hover:text-white">✕</button>
                </div>
                <div className="overflow-y-auto h-full pb-20">
                    <div onClick={() => navigate('/')} className={`p-4 border-b cursor-pointer transition-colors ${isDarkMode ? 'border-gray-800 hover:bg-gray-800' : 'border-gray-200 hover:bg-gray-100'}`}>
                        <div className="font-bold text-sm text-blue-500">⬅ Switch Hall</div>
                    </div>
                    {sessions.map(s => {
                        const isActive = activeSessionId === s.id;
                        const isSelected = (viewMode === 'live' && isActive) || (viewMode === 'archive' && archiveSessionId === s.id);
                        return (
                            <div key={s.id} onClick={() => handleSelectSession(s.id)}
                                className={`p-4 border-b cursor-pointer transition-colors ${isDarkMode ? 'border-gray-800 hover:bg-gray-800' : 'border-gray-200 hover:bg-gray-100'} ${isSelected ? (isDarkMode ? 'bg-gray-800' : 'bg-gray-200') : ''}`}>
                                <div className="flex items-center gap-2 mb-1">
                                    {isActive && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>}
                                    <span className="text-xs text-gray-500">{s.startTime}</span>
                                </div>
                                <div className="font-bold text-sm truncate">{s.speaker}</div>
                                <div className="text-xs text-gray-500 truncate">{s.topic}</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Overlay */}
            {isSidebarOpen && <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setIsSidebarOpen(false)}></div>}

            {/* Top Info Bar */}
            <div className={`border-b p-4 shadow-md flex flex-col md:flex-row items-center justify-between z-10 gap-4 ${headerClass}`}>
                <div className="flex items-center gap-4 w-full md:w-auto">
                    <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-gray-700 rounded transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                    </button>

                    {sessionInfo ? (
                        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                            <div className="flex items-center gap-2">
                                {viewMode === 'live' ? (
                                    <span className="text-red-500 font-bold text-xs uppercase tracking-wider animate-pulse">Live</span>
                                ) : (
                                    <span className="text-gray-500 font-bold text-xs uppercase tracking-wider">Replay</span>
                                )}
                                <span className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-black'}`}>{sessionInfo.speaker}</span>
                                <span className={`text-sm ${subTextClass}`}>({sessionInfo.affiliation})</span>
                            </div>
                            <div className={`hidden md:block w-px h-8 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-300'}`}></div>
                            <div className="flex items-center gap-2">
                                <span className="text-blue-500 font-bold text-xs uppercase tracking-wider">Topic</span>
                                <span className={`text-lg ${textClass}`}>{sessionInfo.topic}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="text-gray-500 italic flex items-center gap-2">
                            {viewMode === 'live' ? (
                                <>
                                    <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>
                                    <span>Standby for Next Session</span>
                                </>
                            ) : "Select a session from menu"}
                        </div>
                    )}
                </div>

                {/* Right Controls */}
                <div className="flex items-center gap-3 flex-wrap justify-end">

                    <div className={`flex items-center gap-2 px-3 py-1 rounded ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                        <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-1 hover:opacity-80 text-lg">
                            {isDarkMode ? '🌙' : '☀️'}
                        </button>
                        <div className={`w-px h-4 ${isDarkMode ? 'bg-gray-600' : 'bg-gray-400'}`}></div>
                        <button onClick={() => setFontSize(Math.max(16, fontSize - 2))} className="p-1 font-bold text-sm">A−</button>
                        <button onClick={() => setFontSize(Math.min(48, fontSize + 2))} className="p-1 font-bold text-lg">A+</button>
                        <div className={`w-px h-4 ${isDarkMode ? 'bg-gray-600' : 'bg-gray-400'}`}></div>
                        <button onClick={() => setLetterSpacing(v => Math.max(-1, parseFloat((v - 0.5).toFixed(1))))} className="p-1 font-bold text-sm">자−</button>
                        <button onClick={() => setLetterSpacing(v => Math.min(8, parseFloat((v + 0.5).toFixed(1))))} className="p-1 font-bold text-sm">자+</button>
                        <div className={`w-px h-4 ${isDarkMode ? 'bg-gray-600' : 'bg-gray-400'}`}></div>
                        <button onClick={() => setLineHeight(v => Math.max(1.0, parseFloat((v - 0.1).toFixed(1))))} className="p-1 font-bold text-sm">행−</button>
                        <button onClick={() => setLineHeight(v => Math.min(4.0, parseFloat((v + 0.1).toFixed(1))))} className="p-1 font-bold text-sm">행+</button>
                    </div>

                    {/* TTS Controls */}
                    <div className={`flex items-center gap-1 px-2 py-1 rounded ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                        {/* Auto-play toggle */}
                        <button
                            onClick={() => setIsTtsEnabled(v => !v)}
                            title={isTtsEnabled ? 'Auto-play ON — click to turn off' : 'Auto-play OFF — click to turn on'}
                            className={`px-2 py-1 rounded text-sm font-bold transition-all ${isTtsEnabled ? 'bg-blue-600 text-white' : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-black')}`}
                        >
                            {isTtsEnabled ? '🔊' : '🔇'}
                        </button>
                        {/* 재생 중 상태 표시 + 정지 버튼 */}
                        {speakingId && (
                            <div className="flex items-center gap-1">
                                <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    {audioQueueRef.current.length > 0
                                        ? `+${audioQueueRef.current.length} 대기`
                                        : '재생 중'}
                                </span>
                                <button
                                    onClick={stopAudio}
                                    title="Stop audio"
                                    className="px-2 py-1 rounded text-sm text-red-400 hover:text-red-300 transition-all"
                                >
                                    ⏹
                                </button>
                            </div>
                        )}
                        {/* Speed selector */}
                        {isTtsEnabled && (
                            <select
                                value={ttsSpeed}
                                onChange={e => setTtsSpeed(Number(e.target.value))}
                                className={`text-xs px-1 py-0.5 rounded ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-300 text-gray-700'}`}
                                title="Playback speed"
                            >
                                <option value={0.75}>0.75×</option>
                                <option value={0.9}>0.9×</option>
                                <option value={1.0}>1.0×</option>
                                <option value={1.2}>1.2×</option>
                                <option value={1.5}>1.5×</option>
                            </select>
                        )}
                    </div>

                    <div className={`flex rounded p-1 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                        <button
                            onClick={() => setActiveLang('original')}
                            className={`px-3 py-1 text-sm rounded transition-all ${activeLang === 'original' ? tabActiveClass : tabInactiveClass}`}
                        >
                            Original
                        </button>
                        {targetLanguages
                            .filter(lang => lang !== sessionInfo?.sourceLanguage)
                            .map(lang => (
                                <button
                                    key={lang}
                                    onClick={() => setActiveLang(lang)}
                                    className={`px-3 py-1 text-sm rounded transition-all uppercase ${activeLang === lang ? tabActiveClass : tabInactiveClass}`}
                                >
                                    {lang}
                                </button>
                            ))}
                    </div>
                </div>
            </div>

            {/* Main Subtitles Area */}
            <div className="flex-1 overflow-y-auto p-6 md:p-12 scroll-smooth">
                <div className="max-w-5xl mx-auto space-y-6">

                    {/* Archive — No Transcript */}
                    {viewMode === 'archive' && segmentsOrder.length === 0 && (
                        <div className="text-center text-gray-500 italic mt-20">
                            No transcript available for this session.
                        </div>
                    )}

                    {/* Live — Standby / Next Session */}
                    {viewMode === 'live' && !sessionInfo && nextSession && (
                        <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center space-y-8">
                            <div className="text-2xl text-blue-500 font-bold uppercase tracking-widest border-b-2 border-blue-500 pb-2">
                                Upcoming Session
                            </div>
                            <div className={`text-6xl font-black ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                {nextSession.startTime}
                            </div>
                            <div className="space-y-4">
                                <h1 className={`text-5xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                    {nextSession.speaker}
                                </h1>
                                <p className={`text-2xl ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {nextSession.affiliation}
                                </p>
                            </div>
                            <div className={`text-3xl font-medium max-w-4xl leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                {nextSession.topic}
                            </div>
                        </div>
                    )}

                    {/* Live — Empty, session active but no segments yet */}
                    {viewMode === 'live' && sessionInfo && segmentsOrder.length === 0 && (
                        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-6">
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                background: isDarkMode ? 'rgba(79,70,229,0.1)' : 'rgba(79,70,229,0.05)',
                                border: '1px solid rgba(99,102,241,0.3)',
                                borderRadius: '16px',
                                padding: '20px 36px',
                            }}>
                                <span style={{ fontSize: '32px', animation: 'spin 3s linear infinite', display: 'inline-block' }}>⚙️</span>
                                <div style={{ textAlign: 'left' }}>
                                    <div style={{ color: '#a5b4fc', fontWeight: 700, fontSize: '16px', marginBottom: '4px' }}>
                                        🔬 치과 전문 AI 번역 시스템 준비 중...
                                    </div>
                                    <div style={{ color: isDarkMode ? '#6b7280' : '#9ca3af', fontSize: '13px' }}>
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

                            let text = ""
                            let isFallback = false

                            if (activeLang === 'original') {
                                text = seg.refined || seg.original || ""
                            } else {
                                text = seg[activeLang] as string || ""
                                if (!text) {
                                    text = seg.refined || seg.original || ""
                                    isFallback = true
                                }
                            }

                            if (!text || text.trim() === "") return null

                            if (activeLang === 'en' && /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(text)) {
                                return (
                                    <TextItem
                                        key={id}
                                        id={id}
                                        text=""
                                        isRaw={true}
                                        targetLang={activeLang}
                                        fontSize={`${fontSize}px`}
                                        color={isDarkMode ? "#6b7280" : "#9ca3af"}
                                        opacity={0.6}
                                    />
                                )
                            }

                            const isFinal = seg.status === 'final'
                            const isTimeOut = viewMode === 'live' ? ((now - (seg.timestamp || 0)) > 5000) : true
                            const showAsRaw = viewMode === 'live' ? (!isFinal && !isTimeOut && !isFallback) : false

                            if (hideRaw && showAsRaw) return null

                            return (
                                <TextItem
                                    key={id}
                                    id={id}
                                    text={text}
                                    isRaw={showAsRaw}
                                    targetLang={activeLang}
                                    fontSize={`${fontSize}px`}
                                    color={isFallback ? (isDarkMode ? "#6b7280" : "#9ca3af") : (isDarkMode ? "white" : "black")}
                                    opacity={!showAsRaw && !isTranslating ? 1 : 0.7}
                                    isSpeaking={speakingId === id}
                                    onSpeak={(t, l) => handleSpeak(t, l, id)}
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
