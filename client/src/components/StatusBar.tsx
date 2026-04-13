import React, { useEffect, useState, useRef } from "react";
import { rtdb } from "../firebase";
import { ref, onValue, off } from "firebase/database";

interface Props { projectId?: string }

const StatusBar: React.FC<Props> = ({ projectId }) => {
  const [translation, setTranslation] = useState<Record<string, unknown> | null>(null);
  const [lastActive, setLastActive] = useState<number | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const cRef = ref(rtdb, "/.info/connected");
    onValue(cRef, (snap) => setConnected(!!snap.val()));
    return () => off(cRef);
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const base = `sessions/${projectId}/status`;
    const tRef = ref(rtdb, `${base}/services/translation`);
    const laRef = ref(rtdb, `${base}/lastActive`);
    onValue(tRef, (s) => setTranslation(s.val()));
    onValue(laRef, (s) => setLastActive(Number(s.val()) || null));
    return () => { off(tRef); off(laRef); };
  }, [projectId]);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      // Keep state updates fresh without server state dependency
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const pill = (label: string, state?: string) => (
    <span className={`px-2 py-1 rounded text-xs ${state === 'ok' ? 'bg-green-700' : state === 'error' ? 'bg-red-700' : 'bg-gray-700'}`}>{label}: {state || '...'}</span>
  );

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-800 text-gray-300 p-2 text-xs flex justify-between items-center z-50 shadow-[0_-2px_10px_rgba(0,0,0,0.5)]">
      <div className="flex gap-4 items-center">
        <span className={`px-2 py-1 rounded text-xs ${connected ? 'bg-green-700 text-white' : 'bg-red-700 text-white'}`}>
          {connected ? '● RTDB 연결됨' : '○ RTDB 끊김'}
        </span>
        {pill('Translation', (translation?.state as string) || '')}
      </div>
      <div>
        <span className="opacity-75">마지막 수신:</span>{' '}
        <span className="font-mono">{lastActive ? new Date(lastActive).toLocaleTimeString() : '-'}</span>
      </div>
    </div>
  );
};

export default StatusBar;
