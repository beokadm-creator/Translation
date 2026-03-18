import React, { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useProjectStream } from '../hooks/useProjectStream';
import { rtdb } from '../firebase';
import { ref, onValue } from 'firebase/database';
import type { ProjectSettings } from '../types';

type OverlaySettings = NonNullable<ProjectSettings['overlay']>;

const DEFAULT_SETTINGS: OverlaySettings = {
    fontSize: 48,
    fontColor: '#ffffff',
    fontWeight: 'bold',
    bgColor: '#000000',
    bgOpacity: 1,
    padding: 40,
    textEffect: 'none',
    align: 'left',
    displayStyle: 'youtube',
    letterSpacing: 0,
    maxLines: 4,
    lineHeight: 1.6,
    fontFamily: 'sans-serif',
    typingSpeed: 35,
    bottomOffset: 0,
};

const OverlayView: React.FC = () => {
    const { projectId, lang } = useParams<{ projectId: string; lang?: string }>();
    const [searchParams] = useSearchParams();
    const isDebug = searchParams.get('debug') === 'true';
    const activeLang = lang || 'refined';
    const activeProjectId = projectId || 'default';

    const { streamData, loading, error } = useProjectStream(activeProjectId, { subscribe: true });
    const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_SETTINGS);

    useEffect(() => {
        const settingsRef = ref(rtdb, `projects/${activeProjectId}/settings`);
        const unsub = onValue(settingsRef, (snap) => {
            if (snap.exists()) {
                const val = snap.val();
                if (val.overlay) {
                    setSettings((prev) => ({ ...DEFAULT_SETTINGS, ...prev, ...(val.overlay as Partial<OverlaySettings>) }));
                }
            }
        });
        return () => unsub();
    }, [activeProjectId]);

    // ── Data Processing ───────────────────────────────────────────────────────
    // 오버레이는 항상 final 세그먼트만 표시 (원문/번역 중 텍스트 숨김)
    const [displayText, setDisplayText] = useState<string>('');

    useEffect(() => {
        if (!streamData) { setDisplayText(''); return; }

        type RawSeg = {
            id: string; original?: string; refined?: string;
            ko?: string; en?: string; status?: string; timestamp: number;
        };

        const segments = Object.entries(streamData)
            .map(([key, val]: [string, unknown]) => ({ ...(val as RawSeg), id: key }))
            .filter(s => s.status === 'final')
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-15);

        const texts = segments.map(s => {
            if (activeLang === 'ko') return s.ko ?? s.refined ?? s.original ?? '';
            if (activeLang === 'en') return s.en ?? s.refined ?? s.original ?? '';
            return s.refined ?? s.original ?? '';
        }).filter(Boolean);

        setDisplayText(texts.join(' '));
    }, [streamData, activeLang]);

    // ── 타이핑 애니메이션 ─────────────────────────────────────────────────────
    const [visibleText, setVisibleText] = useState('');
    const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const visibleLengthRef = useRef(0);

    useEffect(() => {
        if (typingIntervalRef.current) { clearInterval(typingIntervalRef.current); typingIntervalRef.current = null; }

        if (settings.displayStyle !== 'typing') {
            setVisibleText(displayText);
            visibleLengthRef.current = displayText.length;
            return;
        }

        if (!displayText) { setVisibleText(''); visibleLengthRef.current = 0; return; }

        // 현재 visibleText가 새 displayText의 앞부분이면 이어서 타이핑, 아니면 처음부터
        const currentSlice = displayText.slice(0, visibleLengthRef.current);
        if (!displayText.startsWith(currentSlice) || visibleLengthRef.current > displayText.length) {
            visibleLengthRef.current = 0;
            setVisibleText('');
        }

        const ms = Math.max(16, Math.floor(1000 / Math.max(1, settings.typingSpeed || 35)));
        typingIntervalRef.current = setInterval(() => {
            if (visibleLengthRef.current >= displayText.length) {
                clearInterval(typingIntervalRef.current!);
                typingIntervalRef.current = null;
                return;
            }
            visibleLengthRef.current += 1;
            setVisibleText(displayText.slice(0, visibleLengthRef.current));
        }, ms);

        return () => { if (typingIntervalRef.current) { clearInterval(typingIntervalRef.current); typingIntervalRef.current = null; } };
    }, [displayText, settings.displayStyle, settings.typingSpeed]);

    const renderedText = settings.displayStyle === 'typing' ? visibleText : displayText;

    // ── 줄 수 기반 컨테이너 높이 계산 ────────────────────────────────────────
    const fontSize = settings.fontSize ?? 48;
    // lineHeight를 정수 px로 고정 → scrollTop 스냅이 소수점 없이 정확히 맞음
    const lineHeightPx = Math.round(fontSize * (settings.lineHeight ?? 1.6));
    const maxLines = Math.max(1, settings.maxLines || 4);
    const containerHeightPx = lineHeightPx * maxLines;

    // scrollTop을 줄 높이 배수로 스냅 → 항상 완전한 줄만 보임, 잔재 없음
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        requestAnimationFrame(() => {
            const maxScroll = el.scrollHeight - el.clientHeight;
            if (maxScroll <= 0) return;
            el.scrollTop = Math.floor(maxScroll / lineHeightPx) * lineHeightPx;
        });
    }, [renderedText, lineHeightPx, containerHeightPx]);

    // ── Debug ─────────────────────────────────────────────────────────────────
    if (loading && isDebug) return <div style={{ color: '#fff', background: '#000', padding: 16 }}>Loading...</div>;
    if (error && isDebug) return <div style={{ color: 'red', background: '#fff', padding: 16 }}>Error: {error}</div>;

    if (!renderedText && isDebug) {
        return (
            <div style={{ width: '100vw', height: '100vh', background: settings.bgColor || '#000', padding: `${settings.padding ?? 40}px`, boxSizing: 'border-box' }}>
                <p style={{ color: settings.fontColor || '#fff', fontSize: `${fontSize}px`, margin: 0 }}>
                    [DEBUG] {activeProjectId} / {activeLang} | {maxLines}줄 × {lineHeightPx}px = {containerHeightPx}px
                </p>
            </div>
        );
    }

    if (!renderedText) return <div style={{ width: '100vw', height: '100vh', background: settings.bgColor || '#000000' }} />;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div style={{
            width: '100vw',
            height: '100vh',
            background: settings.bgColor || '#000000',
            display: 'flex',
            alignItems: 'flex-end',
            padding: `${settings.padding ?? 40}px`,
            boxSizing: 'border-box',
        }}>
            <div ref={containerRef} style={{
                width: '100%',
                height: `${containerHeightPx}px`,
                overflow: 'hidden',
            }}>
                <p style={{
                    margin: 0,
                    fontSize: `${fontSize}px`,
                    fontFamily: settings.fontFamily || 'sans-serif',
                    fontWeight: settings.fontWeight,
                    color: settings.fontColor || '#ffffff',
                    // 정수 px로 지정 → CSS와 JS 계산값 일치, 잔재 없음
                    lineHeight: `${lineHeightPx}px`,
                    letterSpacing: `${settings.letterSpacing ?? 0}px`,
                    wordBreak: 'keep-all',
                    overflowWrap: 'break-word',
                    textAlign: settings.align as React.CSSProperties['textAlign'],
                }}>
                    {renderedText}
                </p>
            </div>
        </div>
    );
};

export default OverlayView;
