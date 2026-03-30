import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { rtdb } from '../firebase';
import { ref, get } from 'firebase/database';
import type { ProjectSettings } from '../types';

interface Conference {
  id: string;
  title: string;
  accessCode: string;
  dates: string;
}

const ConferenceDetail: React.FC = () => {
  const navigate = useNavigate();
  const { conferenceId } = useParams<{ conferenceId: string }>();

  const [conference, setConference] = useState<Conference | null>(null);
  const [projects, setProjects] = useState<ProjectSettings[]>([]);
  const [accessCode, setAccessCode] = useState("");
  const [accessRequired, setAccessRequired] = useState(false);
  const [accessGranted, setAccessGranted] = useState(false);
  const [accessError, setAccessError] = useState(false);
  const [status, setStatus] = useState<'loading' | 'error' | 'success'>('loading');
  useEffect(() => {
    const loadData = async () => {
      if (!conferenceId) return;

      try {
        // Load conference info
        const confSnap = await get(ref(rtdb, `conferences/${conferenceId}`));
        if (!confSnap.exists()) {
          setStatus('error');
          return;
        }

        const confData = confSnap.val();
        setConference({ id: conferenceId, ...confData });

        // Load projects
        const projSnap = await get(ref(rtdb, 'projects'));
        if (projSnap.exists()) {
          const data = projSnap.val();
          const list = Object.keys(data).map(k => {
            const s = data[k].settings || {};
            return { ...s, slug: k } as ProjectSettings & { slug: string };
          }).filter(p => p.conferenceId === conferenceId);
          setProjects(list);
        }

        setStatus('success');
      } catch (error) {
        console.error('Error loading conference:', error);
        setStatus('error');
      }
    };

    loadData();
  }, [conferenceId]);

  const handleAccessSubmit = () => {
    if (!conference) return;

    if (accessCode.toUpperCase() === conference.accessCode.toUpperCase()) {
      setAccessGranted(true);
      setAccessRequired(false);
    } else {
      setStatus('error');
    }
  };

  const handleProjectClick = (slug: string) => {
    navigate(`/${slug}`);
  };

  const handleBack = () => {
    navigate('/');
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-500 border-t-transparent"></div>
      </div>
    );
  }

  if (status === 'error' || !conference) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold mb-2">Conference Not Found</h2>
          <button onClick={handleBack} className="mt-4 text-blue-400 hover:text-blue-300 underline">
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col p-4 md:p-8 font-sans selection:bg-blue-500/30">
        <div className="max-w-4xl mx-auto w-full space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-white/5 pb-6 gap-4">
                <div className="space-y-2">
                    <button onClick={handleBack} className="text-xs text-gray-500 hover:text-gray-300 font-medium transition-colors flex items-center gap-2">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"></path></svg>
                        Back to Conferences
                    </button>
                    <h1 className="text-2xl font-semibold tracking-tight text-gray-100 flex items-center gap-3">
                        {conference?.title || 'Loading...'}
                        <span className="px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400 font-bold text-[10px] uppercase tracking-widest flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
                            Conference
                        </span>
                    </h1>
                    <div className="text-sm text-gray-500 font-mono flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"></rect><line x1="16" x2="16" y1="2" y2="6"></line><line x1="8" x2="8" y1="2" y2="6"></line><line x1="3" x2="21" y1="10" y2="10"></line></svg>
                        {conference?.dates}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div>
                {/* Access Code Gate */}
                {accessRequired && !accessGranted && (
                    <div className="max-w-sm mx-auto mt-12 bg-[#111111] p-8 rounded-xl border border-white/5 shadow-2xl space-y-6">
                        <div className="text-center space-y-2">
                            <h2 className="text-lg font-medium text-gray-100">Enter Access Code</h2>
                            <p className="text-xs text-gray-500">This conference requires an access code.</p>
                        </div>
                        
                        <div className="space-y-4">
                            <input
                                type="text"
                                className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-center text-xl font-mono tracking-widest focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder-gray-600 text-gray-100"
                                placeholder="CODE"
                                value={accessCode}
                                onChange={e => {
                                    setAccessCode(e.target.value.toUpperCase());
                                    setAccessError(false);
                                }}
                                onKeyDown={e => e.key === 'Enter' && handleAccessSubmit()}
                            />
                            
                            {accessError && (
                                <div className="text-red-400 text-xs flex items-center justify-center gap-2">
                                    <span className="w-1 h-1 bg-red-400 rounded-full"></span>
                                    Invalid Access Code
                                </div>
                            )}

                            <button
                                onClick={handleAccessSubmit}
                                className="w-full bg-white text-black hover:bg-gray-200 font-medium py-3 rounded-lg transition-colors text-sm"
                            >
                                Enter Conference
                            </button>
                        </div>
                    </div>
                )}

                {/* Projects List */}
                {(!accessRequired || accessGranted) && (
                    <div className="space-y-6">
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm font-medium text-gray-300 uppercase tracking-widest">Select a Hall</h2>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {projects.map(p => (
                                <div 
                                    key={p.slug}
                                    onClick={() => handleProjectClick(p.slug)}
                                    className="bg-[#111111] hover:bg-[#1a1a1a] border border-white/5 hover:border-white/20 p-6 rounded-xl cursor-pointer transition-all flex flex-col justify-between group h-32"
                                >
                                    <div className="flex justify-between items-start">
                                        <h3 className="text-lg font-medium text-gray-200 group-hover:text-white transition-colors">{p.name}</h3>
                                        <div className="text-gray-500 group-hover:text-white transition-colors">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 mt-auto">
                                        {(p.targetLanguages ?? []).map(l => (
                                            <span key={l} className="text-[10px] uppercase bg-white/5 text-gray-400 px-2 py-0.5 rounded-md font-medium tracking-wider">
                                                {l === 'ko' ? 'KO' : l === 'en' ? 'EN' : l === 'ja' ? 'JA' : l}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {projects.length === 0 && (
                            <div className="text-center text-gray-500 py-12 border border-dashed border-white/10 rounded-xl bg-[#111111]/50 text-sm">
                                No halls found for this conference.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};

export default ConferenceDetail;
