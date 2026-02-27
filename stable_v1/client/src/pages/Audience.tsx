import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { ref, onValue, off } from 'firebase/database';
import { doc, onSnapshot, query, collection, where, getDocs } from 'firebase/firestore'; // Use onSnapshot for real-time updates
import { db, rtdb } from '../firebase';
import { Globe, Moon, Sun, Megaphone, ArrowDown, Minus, Plus, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import AccessCodeModal from '../components/AccessCodeModal';
import Parking from '../components/Parking';

interface StreamSegment {
  id: string;
  text: string;
  lang: string;
  timestamp: number;
  isFinal: boolean;
}

interface SubtitleChunkProps {
  id: string; // Added ID for debug logging
  text: string;
  isFinal: boolean;
  darkMode: boolean;
}

const TypewriterText = ({ text }: { text: string }) => {
  const characters = text.split("");
  return (
    <>
      {characters.map((char, index) => (
        <motion.span
          key={index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.02, delay: index * 0.01 }} // Fast typing effect (10ms per char)
        >
          {char}
        </motion.span>
      ))}
    </>
  );
};

const SubtitleChunk: React.FC<SubtitleChunkProps> = ({ id, text, isFinal, darkMode }) => {
  // Highlight Effect Logic
  const [highlight, setHighlight] = useState(false);
  const prevIsFinalRef = useRef(isFinal);

  useEffect(() => {
      // If transitioned to Final, trigger highlight
      if (isFinal && !prevIsFinalRef.current) {
          setHighlight(true);
          const timer = setTimeout(() => setHighlight(false), 1000); // 1s Red Highlight
          return () => clearTimeout(timer);
      }
      prevIsFinalRef.current = isFinal;
  }, [isFinal]);

  return (
    <span className="mr-1 inline-block">
      <motion.span
        key={`${id}-${text}`} // Force re-render animation when text changes for same ID
        layout // Enable layout animation for position changes
        initial={{ opacity: 1 }} 
        animate={{ 
          opacity: 1, 
          color: highlight 
            ? "#EF4444" // Red-500
            : (isFinal 
              ? (darkMode ? '#e5e7eb' : '#111827') 
              : '#2563eb'), // Blue-600 for Interim
          backgroundColor: highlight 
            ? (darkMode ? "rgba(239, 68, 68, 0.2)" : "#FEE2E2")
            : "transparent"
        }}
        className={`${!isFinal ? 'italic font-medium' : ''} px-0.5 rounded transition-colors duration-300`}
      >
        {/* Only apply Typewriter effect for Finalized (Ghost Buffered) text */}
        {isFinal ? <TypewriterText text={text} /> : text}
      </motion.span>
    </span>
  );
};

const Audience: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  // 1. Data Structure Change: Map Object (ID -> Segment)
  const [segmentsMap, setSegmentsMap] = useState<Record<string, StreamSegment>>({});
  const [project, setProject] = useState<any>(null);
  const [selectedLang, setSelectedLang] = useState(localStorage.getItem('selected_lang') || 'original');
  const [availableLangs, setAvailableLangs] = useState<string[]>(['original']);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [isAccessModalOpen, setIsAccessModalOpen] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [notice, setNotice] = useState('');
  
  // Loading & Error State
  const [status, setStatus] = useState<'loading' | 'active' | 'not_found' | 'error'>('loading');
  // const [langSwitching, setLangSwitching] = useState(false); // Removed unused state

  // User Preferences
  const [darkMode, setDarkMode] = useState(true); 
  const [fontSize, setFontSize] = useState(18);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const [showResumeBtn, setShowResumeBtn] = useState(false);

  // Clear Logic
  const handleClear = () => {
     if(window.confirm("Clear all subtitles?")) {
         setSegmentsMap({});
     }
  };

  // Load Project Data
  useEffect(() => {
    if (!projectId) return;

    let unsubscribe: () => void;

    const initProject = async () => {
       try {
         setStatus('loading');
         let realId = projectId;
         
         // Try finding by slug
         const q = query(collection(db, 'projects'), where('slug', '==', projectId));
         const slugSnap = await getDocs(q);
         
         if (!slugSnap.empty) {
           realId = slugSnap.docs[0].id;
         }

         const docRef = doc(db, 'projects', realId);
         
         // Subscribe to Project changes in real-time
         unsubscribe = onSnapshot(docRef, (docSnap) => {
           if (docSnap.exists()) {
             const data = docSnap.data();
             setProject({ id: docSnap.id, ...data }); 
             setStatus('active');
             
             if (data.settings?.targetLangs) {
               setAvailableLangs(['original', ...data.settings.targetLangs]);
             }
             
             // Scheduling Logic
             const checkSchedule = () => {
               const now = new Date();
               const start = new Date(`${data.schedule.date}T${data.schedule.startTime}`);
               const end = new Date(`${data.schedule.date}T${data.schedule.endTime}`);
               
               if (now >= start && now <= end) {
                 setIsLive(true);
               } else {
                 setIsLive(false);
               }
             };
             checkSchedule();

             // Apply Admin Defaults
             if (data.settings?.appearance?.fontSize) {
                  const sizeMap: Record<string, number> = { 'small': 14, 'medium': 18, 'large': 24, 'xlarge': 32 };
                  const adminSize = sizeMap[data.settings.appearance.fontSize];
                  if (adminSize) setFontSize(adminSize);
             }

             // Access Control Logic
             if (data.accessCode) {
                const sessionKey = `access_granted_${realId}`; 
                if (localStorage.getItem(sessionKey) === 'true') { 
                  setIsAuthorized(true);
                } else {
                  setAccessCode(data.accessCode);
                  setIsAccessModalOpen(true);
                }
             } else {
               setIsAuthorized(true);
             }
           } else {
             console.warn("Project not found:", realId);
             setStatus('not_found');
           }
         }, (error) => {
           console.error("Snapshot error:", error);
           setStatus('error');
         });
       } catch (error) {
         console.error("Init error:", error);
         setStatus('error');
       }
    };

    initProject();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [projectId]);

  // Subscribe to Status (Notice)
  useEffect(() => {
    // Only subscribe if we have the real project object (with ID)
    if (!project?.id) return;
    
    const statusRef = ref(rtdb, `sessions/${project.id}/status`);
    onValue(statusRef, (snap) => {
      const val = snap.val();
      if (val && val.notice) {
        setNotice(val.notice);
      } else {
        setNotice('');
      }
    });
    return () => off(statusRef);
  }, [project?.id]);

  // Subscribe to RTDB
  useEffect(() => {
    if (!project?.id || !isAuthorized) return;

    const streamRef = ref(rtdb, `sessions/${project.id}/stream`);
    console.log(`[Audience] Listening to RTDB path: sessions/${project.id}/stream`);

    const handleData = (snapshot: any) => {
      const data = snapshot.val();
      
      if (!data) {
        setSegmentsMap({});
        return;
      }

      setSegmentsMap(prevMap => {
        const newMap = { ...prevMap };
        let hasChanges = false;

        Object.entries(data).forEach(([key, val]: [string, any]) => {
          let segmentData;
          
          if (selectedLang === 'original') {
             segmentData = val['ko'] || val.original;
          } else {
             segmentData = val[selectedLang] || val['ko'] || val.original;
          }
          
          if (!segmentData) return;

          const newText = segmentData.text;
          const oldText = prevMap[key]?.text;

          // 3. Console Logging for Diff
          if (oldText && oldText !== newText) {
             console.log(`%c[Update Received] ID: ${key}, Old: "${oldText}", New: "${newText}"`, 'color: yellow; background: red; font-size: 12px');
             hasChanges = true;
          } else if (!oldText) {
             // New entry
             hasChanges = true;
          }

          // 1. Overwrite Logic (Map Key Replacement)
          newMap[key] = {
            id: key,
            ...segmentData,
            isFinal: segmentData.isFinal ?? val.original?.isFinal ?? false
          };
        });

        return hasChanges ? newMap : prevMap;
      });
    };

    onValue(streamRef, handleData);
    return () => off(streamRef);
  }, [project?.id, selectedLang, isAuthorized]);

  // Derive sorted array for rendering from Map
  const segments = Object.values(segmentsMap).sort((a, b) => a.timestamp - b.timestamp);

  // Auto-scroll Logic
  useEffect(() => {
    if (!isAutoScrollPaused && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [segments, isAutoScrollPaused]);

  const handleAccessSuccess = () => {
    if (!project?.id) return;
    localStorage.setItem(`access_granted_${project.id}`, 'true'); 
    setIsAccessModalOpen(false);
    setIsAuthorized(true);
  };

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    
    // If user scrolls up significantly (more than 50px from bottom)
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
    
    if (!isNearBottom) {
      setIsAutoScrollPaused(true);
      setShowResumeBtn(true);
    } else {
      setIsAutoScrollPaused(false);
      setShowResumeBtn(false);
    }
  };

  const resumeAutoScroll = () => {
    setIsAutoScrollPaused(false);
    setShowResumeBtn(false);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  const handleLangChange = (lang: string) => {
    // setLangSwitching(true);
    setSelectedLang(lang);
    localStorage.setItem('selected_lang', lang);
    // setTimeout(() => setLangSwitching(false), 500); // Visual feedback delay
  };

  const getLangName = (code: string) => {
    const names: Record<string, string> = {
      'original': 'Original',
      'ko': 'Korean',
      'en': 'English',
      'ja': 'Japanese',
      'zh': 'Chinese',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German'
    };
    return names[code] || code.toUpperCase();
  };

  // Loading / Error UI
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
      </div>
    );
  }

  if (status === 'not_found') {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white p-4 text-center">
        <Globe className="w-16 h-16 text-gray-600 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Event Not Found</h1>
        <p className="text-gray-400">The URL you entered is invalid or the event has been removed.</p>
      </div>
    );
  }

  if (status === 'error') {
     return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white p-4 text-center">
        <div className="w-16 h-16 bg-red-900/50 rounded-full flex items-center justify-center mb-4">
           <Globe className="w-8 h-8 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Connection Error</h1>
        <p className="text-gray-400 mb-4">Failed to load the event. Please check your internet connection.</p>
        <button onClick={() => window.location.reload()} className="bg-blue-600 px-6 py-2 rounded-lg">Retry</button>
      </div>
    );
  }

  // If not live yet and project loaded, show Parking
  if (isAuthorized && project && !isLive) {
    return (
      <Parking 
        project={project} 
        onLiveStart={() => setIsLive(true)} 
      />
    );
  }

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-300 ${darkMode ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>
      <AccessCodeModal 
        isOpen={isAccessModalOpen} 
        correctCode={accessCode} 
        onSuccess={handleAccessSuccess} 
      />
      
      {/* Header */}
      <div className={`shadow-sm border-b px-4 py-3 sticky top-0 z-20 transition-colors duration-300 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center min-w-0">
            <h1 className="font-bold text-lg truncate mr-2">
              {project?.name || 'Live Translation'}
            </h1>
            {isLive && (
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
            )}
          </div>
          
          <div className="flex items-center space-x-3">
            {/* Reset Button */}
            <button 
                onClick={handleClear}
                className={`p-2 rounded-full ${darkMode ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50' : 'bg-red-100 text-red-600 hover:bg-red-200'}`}
                title="Clear Subtitles"
            >
                <RefreshCw className="w-4 h-4" />
            </button>

            {/* Language Selector */}
            <div className={`flex items-center space-x-2 rounded-full px-3 py-1.5 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
              <Globe className="w-4 h-4 opacity-70" />
              <select
                value={selectedLang}
                onChange={(e) => handleLangChange(e.target.value)}
                className="bg-transparent border-none text-sm font-medium focus:ring-0 cursor-pointer outline-none pr-6 appearance-none"
                style={{ maxWidth: '100px' }}
              >
                {availableLangs.map(lang => (
                  <option key={lang} value={lang} className={darkMode ? 'bg-gray-800' : 'bg-white'}>
                    {getLangName(lang)}
                  </option>
                ))}
              </select>
            </div>

            {/* Dark Mode Toggle */}
            <button 
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 rounded-full ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
            >
              {darkMode ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4 text-gray-600" />}
            </button>
          </div>
        </div>
      </div>

      {/* Notice Banner */}
      {notice && (
        <div className="bg-orange-600 text-white px-4 py-2 text-center text-sm font-medium animate-pulse sticky top-[60px] z-10">
          <Megaphone className="w-4 h-4 inline mr-2" />
          {notice}
        </div>
      )}

      {/* Content Area - Document Style */}
      <div className="flex-1 overflow-hidden relative w-full bg-gray-100/50">
        <div 
          ref={scrollRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-y-auto py-8 px-4 sm:px-0 scroll-smooth"
        >
          {/* Paper Container */}
          <div className={`max-w-3xl mx-auto shadow-xl min-h-[80vh] p-8 sm:p-16 transition-colors duration-500 ${
              darkMode ? 'bg-[#1a1b1e] text-gray-200 border-gray-800' : 'bg-white text-gray-900'
          }`}>
              <AnimatePresence initial={false}>
                {segments.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center h-64 opacity-30 space-y-4"
                  >
                    <Globe className="w-12 h-12" />
                    <p className="font-serif italic">Waiting for the session to begin...</p>
                  </motion.div>
                ) : (
                  <div className="prose prose-lg max-w-none">
                     <p className={`leading-loose font-serif text-justify transition-all duration-300`} style={{ fontSize: `${fontSize}px` }}>
                       {segments.map((segment) => (
                         <SubtitleChunk 
                           key={segment.id}
                           id={segment.id} // Pass ID
                           text={segment.text}
                           isFinal={segment.isFinal}
                           darkMode={darkMode}
                         />
                       ))}
                       {/* Blinking Cursor - Typewriter Effect */}
                       <motion.span 
                         layoutId="cursor"
                         className="inline-block w-0.5 h-6 bg-blue-500 ml-1 align-middle animate-pulse"
                         transition={{ type: "spring", stiffness: 500, damping: 30 }}
                       />
                     </p>
                  </div>
                )}
              </AnimatePresence>
          </div>
        </div>


        {/* Resume Scroll Button */}
        <AnimatePresence>
          {showResumeBtn && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              onClick={resumeAutoScroll}
              className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center space-x-2 z-30 hover:bg-blue-700"
            >
              <ArrowDown className="w-4 h-4" />
              <span className="text-sm font-medium">Resume Scroll</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Floating Reset Button (Test) - Removed */}
      
      {/* Footer / Controls */}
      <div className={`border-t px-4 py-3 safe-area-bottom ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <span className="text-xs opacity-60">Live Translation</span>
          
          <div className="flex items-center space-x-3">
             <button 
               onClick={() => setFontSize(Math.max(14, fontSize - 2))}
               className={`p-2 rounded-lg transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'}`}
             >
               <Minus className="w-4 h-4" />
             </button>
             <span className="text-sm font-medium min-w-[3ch] text-center">{fontSize}</span>
             <button 
               onClick={() => setFontSize(Math.min(48, fontSize + 2))}
               className={`p-2 rounded-lg transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'}`}
             >
               <Plus className="w-4 h-4" />
             </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Audience;
