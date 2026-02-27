import React, { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ref, onValue, off } from 'firebase/database';
import { doc, getDoc } from 'firebase/firestore';
import { db, rtdb } from '../firebase';

interface StreamSegment {
  id: string;
  text: string;
  lang: string;
  timestamp: number;
  isFinal: boolean;
}

const Overlay: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const [segments, setSegments] = useState<StreamSegment[]>([]);
  const [paragraph, setParagraph] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Overlay usually doesn't need modal interaction as it's for OBS
  // BUT if security is strict, we might need to pass access code via URL param?
  // Or just rely on the fact that OBS URL is "secret".
  // For consistency with the requirement "Access Control", let's check it.
  // However, showing a modal in OBS is bad UX. 
  // Let's support passing ?code=XXXX in URL for Overlay.
  const accessCodeParam = searchParams.get('code');
  const [isAuthorized, setIsAuthorized] = useState(false);

  // Style Parameters
  const targetLang = searchParams.get('lang') || 'original'; // 'original', 'ko', 'en', etc.
  const shadow = searchParams.get('shadow') === 'false' ? 'none' : '2px 2px 4px rgba(0,0,0,0.8)';

  // Default Settings
  const [settings, setSettings] = useState({
    backgroundColor: 'transparent',
    textColor: 'white',
    fontSize: '32px',
    fontFamily: 'sans-serif',
    textAlign: 'center',
    lineHeight: 1.5,
    maxLines: 2
  });

  // URL Params override DB settings if present
  const paramBg = searchParams.get('bg');
  const paramColor = searchParams.get('color');
  const paramSize = searchParams.get('size');

  useEffect(() => {
    if (!projectId) return;

    const checkAccessAndLoadSettings = async () => {
      const docRef = doc(db, 'projects', projectId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        
        // 1. Access Check
        if (data.accessCode) {
           if (accessCodeParam === data.accessCode) {
             setIsAuthorized(true);
           } else {
             console.warn("Overlay Access Denied");
             setIsAuthorized(false);
           }
        } else {
          setIsAuthorized(true);
        }

        // 2. Load Appearance Settings
        if (data.settings?.appearance) {
          setSettings(prev => ({
            ...prev,
            ...data.settings.appearance
          }));
        }
      }
    };
    checkAccessAndLoadSettings();
  }, [projectId, accessCodeParam]);

  // Final Styles: Param > DB > Default
  const finalStyle = {
    backgroundColor: paramBg || settings.backgroundColor,
    color: paramColor || settings.textColor,
    fontSize: paramSize || settings.fontSize,
    fontFamily: settings.fontFamily,
    textAlign: settings.textAlign as any,
    lineHeight: settings.lineHeight
  };

  useEffect(() => {
    if (!projectId || !isAuthorized) return;

    const streamRef = ref(rtdb, `sessions/${projectId}/stream`);

    const handleData = (snapshot: any) => {
      const data = snapshot.val();
      if (!data) {
        setSegments([]);
        return;
      }

      // Process data similar to LiveConsole but filtered for specific language
      const processedSegments: StreamSegment[] = Object.entries(data)
        .map(([key, val]: [string, any]) => {
          // If target is original, grab original
          if (targetLang === 'original') {
            return { id: key, ...val.original };
          }
          // If target is specific lang, check if it exists
          const translation = val[targetLang];
          if (translation) {
            return { id: key, ...translation };
          }
          // Fallback to original if translation missing (optional behavior)
          return null; 
        })
        .filter((item): item is StreamSegment => item !== null)
        .sort((a, b) => a.timestamp - b.timestamp);

      setSegments(processedSegments);
      const combined = processedSegments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
      setParagraph(combined);
    };

    onValue(streamRef, handleData);
    return () => off(streamRef);
  }, [projectId, targetLang, isAuthorized, settings.maxLines]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments]);

  return (
    <div
      className="min-h-screen w-full overflow-hidden flex flex-col justify-end p-8 transition-colors duration-300"
      style={{ backgroundColor: finalStyle.backgroundColor }}
    >
      {!isAuthorized && (
        <div className="fixed inset-0 flex items-center justify-center text-red-500 bg-black bg-opacity-80 font-bold">
          Access Denied. Please check URL parameters.
        </div>
      )}

      <div
        ref={scrollRef}
        className="w-full overflow-y-auto"
        style={{
          textAlign: finalStyle.textAlign as any,
          alignItems: finalStyle.textAlign === 'center' ? 'center' : finalStyle.textAlign === 'right' ? 'flex-end' : 'flex-start',
          color: finalStyle.color,
          fontSize: finalStyle.fontSize,
          fontFamily: finalStyle.fontFamily,
          fontWeight: 'bold',
          textShadow: shadow,
          lineHeight: finalStyle.lineHeight,
          maxHeight: '80vh'
        }}
      >
        <div className="whitespace-pre-wrap break-words">
          {paragraph}
        </div>
      </div>
    </div>
  );
};

export default Overlay;
