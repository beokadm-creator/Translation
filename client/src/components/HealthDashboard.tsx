/**
 * HealthDashboard - 실시간 시스템 상태 모니터링
 * 
 * 상태 판단 기준:
 * - SERVER: Firebase RTDB 연결 상태
 * - STT: 마지막 STT 성공까지의 경과 시간 (processAudio가 status에 기록)
 * - TRANS: 마지막 번역 처리 경과 시간 (onRefineRequest가 state에 기록)
 * - DB: RTDB 읽기 레이턴시
 * 
 * ⚠️  주의: STT/TRANS는 녹음을 시작하고 오디오가 전송되어야 점등됩니다.
 *       녹음 전에는 회색(idle)이 정상입니다.
 */

import React, { useEffect, useState, useRef } from 'react';
import { rtdb as database } from '../firebase';
import { ref, onValue, get } from 'firebase/database';

interface HealthProps {
    projectId: string;
}

type Status = 'ok' | 'warn' | 'error' | 'idle';

const HealthDashboard: React.FC<HealthProps> = ({ projectId }) => {
    const [serverStatus, setServerStatus] = useState<Status>('error');
    const [whisperStatus, setWhisperStatus] = useState<Status>('idle');
    const [geminiStatus, setGeminiStatus] = useState<Status>('idle');
    const [dbStatus, setDbStatus] = useState<Status>('idle');

    const [lastWhisperMs, setLastWhisperMs] = useState<number | null>(null);
    const [lastGeminiMs, setLastGeminiMs] = useState<number | null>(null);
    const [dbLatencyMs, setDbLatencyMs] = useState<number | null>(null);
    const [cfStatus, setCfStatus] = useState<Status>('idle');
    const [cfMsg, setCfMsg] = useState<string>('');

    // Track last known timestamps to update displayed "X seconds ago" live
    const lastWhisperTsRef = useRef<number | null>(null);
    const lastGeminiTsRef = useRef<number | null>(null);

    useEffect(() => {
        if (!projectId) return;

        // ── 1. Firebase RTDB 연결 상태 ───────────────────────────────────────
        const connectedRef = ref(database, '.info/connected');
        const unsubConn = onValue(connectedRef, (snap) => {
            setServerStatus(snap.val() ? 'ok' : 'error');
        });

        // ── 2. Whisper 상태: processAudio 성공 시 status/services/openai 업데이트
        const statusRef = ref(database, `projects/${projectId}/status`);
        const unsubStatus = onValue(statusRef, (snap) => {
            const data = snap.val();
            if (data?.services?.openai?.ts) {
                const ts: number = data.services.openai.ts;
                lastWhisperTsRef.current = ts;
                const diff = Date.now() - ts;
                setLastWhisperMs(diff);
                if (diff < 8000) setWhisperStatus('ok');
                else if (diff < 20000) setWhisperStatus('warn');
                else setWhisperStatus('error');
            }
            // DB lastActive 업데이트
            if (data?.lastActive) {
                const diff = Date.now() - data.lastActive;
                if (diff < 10000) setDbStatus('ok');
                else if (diff < 30000) setDbStatus('warn');
                else setDbStatus('idle');
            }
        });

        // ── 3. Gemini 상태: onRefineRequest 성공 시 state/lastGeminiTime 업데이트
        const geminiRef = ref(database, `projects/${projectId}/state/lastGeminiTime`);
        const unsubGemini = onValue(geminiRef, (snap) => {
            const ts: number | null = snap.val();
            if (ts && ts > 0) {
                lastGeminiTsRef.current = ts;
                const diff = Date.now() - ts;
                setLastGeminiMs(diff);
                if (diff < 15000) setGeminiStatus('ok');
                else if (diff < 40000) setGeminiStatus('warn');
                else setGeminiStatus('idle');
            }
        });

        // ── 4. DB 레이턴시 측정 (30초마다 재측정)
        const measureLatency = async () => {
            const start = Date.now();
            try {
                await get(ref(database, `projects/${projectId}/status/lastActive`));
                const ms = Date.now() - start;
                setDbLatencyMs(ms);
                setDbStatus(ms < 200 ? 'ok' : ms < 600 ? 'warn' : 'error');
            } catch {
                setDbStatus('error');
            }
        };
        measureLatency();
        const latencyInterval = setInterval(measureLatency, 30000);

        // ── 5. Cloud Function 헬스 체크 (1분마다)
        const checkCF = async () => {
            setCfStatus('idle');
            try {
                const r = await fetch('https://us-central1-translation-comm.cloudfunctions.net/diagnoseSystem');
                if (r.ok) {
                    const d = await r.json();
                    const allOk = d.tests?.rtdbWrite === 'SUCCESS' && d.tests?.rtdbRead === 'SUCCESS';
                    setCfStatus(allOk ? 'ok' : 'warn');
                    setCfMsg(allOk ? 'CF: All OK' : 'CF: Partial failure');
                } else {
                    setCfStatus('error');
                    setCfMsg(`CF: HTTP ${r.status}`);
                }
            } catch (e) {
                setCfStatus('error');
                setCfMsg('CF: Unreachable');
            }
        };
        checkCF();
        const cfInterval = setInterval(checkCF, 60000);

        // ── 6. 경과 시간 실시간 업데이트 (1초마다)
        const liveTimer = setInterval(() => {
            if (lastWhisperTsRef.current) {
                const diff = Date.now() - lastWhisperTsRef.current;
                setLastWhisperMs(diff);
                if (diff < 8000) setWhisperStatus('ok');
                else if (diff < 20000) setWhisperStatus('warn');
                else setWhisperStatus('error');
            }
            if (lastGeminiTsRef.current) {
                const diff = Date.now() - lastGeminiTsRef.current;
                setLastGeminiMs(diff);
                if (diff < 15000) setGeminiStatus('ok');
                else if (diff < 40000) setGeminiStatus('warn');
                else setGeminiStatus('idle');
            }
        }, 1000);

        return () => {
            unsubConn();
            unsubStatus();
            unsubGemini();
            clearInterval(latencyInterval);
            clearInterval(cfInterval);
            clearInterval(liveTimer);
        };
    }, [projectId]);

    const renderLight = (label: string, status: Status, tooltip: string) => {
        const colorMap: Record<Status, string> = {
            ok: 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]',
            warn: 'bg-yellow-400 shadow-[0_0_8px_rgba(234,179,8,0.8)]',
            error: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]',
            idle: 'bg-gray-500',
        };

        return (
            <div className="flex flex-col items-center group relative cursor-help">
                <div className={`w-3 h-3 rounded-full transition-all duration-500 ${colorMap[status]}`} />
                <span className="text-[10px] text-gray-500 mt-1 leading-none">{label}</span>
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block bg-gray-900 text-white text-xs p-2 rounded border border-gray-700 whitespace-nowrap z-[9999] shadow-xl">
                    {tooltip}
                    <div className="mt-1 text-gray-400 text-[10px]">
                        {status === 'idle' && label !== 'SERVER' && label !== 'DB' && (
                            <span>녹음 시작 후 점등됩니다</span>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const formatMs = (ms: number | null): string => {
        if (ms === null) return '–';
        if (ms < 1000) return `${ms}ms ago`;
        return `${(ms / 1000).toFixed(1)}s ago`;
    };

    return (
        <div className="flex items-center gap-4 bg-gray-900/60 px-3 py-2 rounded-lg border border-gray-800 backdrop-blur-sm">
            {renderLight('SERVER', serverStatus, serverStatus === 'ok' ? '🟢 Firebase 연결됨' : '🔴 연결 끊김')}
            {renderLight('STT', whisperStatus, lastWhisperMs !== null
                ? `🎙️ STT (gpt-4o): ${formatMs(lastWhisperMs)}`
                : '🎙️ 아직 오디오 미전송 (녹음 시작 필요)'
            )}
            {renderLight('TRANS', geminiStatus, lastGeminiMs !== null
                ? `🔬 번역 (gpt-4o-mini): ${formatMs(lastGeminiMs)}`
                : '🔬 번역 대기 중'
            )}
            {renderLight('DB', dbStatus, dbLatencyMs !== null
                ? `💾 DB 레이턴시: ${dbLatencyMs}ms`
                : '💾 DB 측정 중...'
            )}
            {cfStatus !== 'idle' && renderLight('CF', cfStatus, cfMsg)}
        </div>
    );
};

export default HealthDashboard;
