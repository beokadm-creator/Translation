import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useProjectStream } from '../hooks/useProjectStream';
import { rtdb } from '../firebase';
import { ref, onValue } from 'firebase/database';
import type { ProjectSettings } from '../types';

const OverlayView: React.FC = () => {
    const { projectId, lang } = useParams<{ projectId: string, lang?: string }>();
    const [searchParams] = useSearchParams();
    const isDebug = searchParams.get('debug') === 'true';
    const activeLang = lang || 'refined'; // Default to refined (source) if not specified

    const activeProjectId = projectId || "default";
    const { streamData, loading, error } = useProjectStream(activeProjectId, { subscribe: true });
    
    // Settings
    const [settings, setSettings] = useState<NonNullable<ProjectSettings['overlay']>>({
        fontSize: 48, fontColor: '#ffffff', fontWeight: 'bold', bgColor: '#000000', bgOpacity: 0.6,
        padding: 20, textEffect: 'shadow', align: 'center'
    });

    useEffect(() => {
        const settingsRef = ref(rtdb, `projects/${activeProjectId}/settings/overlay`);
        const unsub = onValue(settingsRef, (snap) => {
            if (snap.exists()) setSettings((prev: any) => ({ ...prev, ...snap.val() }));
        });
        return () => unsub();
    }, [activeProjectId]);

    // Data Processing with Smart Scroll
    const [displayLines, setDisplayLines] = useState<{id: string, text: string}[]>([]);
    
    useEffect(() => {
        if (!streamData) return;
        
        const segments = Object.entries(streamData)
            .map(([key, val]: [string, any]) => ({ id: key, ...val }))
            .filter(s => s.status === 'final' || s.status === 'raw')
            .sort((a, b) => a.timestamp - b.timestamp);

        // Filter valid text based on language
        const validSegments = segments.map(s => {
            let text = "";
            if (activeLang === 'refined') text = s.refined || s.original;
            else if (activeLang === 'en') text = s.en || ""; // If missing, show empty or fallback?
            else if (activeLang === 'ja') text = s.ja || "";
            return { id: s.id, text };
        }).filter(s => s.text); // Remove empty lines

        // Show last 4 lines max for better context
        const lastLines = validSegments.slice(-4);
        
        setDisplayLines(lastLines);

    }, [streamData, activeLang]);


    // Styles
    const containerStyle: React.CSSProperties = {
        position: 'fixed',
        bottom: 50,
        left: 0,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: settings.align === 'left' ? 'flex-start' : settings.align === 'right' ? 'flex-end' : 'center',
        padding: `0 ${settings.padding}px`,
        pointerEvents: 'none',
        zIndex: 9999,
        gap: '10px' // Space between lines
    };

    const textStyle = (isLast: boolean): React.CSSProperties => ({
        fontSize: `${settings.fontSize}px`,
        color: settings.fontColor,
        fontWeight: settings.fontWeight,
        backgroundColor: `${settings.bgColor}${Math.round(settings.bgOpacity * 255).toString(16).padStart(2, '0')}`,
        padding: '10px 30px',
        borderRadius: '12px',
        textAlign: settings.align,
        textShadow: settings.textEffect === 'shadow' ? '2px 2px 4px rgba(0,0,0,0.8)' : 'none',
        WebkitTextStroke: settings.textEffect === 'stroke' ? '2px black' : 'none',
        maxWidth: '90%',
        transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)', // Smooth transition
        opacity: isLast ? 1 : 0.7, // Fade out older line slightly
        transform: isLast ? 'translateY(0)' : 'translateY(-5px) scale(0.98)', // Subtle shrink for older line
    });

    if (loading && isDebug) return <div className="text-black bg-white p-4">Loading Stream...</div>;
    if (error && isDebug) return <div className="text-red-500 bg-white p-4">Error: {error}</div>;

    if (displayLines.length === 0 && isDebug) {
        return (
            <div style={{ width: '100vw', height: '100vh', background: '#0f0' }}>
                <div style={containerStyle}>
                    <div style={textStyle(true)}>
                        [DEBUG: Waiting for subtitles...] <br/>
                        Project: {activeProjectId} <br/>
                        Lang: {activeLang}
                    </div>
                </div>
            </div>
        );
    }

    if (displayLines.length === 0) return <div style={{ width: '100vw', height: '100vh', background: 'transparent' }} />;

    return (
        <div style={{ width: '100vw', height: '100vh', background: 'transparent' }}>
            <div style={containerStyle}>
                {displayLines.map((line, idx) => (
                    <div key={line.id} className="animate-slide-up" style={textStyle(idx === displayLines.length - 1)}>
                        {line.text}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default OverlayView;
