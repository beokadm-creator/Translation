import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { rtdb } from '../firebase';
import { ref, get } from 'firebase/database';

const Portal: React.FC = () => {
  const navigate = useNavigate();
  const [accessCode, setAccessCode] = useState('');
  const [liveProjects, setLiveProjects] = useState<any[]>([]);

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
        } catch {}
    };
    fetchLive();
  }, []);

  const handleJoin = () => {
      if (!accessCode) return;
      // Direct navigate to project audience view
      navigate(`/p/${accessCode.toLowerCase()}`);
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background Effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-black z-0"></div>
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"></div>

      <div className="z-10 w-full max-w-md space-y-8">
          <div className="text-center">
              <h1 className="text-4xl font-extrabold tracking-tight mb-2">Live Captioning</h1>
              <p className="text-gray-400">Real-time AI Translation Platform</p>
          </div>

          {/* Access Code Input */}
          <div className="bg-gray-900/50 backdrop-blur p-6 rounded-2xl border border-gray-800 shadow-xl">
              <label className="block text-sm font-medium text-gray-300 mb-2">Enter Event Code</label>
              <div className="flex gap-2">
                  <input 
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      placeholder="e.g. kaid_hanwha"
                      value={accessCode}
                      onChange={e => setAccessCode(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleJoin()}
                  />
                  <button 
                      onClick={handleJoin}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-6 py-3 rounded-lg transition-colors"
                  >
                      Join
                  </button>
              </div>
          </div>

          {/* Live List */}
          {liveProjects.length > 0 && (
              <div className="space-y-3">
                  <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider ml-1">Live Now</h3>
                  {liveProjects.map((p: any) => (
                      <div 
                          key={p.id}
                          onClick={() => navigate(`/p/${p.id}`)}
                          className="bg-gray-800/30 hover:bg-gray-800 border border-gray-800 hover:border-gray-600 p-4 rounded-xl cursor-pointer transition-all flex justify-between items-center group"
                      >
                          <div>
                              <div className="font-bold text-lg group-hover:text-blue-400 transition-colors">{p.name || p.id}</div>
                              <div className="text-xs text-gray-500">{p.date}</div>
                          </div>
                          <div className="flex items-center gap-2">
                              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                              <span className="text-xs text-red-400 font-bold">LIVE</span>
                          </div>
                      </div>
                  ))}
              </div>
          )}
      </div>

      {/* Admin Link */}
      <div className="absolute top-4 right-4 z-20">
          <button 
              onClick={() => navigate('/login')}
              className="text-gray-500 hover:text-white text-sm font-medium transition-colors"
          >
              Admin Login &rarr;
          </button>
      </div>
    </div>
  );
};

export default Portal;
