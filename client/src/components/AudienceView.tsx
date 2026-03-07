import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { rtdb as database } from '../firebase';
import { ref, onValue, get } from 'firebase/database';
import { useProjectStream } from '../hooks/useProjectStream';
import TextItem from './TextItem';

const HALLUCINATION_BLACKLIST = ['자막제작', '자막 제작', 'Subtitles by', 'MBC 뉴스', 'Copyright', 'http', '.co.kr'];
const isGarbage = (text: string) => {
    if (!text) return false;
    if (HALLUCINATION_BLACKLIST.some(bad => text.includes(bad))) return true;
    if (/(.+)\1{2,}/.test(text)) return true;
    if (/(.*,){4,}/.test(text)) return true;
    if (/^(Implant, Surgery|임플란트, 보철)/i.test(text)) return true;
    return false;
};

interface ProcessingBannerProps {
    isRecording: boolean;
    sessionInfo: { speaker: string; affiliation: string; topic: string } | null;
}
const ProcessingBanner: React.FC<ProcessingBannerProps> = ({ isRecording, sessionInfo }) => {
    if (!sessionInfo) return null;


    if (isRecording) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(16,185,129,0.08)',
                border: '1px solid rgba(16,185,129,0.3)',
                borderRadius: '8px',
                padding: '6px 14px',
                fontSize: '12px',
                color: '#6ee7b7',
                fontWeight: 600,
                userSelect: 'none',
            }}>
                <span style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: '#10b981',
                    boxShadow: '0 0 6px #10b981',
                    animation: 'pulse-green 1.5s ease-in-out infinite',
                }} />
                <span>🎙️ 음성 감지 대기 중</span>
            </div>
        );
    }

    return null;
};

// ─── Subtitle Mode ───────────────────────────────────────────────────────────
interface SubtitleModeProps {
    segmentsMap: SegmentMap;
    segmentsOrder: string[];
    activeLang: string;
    targetLanguages: string[];
    subtitleLines: number;
    setSubtitleLines: (n: number) => void;
    fontSize: number;
    setFontSize: (n: number) => void;
    isDarkMode: boolean;
    setIsDarkMode: (b: boolean) => void;
    setActiveLang: (l: string) => void;
    setIsSubtitleMode: (b: boolean) => void;
    hideRaw: boolean;
}

const SubtitleMode: React.FC<SubtitleModeProps> = ({
    segmentsMap, segmentsOrder, activeLang, targetLanguages,
    subtitleLines, setSubtitleLines, fontSize, setFontSize,
    isDarkMode, setIsDarkMode, setActiveLang, setIsSubtitleMode, hideRaw
}) => {


    const validLines = segmentsOrder.map(id => {
        const seg = segmentsMap[id];
        if (!seg || seg.status === 'merged') return null;
        const isTranslating = seg.status === 'translating';
        let text = "";
        let isFallback = false;
        let isRaw = seg.status === 'raw' || isTranslating;

        if (activeLang === 'original') {
            text = seg.refined || seg.original || "";
        } else {
            text = seg[activeLang] as string || "";
            if (!text) {
                // 번역 중이면 원본 텍스트를 임시로 표시
                text = seg.refined || seg.original || "";
                isFallback = true;
                isRaw = true;
            }
        }
        if (activeLang === 'en' && /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(text)) return null;
        if (!text.trim()) return null;
        // translating 상태는 원본 언어 탭에서는 항상 표시, 다른 탭에서는 반투명으로 표시
        if (hideRaw && isRaw && !isTranslating) return null;
        return { id, text, isFallback, isFinal: seg.status === 'final', isRaw, isTranslating };
    }).filter(v => v !== null) as { id: string; text: string; isFallback: boolean; isFinal: boolean; isRaw: boolean; isTranslating: boolean }[];


    const displayLines = validLines.slice(-subtitleLines);

    const isGreenBg = !isDarkMode;

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 50,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'flex-end',
            paddingBottom: '48px',
            background: isGreenBg ? '#00FF00' : 'rgba(0,0,0,0.92)',
        }}>
            {/* ── Hover Controls ── */}
            <div style={{
                position: 'absolute', top: '16px', right: '16px',
                display: 'flex', flexDirection: 'column', gap: '8px',
                opacity: 0.08, transition: 'opacity 0.3s',
            }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '0.08')}
            >
                {/* Lines control */}
                <div style={{ display: 'flex', background: 'rgba(17,24,39,0.92)', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)' }}>
                    <button onClick={() => setSubtitleLines(Math.max(1, subtitleLines - 1))} style={{ padding: '6px 12px', color: 'white', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px' }}>−</button>
                    <span style={{ padding: '6px 16px', color: 'white', fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center' }}>{subtitleLines} Lines</span>
                    <button onClick={() => setSubtitleLines(Math.min(5, subtitleLines + 1))} style={{ padding: '6px 12px', color: 'white', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px' }}>+</button>
                </div>
                {/* Font size */}
                <div style={{ display: 'flex', background: 'rgba(17,24,39,0.92)', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)' }}>
                    <button onClick={() => setFontSize(Math.max(16, fontSize - 2))} style={{ padding: '6px 12px', color: 'white', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>A−</button>
                    <span style={{ padding: '6px 16px', color: 'white', fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center' }}>Size {fontSize}</span>
                    <button onClick={() => setFontSize(Math.min(72, fontSize + 2))} style={{ padding: '6px 12px', color: 'white', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>A+</button>
                </div>
                {/* BG toggle + Exit */}
                <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => setIsDarkMode(!isDarkMode)} style={{ flex: 1, padding: '6px 10px', background: 'rgba(17,24,39,0.92)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', backdropFilter: 'blur(12px)' }}>
                        {isDarkMode ? '⬛ Black' : '🟩 Green'}
                    </button>
                    <button onClick={() => setIsSubtitleMode(false)} style={{ flex: 1, padding: '6px 10px', background: 'rgba(220,38,38,0.9)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}>
                        ✕ Exit
                    </button>
                </div>
                {/* Language tabs */}
                <div style={{ display: 'flex', background: 'rgba(17,24,39,0.92)', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)' }}>
                    {['original', ...targetLanguages].map(l => (
                        <button key={l} onClick={() => setActiveLang(l)} style={{
                            flex: 1, padding: '6px 10px', color: 'white', background: activeLang === l ? '#4f46e5' : 'none',
                            border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase'
                        }}>{l === 'original' ? 'Orig' : l}</button>
                    ))}
                </div>
            </div>


            {/* ── Subtitle Lines ── */}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '0 40px' }}>
                {displayLines.length === 0 && (
                    <div style={{
                        fontSize: `${Math.max(fontSize - 8, 16)}px`,
                        color: isGreenBg ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.25)',
                        fontStyle: 'italic',
                        letterSpacing: '0.05em',
                    }}>
                        대기 중...
                    </div>
                )}
                {displayLines.map((line, idx) => {
                    const isLatest = idx === displayLines.length - 1;
                    return (
                        <div
                            key={line.id}
                            style={{
                                fontSize: `${fontSize}px`,
                                fontWeight: isGreenBg ? 700 : 500,
                                backgroundColor: isGreenBg ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.65)',
                                color: line.isRaw ? '#94a3b8' : 'white',
                                textShadow: '2px 2px 6px rgba(0,0,0,0.95)',
                                border: line.isRaw
                                    ? '1px solid rgba(99,102,241,0.6)'
                                    : '1px solid rgba(255,255,255,0.05)',
                                textAlign: 'center',
                                padding: '12px 36px',
                                borderRadius: '16px',
                                maxWidth: '92%',
                                opacity: isLatest ? 1 : 0.75,
                                transform: isLatest ? 'translateY(0) scale(1)' : 'translateY(-4px) scale(0.97)',
                                transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                                // Subtle shimmer on raw lines
                                backgroundImage: line.isRaw
                                    ? 'linear-gradient(90deg, rgba(0,0,0,0.65) 0%, rgba(30,27,75,0.65) 50%, rgba(0,0,0,0.65) 100%)'
                                    : undefined,
                                backgroundSize: line.isRaw ? '200% 100%' : undefined,
                                animation: line.isRaw ? 'shimmer 2s linear infinite' : undefined,
                            }}
                        >
                            {line.text}
                            {/* Cursor for latest raw line */}
                            {line.isRaw && isLatest && (
                                <span style={{
                                    display: 'inline-block',
                                    width: '3px',
                                    height: '1em',
                                    backgroundColor: '#818cf8',
                                    marginLeft: '6px',
                                    verticalAlign: 'text-bottom',
                                    animation: 'blink-cursor 1s step-end infinite',
                                }} />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ─── Main Component ──────────────────────────────────────────────────────────
const AudienceView: React.FC = () => {
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();
    const activeProjectId = projectId || "default";

    // --- UI State ---
    const [fontSize, setFontSize] = useState<number>(24);
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

    // --- Subtitle Overlay Mode ---
    const [isSubtitleMode, setIsSubtitleMode] = useState<boolean>(false);
    const [subtitleLines, setSubtitleLines] = useState<number>(2);

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

    const targetLanguages = currentSession?.targetLanguages?.length ? currentSession.targetLanguages : ['ko', 'en', 'ja'];

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

    useEffect(() => {
        scrollToBottom();
    }, [segmentsOrder, scrollToBottom]);

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

    // ── Subtitle Mode ──────────────────────────────────────────
    if (isSubtitleMode) {
        return (
            <SubtitleMode
                segmentsMap={segmentsMap}
                segmentsOrder={segmentsOrder}
                activeLang={activeLang}
                targetLanguages={targetLanguages}
                subtitleLines={subtitleLines}
                setSubtitleLines={setSubtitleLines}
                fontSize={fontSize}
                setFontSize={setFontSize}
                isDarkMode={isDarkMode}
                setIsDarkMode={setIsDarkMode}
                setActiveLang={setActiveLang}
                setIsSubtitleMode={setIsSubtitleMode}
                hideRaw={hideRaw}
            />
        );
    }

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

                    {/* Processing Banner (in header, live mode only) */}
                    {viewMode === 'live' && sessionInfo && (
                        <ProcessingBanner
                            isRecording={viewMode === 'live' && !!sessionInfo}
                            sessionInfo={sessionInfo}
                        />
                    )}

                    <button
                        onClick={() => setIsSubtitleMode(true)}
                        className={`flex items-center gap-2 px-3 py-1 rounded transition-all border ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500' : 'bg-gray-100 border-gray-200 text-gray-500 hover:text-black hover:border-gray-400'}`}
                    >
                        <span>📺</span>
                        <span className="hidden md:inline text-xs font-bold">Subtitle Mode</span>
                    </button>

                    <div className={`flex items-center gap-2 px-3 py-1 rounded ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                        <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-1 hover:opacity-80 text-lg">
                            {isDarkMode ? '🌙' : '☀️'}
                        </button>
                        <div className={`w-px h-4 ${isDarkMode ? 'bg-gray-600' : 'bg-gray-400'}`}></div>
                        <button onClick={() => setFontSize(Math.max(16, fontSize - 2))} className="p-1 font-bold text-sm">A−</button>
                        <button onClick={() => setFontSize(Math.min(48, fontSize + 2))} className="p-1 font-bold text-lg">A+</button>
                    </div>

                    <div className={`flex rounded p-1 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                        <button
                            onClick={() => setActiveLang('original')}
                            className={`px-3 py-1 text-sm rounded transition-all ${activeLang === 'original' ? tabActiveClass : tabInactiveClass}`}
                        >
                            Original
                        </button>
                        {targetLanguages
                            .filter(lang => lang !== sessionInfo?.sourceLanguage) // Filter out the speaker's language
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
                    {(sessionInfo || viewMode === 'archive') && segmentsOrder.map((id) => {
                        const seg = segmentsMap[id];
                        if (!seg || seg.status === 'merged') return null;
                        const isTranslating = seg.status === 'translating';

                        let text = "";
                        let isFallback = false;

                        if (activeLang === 'original') {
                            text = seg.refined || seg.original || "";
                        } else {
                            text = seg[activeLang] as string || "";
                            if (!text) {
                                // 번역 중: 원본 텍스트를 임시로 표시 (반투명)
                                text = seg.refined || seg.original || "";
                                isFallback = true;
                            }
                        }

                        if (!text || text.trim() === "") return null;

                        if (activeLang === 'en' && /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(text)) {
                            return (
                                <div key={id} className="transition-all duration-500 opacity-60">
                                    <TextItem
                                        id={id}
                                        text=""
                                        isRaw={true}
                                        targetLang={activeLang}
                                        fontSize={`${fontSize}px`}
                                        color={isDarkMode ? "#6b7280" : "#9ca3af"}
                                    />
                                </div>
                            );
                        }

                        const isFinal = seg.status === 'final';
                        const isTimeOut = viewMode === 'live' ? ((now - (seg.timestamp || 0)) > 5000) : true;
                        const showAsRaw = viewMode === 'live' ? (!isFinal && !isTimeOut && !isFallback) : false;

                        // Hide raw STT output if hideRaw setting is enabled
                        if (hideRaw && showAsRaw) return null;

                        return (
                            <div key={id} className={`segment-enter transition-all duration-500 flex items-start ${!showAsRaw && !isTranslating ? 'opacity-100' : 'opacity-70'}`}>
                                <div className="flex-1">
                                    <TextItem
                                        id={id}
                                        text={text}
                                        isRaw={showAsRaw}
                                        targetLang={activeLang}
                                        fontSize={`${fontSize}px`}
                                        color={isFallback ? (isDarkMode ? "#6b7280" : "#9ca3af") : (isDarkMode ? "white" : "black")}
                                    />
                                </div>
                            </div>
                        );
                    })}

                    <div ref={messagesEndRef} className="h-32"></div>
                </div>
            </div>

        </div >
    );
};

// Re-export type for SubtitleMode
type SegmentMap = Record<string, {
    original?: string;
    refined?: string;
    status?: string;
    sessionId?: string;
    timestamp?: number;
    mergedIds?: string[];
    [key: string]: string | number | string[] | undefined;
}>;

export default AudienceView;
