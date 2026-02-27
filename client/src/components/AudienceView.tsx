import React, { useEffect, useState } from 'react';
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

const AudienceView: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const activeProjectId = projectId || "default";

  // --- UI State ---
  const [fontSize, setFontSize] = useState<number>(24);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  
  // --- Session & Mode State ---
  const [sessions, setSessions] = useState<any[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'live' | 'archive'>('live');
  const [archiveSessionId, setArchiveSessionId] = useState<string | null>(null);

  // --- Display Info ---
  const [sessionInfo, setSessionInfo] = useState<{ speaker: string, affiliation: string, topic: string } | null>(null);
  const [targetLanguages, setTargetLanguages] = useState<string[]>([]);
  const [activeLang, setActiveLang] = useState<string>('original');

  // --- Stream State ---
  const { streamData } = useProjectStream(activeProjectId, { subscribe: viewMode === 'live' });
  const [segmentsMap, setSegmentsMap] = useState<Record<string, any>>({});
  const [segmentsOrder, setSegmentsOrder] = useState<string[]>([]);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // --- Audio State ---
  const [isAudioMode, setIsAudioMode] = useState<boolean>(false);
  const [currentPlayingId, setCurrentPlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
      const audio = new Audio();
      audio.onended = handleAudioEnded;
      audioRef.current = audio;
      return () => {
          audio.pause();
          audioRef.current = null;
      };
  }, []);

  useEffect(() => {
      if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
      if (!currentPlayingId || !segmentsMap[currentPlayingId]) return;
      
      const item = segmentsMap[currentPlayingId];
      if (item.audioUrl) {
          if (audioRef.current) {
              audioRef.current.src = item.audioUrl;
              audioRef.current.play()
                  .then(() => setIsPlaying(true))
                  .catch(e => console.error("Play error", e));
          }
      } else {
          // Gapless: Skip if no audio
          handleAudioEnded();
      }
  }, [currentPlayingId]);

  const handleAudioEnded = () => {
      if (!currentPlayingId) return;
      const currentIndex = segmentsOrder.indexOf(currentPlayingId);
      if (currentIndex === -1) {
          setIsPlaying(false);
          return;
      }
      
      let nextIndex = currentIndex + 1;
      while(nextIndex < segmentsOrder.length) {
          const nextId = segmentsOrder[nextIndex];
          const nextItem = segmentsMap[nextId];
          if (nextItem && nextItem.seq) { // Play next valid sequence
              setCurrentPlayingId(nextId);
              return;
          }
          nextIndex++;
      }
      setIsPlaying(false);
  };

  const togglePlay = () => {
      if (!audioRef.current) return;
      if (isPlaying) {
          audioRef.current.pause();
          setIsPlaying(false);
      } else {
          audioRef.current.play();
          setIsPlaying(true);
      }
  };

  const handleSpeedChange = () => {
      const rates = [1.0, 1.2, 1.5, 2.0];
      const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
      setPlaybackRate(next);
  };

  const scrollToBottom = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
      scrollToBottom();
  }, [segmentsOrder]);

  // 1. Initial Load: Settings, Sessions, Active ID
  useEffect(() => {
    // Settings
    get(ref(database, `projects/${activeProjectId}/settings`)).then(snap => {
        if (snap.exists()) {
            const settings = snap.val();
            if (settings.targetLanguages) setTargetLanguages(settings.targetLanguages);
        }
    });

    // Sessions List
    const sessionsRef = ref(database, `projects/${activeProjectId}/sessions`);
    onValue(sessionsRef, (snap) => {
        const data = snap.val();
        if (data) {
            const list = Object.entries(data).map(([k, v]: [string, any]) => ({ id: k, ...v }));
            setSessions(list.sort((a, b) => a.startTime.localeCompare(b.startTime)));
        } else {
            setSessions([]);
        }
    });

    // Active Session ID
    const activeRef = ref(database, `projects/${activeProjectId}/activeSessionId`);
    onValue(activeRef, (snap) => {
        const sid = snap.val();
        setActiveSessionId(sid);
        if (sid && viewMode === 'live') {
            // Auto-load info for live session
            fetchSessionInfo(sid);
        } else if (!sid && viewMode === 'live') {
            setSessionInfo(null);
        }
    });
  }, [activeProjectId, viewMode]);

  const fetchSessionInfo = async (sid: string) => {
      const sSnap = await get(ref(database, `projects/${activeProjectId}/sessions/${sid}`));
      if (sSnap.exists()) {
          const s = sSnap.val();
          setSessionInfo({ speaker: s.speaker, affiliation: s.affiliation, topic: s.topic });
      }
  };

  // 2. Data Handling (Live vs Archive)
  useEffect(() => {
      if (viewMode === 'live') {
          // Live Mode: Use streamData from hook
          if (!streamData) {
              setSegmentsMap({});
              return;
          }
          setSegmentsMap(prev => {
            const next = { ...prev };
            let changed = false;

            // Cleanup: Remove items that don't match current session
            Object.keys(next).forEach(key => {
                if (!activeSessionId || next[key].sessionId !== activeSessionId) {
                    delete next[key];
                    changed = true;
                }
            });

            Object.entries(streamData).forEach(([k, v]: [string, any]) => {
                if (!v) return;

                // Session Guard: Strictly block data from other sessions (or no session)
                if (!activeSessionId || v.sessionId !== activeSessionId) return;

                // Garbage Filter
                if (isGarbage(v.original || "")) {
                    if (next[k]) { delete next[k]; changed = true; }
                    return;
                }

                if (v.mergedIds && Array.isArray(v.mergedIds)) {
                    v.mergedIds.forEach((pid: string) => {
                        if (next[pid]) { delete next[pid]; changed = true; }
                    });
                }
                if (JSON.stringify(prev[k]) !== JSON.stringify(v)) {
                    next[k] = v;
                    changed = true;
                }
            });
            return changed ? next : prev;
          });
      } else if (viewMode === 'archive' && archiveSessionId) {
          // Archive Mode: Fetch once from transcript
          setSegmentsMap({}); // Clear first
          fetchSessionInfo(archiveSessionId);
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
      // Clear map when session changes (safety)
      if (viewMode === 'live') {
          setSegmentsMap({});
      }
  }, [activeSessionId, viewMode]);

  useEffect(() => {
      const sorted = Object.keys(segmentsMap).sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0]));
      setSegmentsOrder(sorted);
  }, [segmentsMap]);

  // 3. Time-based Force Final Logic (Only for Live)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
      if (viewMode === 'archive') return;
      const timer = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(timer);
  }, [viewMode]);

  // 4. Next Session Logic
  const [nextSession, setNextSession] = useState<any>(null);
  useEffect(() => {
      if (sessions.length === 0) {
          setNextSession(null);
          return;
      }
      // Find the first session that hasn't started yet (or simply the next one in the list)
      // Assuming HH:mm format for startTime
      const currentTime = new Date().toTimeString().slice(0, 5);
      const upcoming = sessions.find(s => s.startTime > currentTime);
      // If no upcoming session found (end of day), maybe show the last one or nothing?
      // Or if all are in past, maybe just show the first one of the day if it's a new day? 
      // Let's default to the first upcoming, or the first one if everything is "future" relative to 00:00 (which is covered by find).
      // If nothing found (all past), fallback to the last one or null? 
      // User said "Make it so we can set it in order". 
      // Let's just pick the immediate next one.
      setNextSession(upcoming || sessions[sessions.length - 1]);
  }, [sessions, now]); // Update every second (now) to switch automatically? 'now' updates every sec.

  // --- Handlers ---
  const handleSelectSession = (sid: string) => {
      if (sid === activeSessionId) {
          setViewMode('live');
          setArchiveSessionId(null);
          // fetchSessionInfo(sid); // Handled by effect
      } else {
          setViewMode('archive');
          setArchiveSessionId(sid);
      }
      setIsSidebarOpen(false);
  };

  // --- Theme Classes ---
  const bgClass = isDarkMode ? "bg-black text-white" : "bg-white text-black";
  const headerClass = isDarkMode ? "bg-gray-900 border-gray-800" : "bg-gray-100 border-gray-200";
  const textClass = isDarkMode ? "text-gray-200" : "text-gray-800";
  const subTextClass = isDarkMode ? "text-gray-400" : "text-gray-500";
  const tabActiveClass = isDarkMode ? "bg-gray-700 text-white" : "bg-white text-black shadow";
  const tabInactiveClass = isDarkMode ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-black";
  const drawerClass = isDarkMode ? "bg-gray-900 text-white" : "bg-white text-black";

  return (
    <div className={`flex flex-col h-screen font-sans transition-colors duration-300 overflow-hidden ${bgClass}`}>
      
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
                  <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6">
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
          
          <div className="flex items-center gap-4">
              <button 
                  onClick={() => setIsAudioMode(!isAudioMode)}
                  className={`flex items-center gap-2 px-3 py-1 rounded transition-all border ${isAudioMode ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/30' : (isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white' : 'bg-gray-100 border-gray-200 text-gray-500 hover:text-black')}`}
              >
                  <span>🎧</span>
                  <span className="hidden md:inline text-xs font-bold">Audio Mode</span>
              </button>

              <div className={`flex items-center gap-2 px-3 py-1 rounded ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                  <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-1 hover:opacity-80 text-lg">
                      {isDarkMode ? '🌙' : '☀️'}
                  </button>
                  <div className={`w-px h-4 ${isDarkMode ? 'bg-gray-600' : 'bg-gray-400'}`}></div>
                  <button onClick={() => setFontSize(Math.max(16, fontSize - 2))} className="p-1 font-bold text-sm">A-</button>
                  <button onClick={() => setFontSize(Math.min(48, fontSize + 2))} className="p-1 font-bold text-lg">A+</button>
              </div>

              <div className={`flex rounded p-1 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                  <button 
                      onClick={() => setActiveLang('original')}
                      className={`px-3 py-1 text-sm rounded transition-all ${activeLang === 'original' ? tabActiveClass : tabInactiveClass}`}
                  >
                      Original
                  </button>
                  {targetLanguages.map(lang => (
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

      {/* Main Subtitles */}
      <div className="flex-1 overflow-y-auto p-6 md:p-12 scroll-smooth">
          <div className="max-w-5xl mx-auto space-y-6">
              {/* Case 1: Archive Mode - No Transcript */}
              {viewMode === 'archive' && segmentsOrder.length === 0 && (
                  <div className="text-center text-gray-500 italic mt-20">
                      No transcript available for this session.
                  </div>
              )}

              {/* Case 2: Live Mode - No Active Session (Show Next Session Card) */}
              {viewMode === 'live' && !sessionInfo && nextSession && (
                  <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center space-y-8 animate-fade-in">
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

              {/* Case 3: Standard Subtitles (Live or Archive) */}
              {(sessionInfo || viewMode === 'archive') && segmentsOrder.map((id) => {
                  const seg = segmentsMap[id];
                  if (!seg || seg.status === 'merged') return null;
                  
                  let text = "";
                  let isFallback = false;
                  
                  if (activeLang === 'original') {
                      text = seg.refined || seg.original || "";
                  } else {
                      text = seg[activeLang];
                      if (!text) {
                          text = seg.refined || seg.original || "";
                          isFallback = true;
                      }
                  }

                  if (!text || text.trim() === "") return null;

                  // Regex Guard for English: If text contains Korean, show placeholder
                  if (activeLang === 'en' && /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(text)) {
                       // Seamless Caption: Do not show [Translating...] text.
                       // Just return null (empty space) or maybe keep previous text?
                       // User request: "아예 빈칸(공백)으로 둬라"
                       return (
                           <div key={id} className={`transition-all duration-500 opacity-60`}>
                               {/* Empty placeholder to maintain layout if needed, or just nothing */}
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
                  // In Archive mode, everything is considered 'final' (no gray text)
                  // In Live mode, apply the 5s rule
                  const isTimeOut = viewMode === 'live' ? ((now - (seg.timestamp || 0)) > 5000) : true;
                  const showAsRaw = viewMode === 'live' ? (!isFinal && !isTimeOut && !isFallback) : false;
                  
                  return (
                      <div key={id} className={`transition-all duration-500 flex items-start group ${!showAsRaw ? 'opacity-100' : 'opacity-60'}`}>
                          {isAudioMode && seg.seq && (
                              <button 
                                  onClick={() => setCurrentPlayingId(id)}
                                  className={`mr-3 mt-1.5 text-[10px] font-mono transition-all shrink-0 ${currentPlayingId === id ? 'text-blue-500 font-bold scale-110' : 'text-gray-500 opacity-30 group-hover:opacity-100 hover:text-blue-400'}`}
                              >
                                  #{seg.seq}
                              </button>
                          )}
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

      {/* Audio Player Footer */}
      {isAudioMode && (
          <div className={`fixed bottom-0 inset-x-0 p-4 border-t shadow-lg z-50 flex justify-between items-center transition-colors backdrop-blur-md ${isDarkMode ? 'bg-gray-900/90 border-gray-800 text-white' : 'bg-white/90 border-gray-200 text-black'}`}>
               <div className="flex items-center gap-4">
                  <div className="text-sm font-mono w-16 text-gray-500">
                      {currentPlayingId && segmentsMap[currentPlayingId]?.seq ? `#${segmentsMap[currentPlayingId].seq}` : 'Ready'}
                  </div>
                  <button onClick={togglePlay} className="p-3 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-lg transition-transform hover:scale-105 active:scale-95 flex items-center justify-center w-12 h-12">
                      {isPlaying ? (
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                      ) : (
                          <svg className="w-5 h-5 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      )}
                  </button>
                  <button onClick={handleSpeedChange} className={`text-xs font-bold px-3 py-1.5 rounded transition-colors ${isDarkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200'}`}>
                      x{playbackRate.toFixed(1)}
                  </button>
              </div>
              <div className="text-xs text-blue-500 font-bold animate-pulse">
                  {isPlaying ? 'PLAYING' : 'PAUSED'}
              </div>
          </div>
      )}
    </div>
  );
};

export default AudienceView;
