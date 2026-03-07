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
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="border-b border-gray-800">
        <div className="container mx-auto px-6 py-6">
          <button
            onClick={handleBack}
            className="flex items-center text-gray-400 hover:text-white transition-colors mb-6"
          >
            <svg className="w-5 h-5 mr-2" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
              <path d="M15 19l-7-7 7-7"></path>
            </svg>
            Back to Conferences
          </button>

          <div className="mb-4">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 mb-4">
              <span className="w-2 h-2 rounded-full bg-blue-400 mr-2 animate-pulse"></span>
              CONFERENCE
            </span>
          </div>

          <h1 className="text-4xl md:text-5xl font-black mb-2 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
            {conference.title}
          </h1>
          <div className="flex items-center text-gray-400 mt-4">
            <svg className="w-5 h-5 mr-2" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
              <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
            </svg>
            {conference.dates}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-6 py-16">
        {/* Access Code Gate */}
        {accessRequired && !accessGranted && (
          <div className="max-w-md mx-auto">
            <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl p-8">
              <h2 className="text-2xl font-bold mb-4 text-center">Enter Access Code</h2>
              <p className="text-gray-400 text-center mb-6">
                This conference requires an access code to enter
              </p>

              <input
                type="text"
                className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-widest focus:ring-2 focus:ring-blue-500 outline-none transition-all mb-4"
                placeholder="CODE"
                value={accessCode}
                onChange={e => {
                  setAccessCode(e.target.value.toUpperCase());
                  setAccessError(false);
                }}
                onKeyDown={e => e.key === 'Enter' && handleAccessSubmit()}
              />

              {accessError && (
                <div className="text-red-500 text-sm mb-4 text-center font-bold">
                  Invalid Access Code
                </div>
              )}

              <button
                onClick={handleAccessSubmit}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-bold py-3 rounded-xl transition-all"
              >
                Enter Conference
              </button>
            </div>
          </div>
        )}

        {/* Projects List */}
        {(!accessRequired || accessGranted) && (
          <div>
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-4">Select a Hall</h2>
              <p className="text-gray-400">Choose from available halls below</p>
            </div>

            {projects.length === 0 ? (
              <div className="text-center py-20">
                <div className="text-6xl mb-4">🏛️</div>
                <h3 className="text-2xl font-bold text-gray-400 mb-2">No Halls Available</h3>
                <p className="text-gray-500">Check back later for hall assignments</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
                {projects.map((project) => (
                  <div
                    key={project.slug}
                    onClick={() => handleProjectClick(project.slug)}
                    className="group relative bg-gray-800/50 backdrop-blur-sm border border-gray-700 hover:border-blue-500 rounded-2xl p-8 cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-blue-500/20"
                  >
                    {/* Hover Effect */}
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl"></div>

                    {/* Content */}
                    <div className="relative z-10">
                      <h3 className="text-2xl font-bold text-white mb-3 group-hover:text-blue-400 transition-colors">
                        {project.name}
                      </h3>

                      <div className="flex gap-2 mb-6">
                        {project.targetLanguages.map((lang) => (
                          <span
                            key={lang}
                            className="text-xs uppercase bg-gray-900 text-gray-300 px-3 py-1 rounded-full border border-gray-700"
                          >
                            {lang === 'ko' ? '🇰🇷 Korean' :
                              lang === 'en' ? '🇺🇸 English' : lang}
                          </span>
                        ))}
                      </div>

                      <div className="flex items-center justify-between pt-6 border-t border-gray-700">
                        <span className="text-sm text-gray-400 group-hover:text-white transition-colors">
                          Enter Hall
                        </span>
                        <div className="w-10 h-10 rounded-full bg-gray-900 group-hover:bg-gradient-to-r group-hover:from-blue-500 group-hover:to-purple-500 flex items-center justify-center transition-all duration-300">
                          <svg className="w-5 h-5 text-gray-400 group-hover:text-white transform group-hover:translate-x-1 transition-transform" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                            <path d="M13 7l5 5m0 0l-5 5m5-5H6"></path>
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConferenceDetail;
