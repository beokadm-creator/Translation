// Version: Quality Stable v1
import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { parseSmartly } from '../utils/parseSmartly';
import { useParams, useSearchParams } from 'react-router-dom';
import { useProjectStream } from '../hooks/useProjectStream';
// debug mode does not use shared components

interface StreamSegment {
  id: string;
  text: string;
  lang: string;
  timestamp: number;
  isFinal: boolean;
  status?: string;
}

const Overlay: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const { realProjectId, projectData, streamData } = useProjectStream(projectId);
  const [segments, setSegments] = useState<StreamSegment[]>([]);
  
  
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
  const targetLang = searchParams.get('lang') || 'original';

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

  // URL Params (unused in debug)

  

  useEffect(() => {
    if (!projectData) return;

    const data = projectData;
    
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
  }, [projectData, accessCodeParam]);

  // Final Styles: Param > DB > Default
  // debug mode: finalStyle unused

  

  useEffect(() => {
    if (!realProjectId || !isAuthorized) return;

    const data = streamData;
    if (!data) {
      setSegments([]);
      return;
    }

    // Merge logic: Map data to segments, replacing if ID exists
    const processedSegments: StreamSegment[] = Object.entries(data)
      .map(([key, val]: [string, any]) => {
        const ts = Number((key || '').split('_')[0] || Date.now());
        let isFinal = false;
        let text = '';
        let status = 'raw';
        if (typeof val === 'string') {
          const smart = parseSmartly(val);
          text = smart.text || (val || '').trim();
          isFinal = smart.isFinal;
          status = isFinal ? 'final' : 'raw';
        } else if (typeof val === 'object') {
          // If refined is a JSON string, try parsing it to plain text
          let refinedText = val.refined || "";
          try {
             const p = JSON.parse(refinedText);
             if (p && p.refined) refinedText = p.refined;
          } catch {}

          const smart = parseSmartly(val);
          // Prefer refined text if available and not empty, else smart parser
          text = refinedText || smart.text;
          isFinal = smart.isFinal;
          status = val.status || (isFinal ? 'final' : 'raw');
        }
        if (!text) return null;
        return { id: key, text, lang: targetLang, timestamp: ts, isFinal, status } as StreamSegment;
      })
      .filter((s): s is StreamSegment => !!s)
      .sort((a, b) => a.timestamp - b.timestamp);
    
    setSegments(processedSegments);
  }, [streamData, targetLang, isAuthorized, settings.maxLines, realProjectId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments]);

  return (
    <div
      className="min-h-screen w-full overflow-hidden flex flex-col justify-end p-8 transition-colors duration-300"
      style={{ backgroundColor: settings.backgroundColor }}
    >
      {projectId && (
        <div style={{ position: 'fixed', top: 0, right: 0, opacity: 0 }}>
          <Link to={`/p/${projectId}/live`}>.</Link>
        </div>
      )}
      <div
        ref={scrollRef}
        className="w-full overflow-y-auto"
        style={{
          textAlign: settings.textAlign as any,
          alignItems: settings.textAlign === 'center' ? 'center' : settings.textAlign === 'right' ? 'flex-end' : 'flex-start',
          color: settings.textColor,
          fontSize: settings.fontSize,
          fontFamily: settings.fontFamily,
          fontWeight: 'bold',
          lineHeight: settings.lineHeight,
          maxHeight: '80vh'
        }}
      >
        <div className="whitespace-pre-wrap break-words">
          {segments.map(s => (
            <span
              key={s.id}
              style={{ 
                 // Restore original design: just use settings color, maybe opacity for raw
                 color: settings.textColor,
                 opacity: s.isFinal ? 1 : 0.8,
                 marginRight: '0.25em'
              }}
            >
              {s.text}{' '}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Overlay;
