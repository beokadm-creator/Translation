import React, { useEffect, useState } from 'react';
import { rtdb as database } from '../firebase';
import { ref, onValue } from 'firebase/database';

interface HealthProps {
    projectId: string;
}

const HealthDashboard: React.FC<HealthProps> = ({ projectId }) => {
    const [serverStatus, setServerStatus] = useState<'ok' | 'error'>('error');
    const [whisperStatus, setWhisperStatus] = useState<'ok' | 'warn' | 'error'>('error');
    const [geminiStatus, setGeminiStatus] = useState<'ok' | 'warn' | 'error' | 'idle'>('idle');
    const [dbLatency, setDbLatency] = useState<number>(0);

    const [lastWhisper, setLastWhisper] = useState<number>(0);
    const [lastGemini, setLastGemini] = useState<number>(0);

    useEffect(() => {
        // 1. Server Connection (.info/connected)
        const connectedRef = ref(database, '.info/connected');
        onValue(connectedRef, (snap) => {
            setServerStatus(snap.val() ? 'ok' : 'error');
        });

        // 2. Service Status from DB
        const statusRef = ref(database, `projects/${projectId}/status`);
        onValue(statusRef, (snap) => {
            const data = snap.val();
            if (data) {
                // Whisper Check
                if (data.services?.openai?.ts) {
                    const diff = Date.now() - data.services.openai.ts;
                    setLastWhisper(diff);
                    if (diff < 5000) setWhisperStatus('ok');
                    else if (diff < 15000) setWhisperStatus('warn');
                    else setWhisperStatus('error');
                }

                // Gemini Check (Usually tracked by lastRefined update time in state)
            }
        });

        // 3. DB Latency (Estimate)
        const start = Date.now();
        get(ref(database, `projects/${projectId}/status/lastActive`)).then(() => {
            setDbLatency(Date.now() - start);
        });

        // Gemini Check via state/lastGeminiTime
        const geminiRef = ref(database, `projects/${projectId}/state/lastGeminiTime`);
        onValue(geminiRef, (snap) => {
            const ts = snap.val();
            if (ts) {
                const diff = Date.now() - ts;
                setLastGemini(diff);
                if (diff < 10000) setGeminiStatus('ok');
                else if (diff < 30000) setGeminiStatus('warn');
                else setGeminiStatus('idle'); // Just idle if no input
            }
        });

    }, [projectId]);

    const renderLight = (label: string, status: string, info: string) => {
        let color = "bg-gray-600";
        if (status === 'ok') color = "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.7)]";
        if (status === 'warn') color = "bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.7)]";
        if (status === 'error') color = "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.7)]";
        if (status === 'idle') color = "bg-gray-500";

        return (
            <div className="flex flex-col items-center group relative cursor-help">
                <div className={`w-3 h-3 rounded-full ${color} transition-all duration-300`}></div>
                <span className="text-[10px] text-gray-500 mt-1">{label}</span>
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-800 text-xs p-2 rounded border border-gray-700 whitespace-nowrap z-50">
                    {info}
                </div>
            </div>
        );
    };

    return (
        <div className="flex gap-4 bg-gray-900/50 p-2 rounded-lg border border-gray-800 backdrop-blur-sm">
            {renderLight("SERVER", serverStatus, serverStatus === 'ok' ? "Connected" : "Disconnected")}
            {renderLight("WHISPER", whisperStatus, `Last active: ${(lastWhisper/1000).toFixed(1)}s ago`)}
            {renderLight("GEMINI", geminiStatus, `Last refined: ${(lastGemini/1000).toFixed(1)}s ago`)}
            {renderLight("DB", dbLatency < 200 ? 'ok' : 'warn', `Latency: ${dbLatency}ms`)}
        </div>
    );
};

import { get } from 'firebase/database';
export default HealthDashboard;
