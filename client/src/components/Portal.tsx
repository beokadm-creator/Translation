import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { rtdb } from '../firebase';
import { ref, get } from 'firebase/database';

const Portal: React.FC = () => {
  const navigate = useNavigate();
  const [accessCode, setAccessCode] = useState('');
  const [liveProjects, setLiveProjects] = useState<Array<{ id: string; name: string; date: string }>>([]);

  useEffect(() => {
    // Find active projects (simple logic: check /projects)
    // In production, we should filter by 'status/lastActive' within 24h
    const fetchLive = async () => {
        try {
            const snap = await get(ref(rtdb, 'projects'));
            if (snap.exists()) {
                const data = snap.val();
                const active = Object.keys(data).map(key => {
                    const p = data[key];
                    // Check if active recently (e.g., 24 hours)
                    const lastActive = p.status?.lastActive || 0;
                    const isLive = (Date.now() - lastActive) < 86400000; // 24h
                    return isLive ? { ...p.settings, id: key } : null;
                }).filter(Boolean);
                setLiveProjects(active);
            }
        } catch (error: unknown) {
            console.error("Error fetching live projects:", error);
        }
    };
    fetchLive();
  }, []);

  const handleJoin = () => {
      if (!accessCode) return;
      // Direct navigate to project audience view
      navigate(`/p/${accessCode.toLowerCase()}`);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-4 relative font-sans selection:bg-blue-500/30">
      {/* Minimal Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>

      <div className="z-10 w-full max-w-md space-y-8 animate-in fade-in duration-500">
          <div className="space-y-2 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-gray-100">Live Captioning</h1>
              <p className="text-sm text-gray-400">Real-time AI Translation Platform</p>
          </div>

          {/* Access Code Input */}
          <div className="bg-[#111111] p-6 rounded-xl border border-white/5 shadow-2xl space-y-4">
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-widest">Enter Event Code</label>
              <div className="flex gap-2">
                  <input 
                      className="flex-1 bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-2 text-sm font-mono tracking-widest focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder-gray-600 text-gray-100"
                      placeholder="e.g. event_2025"
                      value={accessCode}
                      onChange={e => setAccessCode(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleJoin()}
                  />
                  <button 
                      onClick={handleJoin}
                      disabled={!accessCode}
                      className="bg-white text-black hover:bg-gray-200 font-medium px-6 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                      Join
                  </button>
              </div>
          </div>

          {/* Live List */}
          {liveProjects.length > 0 && (
              <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-4">
                      <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
                      <h3 className="text-xs font-medium text-gray-400 uppercase tracking-widest">Live Now</h3>
                  </div>
                  {liveProjects.map((p) => (
                      <div 
                          key={p.id}
                          onClick={() => navigate(`/p/${p.id}`)}
                          className="bg-[#111111] hover:bg-[#1a1a1a] border border-white/5 hover:border-white/20 p-4 rounded-xl cursor-pointer transition-all flex justify-between items-center group"
                      >
                          <div className="space-y-1">
                              <div className="font-medium text-gray-200 group-hover:text-white transition-colors">{p.name || p.id}</div>
                              <div className="text-[10px] text-gray-500 font-mono">{p.date}</div>
                          </div>
                          <div className="text-gray-500 group-hover:text-white transition-colors">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"></path></svg>
                          </div>
                      </div>
                  ))}
              </div>
          )}
      </div>

      {/* Admin Link */}
      <div className="absolute top-6 right-6 z-20">
          <button 
              onClick={() => navigate('/login')}
              className="text-xs text-gray-500 hover:text-gray-300 font-medium transition-colors flex items-center gap-2"
          >
              Admin
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
          </button>
      </div>
    </div>
  );
};

export default Portal;
