import React, { useEffect, useState } from "react";
import { rtdb } from "../firebase";
import { ref, onValue, off } from "firebase/database";

interface Props { projectId?: string }

const StatusBar: React.FC<Props> = ({ projectId }) => {
  const [openai, setOpenai] = useState<any>(null);
  const [gemini, setGemini] = useState<any>(null);
  const [translation, setTranslation] = useState<any>(null);
  const [lastActive, setLastActive] = useState<number | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    const cRef = ref(rtdb, "/.info/connected");
    onValue(cRef, (snap) => setConnected(!!snap.val()));
    return () => off(cRef);
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const base = `sessions/${projectId}/status`;
    const oRef = ref(rtdb, `${base}/services/openai`);
    const gRef = ref(rtdb, `${base}/services/gemini`);
    const tRef = ref(rtdb, `${base}/services/translation`);
    const laRef = ref(rtdb, `${base}/lastActive`);
    onValue(oRef, (s) => setOpenai(s.val()));
    onValue(gRef, (s) => setGemini(s.val()));
    onValue(tRef, (s) => setTranslation(s.val()));
    onValue(laRef, (s) => setLastActive(Number(s.val()) || null));
    return () => { off(oRef); off(gRef); off(tRef); off(laRef); };
  }, [projectId]);

  const pill = (label: string, state?: string) => (
    <span className={`px-2 py-1 rounded text-xs ${state === 'ok' ? 'bg-green-700' : state === 'error' ? 'bg-red-700' : 'bg-gray-700'}`}>{label}: {state || '...'}</span>
  );

  const now = Date.now();
  const serverState = lastActive && now - lastActive < 15000 ? 'ok' : (lastActive ? 'idle' : '...');

  return (
    <div className="w-full flex items-center gap-2 py-2 sticky top-0 z-10 bg-gray-900">
      <span className={`px-2 py-1 rounded text-xs ${connected ? 'bg-green-700' : 'bg-red-700'}`}>RTDB: {connected ? 'OK' : 'DISCONNECTED'}</span>
      {pill('Server', serverState)}
      {pill('OpenAI', openai?.state)}
      {pill('Gemini', gemini?.state)}
      {pill('Translation', translation?.state)}
    </div>
  );
};

export default StatusBar;
