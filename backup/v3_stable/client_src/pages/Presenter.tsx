import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { ref, onValue, off } from 'firebase/database';
import { doc, getDoc, query, collection, where, getDocs } from 'firebase/firestore';
import { db, rtdb } from '../firebase';
import { Maximize2, Minimize2, FlipHorizontal } from 'lucide-react';
import { motion } from 'framer-motion';
import AccessCodeModal from '../components/AccessCodeModal';

 

const Presenter: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [realProjectId, setRealProjectId] = useState<string | null>(null);
  const [fullText, setFullText] = useState<string>("");
  const [isMirrored, setIsMirrored] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [isAccessModalOpen, setIsAccessModalOpen] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);

  const handleClear = () => {
    if(window.confirm("Clear presenter view?")) {
        setFullText("");
    }
  };

  // 1. Resolve Project ID (Slug support) & Check Access
  useEffect(() => {
    if (!projectId) return;
    
    const initProject = async () => {
      let resolvedId = projectId;

      // Try finding by slug if it doesn't look like a standard ID (optional check, or just query)
      // We'll just try to find a project with this slug first
      try {
        const q = query(collection(db, 'projects'), where('slug', '==', projectId));
        const slugSnap = await getDocs(q);
        
        if (!slugSnap.empty) {
          resolvedId = slugSnap.docs[0].id;
        }
      } catch (e) {
        console.warn("Slug query failed, assuming ID", e);
      }

      setRealProjectId(resolvedId);

      // Now check access settings using the resolved ID
      const docRef = doc(db, 'projects', resolvedId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.accessCode) {
           const sessionKey = `access_granted_${resolvedId}`;
           if (sessionStorage.getItem(sessionKey) === 'true') {
             setIsAuthorized(true);
           } else {
             setAccessCode(data.accessCode);
             setIsAccessModalOpen(true);
           }
        } else {
          setIsAuthorized(true);
        }
      }
    };

    initProject();
  }, [projectId]);

  const handleAccessSuccess = () => {
    if (realProjectId) {
      sessionStorage.setItem(`access_granted_${realProjectId}`, 'true');
      setIsAccessModalOpen(false);
      setIsAuthorized(true);
    }
  };

  useEffect(() => {
    if (!realProjectId || !isAuthorized) return;

    const fullRef = ref(rtdb, `sessions/${realProjectId}/fullText`);

    const handleData = (snapshot: any) => {
      const data = snapshot.val();
      setFullText(typeof data === 'string' ? data : "");
    };

    onValue(fullRef, handleData);
    return () => off(fullRef);
  }, [realProjectId, isAuthorized]);

  

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [fullText]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  if (!isAuthorized && !isAccessModalOpen && realProjectId) {
     return <div className="min-h-screen bg-black text-white flex items-center justify-center">Loading access...</div>;
  }

  return (
    <div className={`min-h-screen bg-black text-white p-8 flex flex-col ${isMirrored ? 'scale-x-[-1]' : ''}`}>
      <AccessCodeModal 
        isOpen={isAccessModalOpen} 
        correctCode={accessCode} 
        onSuccess={handleAccessSuccess} 
      />
      
      {/* Controls */}
      <div className={`fixed top-4 right-4 flex space-x-2 opacity-0 hover:opacity-100 transition-opacity z-50 ${isMirrored ? 'scale-x-[-1]' : ''}`}>
        <button onClick={handleClear} className="p-3 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors" title="Reset">
           <FlipHorizontal className="w-6 h-6 rotate-90" /> {/* Re-using icon as refresh look-alike or import RefreshCw */}
        </button>
        <button onClick={() => setIsMirrored(!isMirrored)} className="p-3 bg-gray-800 rounded-full hover:bg-gray-700 transition-colors" title="Mirror View (Teleprompter)">
          <FlipHorizontal className="w-6 h-6" />
        </button>
        <button onClick={toggleFullscreen} className="p-3 bg-gray-800 rounded-full hover:bg-gray-700 transition-colors" title="Fullscreen">
          {isFullscreen ? <Minimize2 className="w-6 h-6" /> : <Maximize2 className="w-6 h-6" />}
        </button>
      </div>

      <div className="flex-1 flex flex-col justify-end space-y-8 pb-20 max-w-6xl mx-auto w-full">
        {(!fullText || fullText.trim().length === 0) ? (
          <div className="text-center text-gray-600 animate-pulse flex flex-col items-center justify-center h-full">
            <p className="text-2xl font-medium">Ready for speech...</p>
            <p className="text-sm mt-2">Speak into the microphone to see subtitles here.</p>
          </div>
        ) : (
          <>
            <motion.div 
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="p-4 rounded-xl"
            >
              <div className="text-6xl md:text-8xl font-bold leading-tight tracking-tight">
                {fullText}
              </div>
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
};

export default Presenter;
