import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { rtdb } from '../firebase';
import { ref, get } from 'firebase/database';
import type { ProjectSettings } from '../types';

interface Conference {
  id: string;
  title: string;
  dates: string;
}

const ConferenceDetail: React.FC = () => {
  const navigate = useNavigate();
  const { conferenceId } = useParams<{ conferenceId: string }>();

  const [conference, setConference] = useState<Conference | null>(null);
  const [projects, setProjects] = useState<ProjectSettings[]>([]);
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

  const handleProjectClick = (slug: string) => {
    navigate(`/${slug}`);
  };

  const handleBack = () => {
    navigate('/');
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#f9fafb] dark:bg-[#111827] text-[#111827] dark:text-[#f9fafb] flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-500 border-t-transparent"></div>
      </div>
    );
  }

  if (status === 'error' || !conference) {
    return (
      <div className="min-h-screen bg-[#f9fafb] dark:bg-[#111827] text-[#111827] dark:text-[#f9fafb] flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold mb-2">Conference Not Found</h2>
          <button onClick={handleBack} className="mt-4 text-[#1e3a5f] dark:text-[#d4af37] hover:text-[#24456f] dark:text-[#b5952f] underline">
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f9fafb] dark:bg-[#111827] text-[#111827] dark:text-[#f9fafb]">
      {/* Header */}
      <div className="border-b border-[#e5e7eb] dark:border-[#1f2937]">
        <div className="container mx-auto px-6 py-6">
          <button
            onClick={handleBack}
            className="flex items-center text-[#6b7280] dark:text-[#9ca3af] hover:text-[#111827] dark:text-[#f9fafb] transition-colors mb-6"
          >
            <svg className="w-5 h-5 mr-2" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
              <path d="M15 19l-7-7 7-7"></path>
            </svg>
            Back to Conferences
          </button>

          <div className="mb-4">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-[#1e3a5f] dark:text-[#d4af37] border border-blue-500/30 mb-4">
              <span className="w-2 h-2 rounded-full bg-blue-400 mr-2 animate-pulse"></span>
              CONFERENCE
            </span>
          </div>

          <h1 className="text-4xl md:text-5xl font-black mb-2  text-[#1e3a5f] dark:text-[#d4af37]">
            {conference.title}
          </h1>
          <div className="flex items-center text-[#6b7280] dark:text-[#9ca3af] mt-4">
            <svg className="w-5 h-5 mr-2" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
              <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
            </svg>
            {conference.dates}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-6 py-16">
        {/* Projects List */}
        <div>
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Select a Hall</h2>
            <p className="text-[#6b7280] dark:text-[#9ca3af]">Choose from available halls below</p>
          </div>

          {projects.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-6xl mb-4">🏛️</div>
              <h3 className="text-2xl font-bold text-[#6b7280] dark:text-[#9ca3af] mb-2">No Halls Available</h3>
              <p className="text-[#6b7280] dark:text-[#9ca3af]">Check back later for hall assignments</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
              {projects.map((project) => (
                <div
                  key={project.slug}
                  onClick={() => handleProjectClick(project.slug)}
                  className="group relative bg-[#ffffff] dark:bg-[#1f2937]/50 backdrop-blur-sm border border-[#e5e7eb] dark:border-[#374151] hover:border-[#1e3a5f] dark:hover:border-[#d4af37] rounded-2xl p-8 cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-blue-500/20"
                >
                  {/* Hover Effect */}
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl"></div>

                  {/* Content */}
                  <div className="relative z-10">
                    <h3 className="text-2xl font-bold text-[#111827] dark:text-[#f9fafb] mb-3 group-hover:text-[#1e3a5f] dark:text-[#d4af37] transition-colors">
                      {project.name}
                    </h3>

                    <div className="flex gap-2 mb-6">
                      {project.targetLanguages.map((lang) => (
                        <span
                          key={lang}
                          className="text-xs uppercase bg-[#f9fafb] dark:bg-[#111827] text-[#4b5563] dark:text-[#d1d5db] px-3 py-1 rounded-full border border-[#e5e7eb] dark:border-[#374151]"
                        >
                          {lang === 'ko' ? '🇰🇷 Korean' :
                            lang === 'en' ? '🇺🇸 English' : lang}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center justify-between pt-6 border-t border-[#e5e7eb] dark:border-[#374151]">
                      <span className="text-sm text-[#6b7280] dark:text-[#9ca3af] group-hover:text-[#111827] dark:text-[#f9fafb] transition-colors">
                        Enter Hall
                      </span>
                      <div className="w-10 h-10 rounded-full bg-[#f9fafb] dark:bg-[#111827] group-hover:bg-gradient-to-r group-hover:from-blue-500 group-hover:to-purple-500 flex items-center justify-center transition-all duration-300">
                        <svg className="w-5 h-5 text-[#6b7280] dark:text-[#9ca3af] group-hover:text-[#111827] dark:text-[#f9fafb] transform group-hover:translate-x-1 transition-transform" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
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
      </div>
    </div>
  );
};

export default ConferenceDetail;
