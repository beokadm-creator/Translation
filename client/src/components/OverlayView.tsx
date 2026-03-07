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
    const activeLang = lang || 'refined';

    const activeProjectId = projectId || "default";
    const { streamData, loading, error } = useProjectStream(activeProjectId, { subscribe: true });

    // Settings
    const [settings, setSettings] = useState<NonNullable<ProjectSettings['overlay']>>({
        fontSize: 48, fontColor: '#ffffff', fontWeight: 'bold', bgColor: '#000000', bgOpacity: 0.6,
        padding: 20, textEffect: 'shadow', align: 'center'
    });
    const [hideRaw, setHideRaw] = useState<boolean>(true);

    useEffect(() => {
        const settingsRef = ref(rtdb, `projects/${activeProjectId}/settings`);
        const unsub = onValue(settingsRef, (snap) => {
            if (snap.exists()) {
                const val = snap.val();
                if (val.overlay) {
                    setSettings((prev) => ({ ...prev, ...(val.overlay as Partial<ProjectSettings['overlay']>) }));
                }
                if (val.hideRaw !== undefined) {
                    setHideRaw(val.hideRaw);
                }
            }
        });
        return () => unsub();
    }, [activeProjectId]);

    // ── Data Processing ───────────────────────────────────────────────────────
    type SegEntry = { id: string; text: string; isRaw: boolean };
    const [displayLines, setDisplayLines] = useState<SegEntry[]>([]);

    useEffect(() => {
        if (!streamData) {
            setDisplayLines([]);
            return;
        }

        type StreamSegment = {
            id: string;
            original?: string;
            refined?: string;
            en?: string;
            ja?: string;
            status?: string;
            timestamp: number;
        };

        const segments = Object.entries(streamData)
            .map(([key, val]: [string, unknown]) => {
                const segment = val as StreamSegment;
                return { ...segment, id: key };
            })
            .filter(s => {
                if (s.status === 'final') return true;
                if (s.status === 'raw' || s.status === 'translating') {
                    return !hideRaw;
                }
                return false;
            })
            .sort((a, b) => a.timestamp - b.timestamp);

        const validSegments = segments.map(s => {
            let text = "";
            if (activeLang === 'refined') text = s.refined ?? s.original ?? "";
            else if (activeLang === 'en') text = s.en ?? "";
            else if (activeLang === 'ja') text = s.ja ?? "";
            return { id: s.id, text, isRaw: s.status !== 'final' };
        }).filter(s => s.text);

        const lastLines = validSegments.slice(-4);

        Promise.resolve().then(() => {
            setDisplayLines(lastLines);
        });
    }, [streamData, activeLang]);


    // ── Styles ────────────────────────────────────────────────────────────────
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
        gap: '10px',
    };

    const bgHex = `${settings.bgColor}${Math.round(settings.bgOpacity * 255).toString(16).padStart(2, '0')}`;

    const lineStyle = (isLast: boolean, isRaw: boolean): React.CSSProperties => ({
        fontSize: `${settings.fontSize}px`,
        color: isRaw ? '#a8b5c8' : settings.fontColor,
        fontWeight: settings.fontWeight,
        backgroundColor: bgHex,
        padding: '10px 30px',
        borderRadius: '12px',
        textAlign: settings.align as React.CSSProperties['textAlign'],
        textShadow: settings.textEffect === 'shadow' ? '2px 2px 4px rgba(0,0,0,0.8)' : 'none',
        WebkitTextStroke: settings.textEffect === 'stroke' ? '2px black' : 'none',
        maxWidth: '90%',
        transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: isLast ? 1 : 0.7,
        border: isRaw ? '1px solid rgba(99,102,241,0.5)' : 'none',
    });


    // ── Debug Views ───────────────────────────────────────────────────────────
    if (loading && isDebug) return <div className="text-black bg-white p-4">Loading Stream...</div>;
    if (error && isDebug) return <div className="text-red-500 bg-white p-4">Error: {error}</div>;

    if (displayLines.length === 0 && isDebug) {
        return (
            <div style={{ width: '100vw', height: '100vh', background: '#0f0' }}>
                <div style={containerStyle}>
                    <div style={lineStyle(true, false)}>
                        [DEBUG: Waiting for subtitles...] <br />
                        Project: {activeProjectId} <br />
                        Lang: {activeLang}
                    </div>
                </div>
            </div>
        );
    }

    if (displayLines.length === 0) return <div style={{ width: '100vw', height: '100vh', background: 'transparent' }} />;

    // ── Main Render ───────────────────────────────────────────────────────────
    return (
        <div style={{ width: '100vw', height: '100vh', background: 'transparent' }}>
            <style>{`
                @keyframes shimmer-overlay {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }
                @keyframes fade-in-overlay {
                    from { opacity: 0; transform: translateX(-50%) translateY(6px); }
                    to { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
                @keyframes blink-cursor-overlay {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0; }
                }
                @keyframes spin-overlay {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>


            {/* Subtitle Lines */}
            <div style={containerStyle}>
                {displayLines.map((line, idx) => {
                    const isLast = idx === displayLines.length - 1;
                    return (
                        <div key={line.id} style={lineStyle(isLast, line.isRaw)}>
                            {line.text}
                            {/* Blinking cursor for latest raw line */}
                            {line.isRaw && isLast && (
                                <span style={{
                                    display: 'inline-block',
                                    width: '3px',
                                    height: '0.85em',
                                    backgroundColor: '#818cf8',
                                    marginLeft: '6px',
                                    verticalAlign: 'text-bottom',
                                    animation: 'blink-cursor-overlay 1s step-end infinite',
                                }} />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default OverlayView;
