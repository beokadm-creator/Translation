import React, { useState } from "react";
import { useParams } from "react-router-dom";
import LiveConsole from "../components/LiveConsole";
import StatusBar from "../components/StatusBar";
import { auth } from "../firebase";
import { useProjectStream } from "../hooks/useProjectStream";

const GoLive: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { realProjectId } = useProjectStream(projectId, { subscribe: false });
  const [purgeMsg, setPurgeMsg] = useState<string>("");
  if (!projectId) return <div className="p-6">Invalid project</div>;
  const purge = async (target: 'project' | 'all') => {
    try {
      setPurgeMsg("");
      const token = await auth.currentUser?.getIdToken();
      const targetId = realProjectId || projectId;
      const url = target === 'project'
        ? `https://us-central1-translation-comm.cloudfunctions.net/purgeSession?projectId=${encodeURIComponent(targetId)}`
        : `https://us-central1-translation-comm.cloudfunctions.net/purgeSession`;
      const ok = window.confirm(target === 'project' ? '현재 프로젝트 세션을 모두 삭제합니다. 계속하시겠습니까?' : '모든 세션을 삭제합니다. 계속하시겠습니까?');
      if (!ok) return;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!resp.ok) {
        const t = await resp.text();
        setPurgeMsg(`Error: ${t}`);
      } else {
        setPurgeMsg('Deleted');
      }
    } catch (e: any) {
      setPurgeMsg(e?.message || 'Error');
    }
  };
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <div className="max-w-4xl mx-auto py-6">
        <StatusBar projectId={projectId} />
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Go Live</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => purge('project')} className="px-3 py-1 rounded bg-red-600">DB 세션 삭제(프로젝트)</button>
            <button onClick={() => purge('all')} className="px-3 py-1 rounded bg-red-800">DB 전체 삭제</button>
          </div>
        </div>
        {purgeMsg && <div className="text-sm text-gray-400 mb-2">{purgeMsg}</div>}
        <LiveConsole projectId={projectId} sourceLabel="admin" />
      </div>
    </div>
  );
};

export default GoLive;
