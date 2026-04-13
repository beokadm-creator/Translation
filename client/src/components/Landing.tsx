import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { rtdb } from '../firebase';
import { ref, get } from 'firebase/database';
import type { ProjectSettings } from '../types';

type ProjectListItem = ProjectSettings & {
    slug: string;
    conferenceTitle?: string;
    isPrivate?: boolean;
};

const Landing: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // --- State ---
    const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('loading');

    const [projects, setProjects] = useState<ProjectListItem[]>([]);
    
    // confId=undefined → load all projects (no filter)
    const loadProjects = useCallback(async (confId?: string) => {
        const projSnap = await get(ref(rtdb, 'projects'));
        if (projSnap.exists()) {
            const data = projSnap.val();
            const list = Object.keys(data).map(k => {
                const s = data[k].settings || {};
                return { ...s, slug: k } as ProjectListItem;
            }).filter((p) => !confId || p.conferenceId === confId);
            setProjects(list);
        }
    }, []);

    // Auto-login via URL Query ?conf={id}, or load all projects directly if they exist
    useEffect(() => {
        const confId = searchParams.get('conf');
        if (confId) {
            Promise.resolve().then(async () => {
                setStatus('loading');
                await loadProjects(confId);
                setStatus('success');
            });
            return;
        }

        // No conf param — load all projects directly.
        const checkAndAutoLoad = async () => {
            setStatus('loading');
            try {
                const projSnap = await get(ref(rtdb, 'projects'));

                if (projSnap.exists()) {
                    const data = projSnap.val();
                    const list = Object.keys(data)
                        .map(k => {
                            const s = data[k].settings || {};
                            return { ...s, slug: k, isPrivate: false } as ProjectListItem;
                        });
                    
                    setProjects(list);
                    setStatus('success');
                } else {
                    setProjects([]);
                    setStatus('success');
                }
            } catch {
                setProjects([]);
                setStatus('success');
            }
        };

        Promise.resolve().then(checkAndAutoLoad);
    }, [searchParams, loadProjects]);

    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col relative overflow-hidden font-sans">
            {/* Background Effects */}
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/30 via-gray-900 to-gray-900 pointer-events-none"></div>

            {/* Header / Navbar */}
            <header className="z-10 w-full p-6 flex justify-between items-center border-b border-gray-800/50 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                        <span className="text-white font-black text-xl tracking-tighter">HC</span>
                    </div>
                    <span className="text-xl font-bold tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-gray-100 to-gray-400">
                        HONG COMM.
                    </span>
                </div>
            </header>

            <main className="z-10 flex-grow flex flex-col items-center justify-center p-6 w-full max-w-5xl mx-auto">
                
                {/* Initial loading check */}
                {status === 'loading' && (
                    <div className="flex flex-col items-center justify-center space-y-4">
                        <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
                        <div className="text-gray-400 text-sm font-medium tracking-widest uppercase animate-pulse">Loading Portal...</div>
                    </div>
                )}

                {/* Stage 2: Public/Open Hall Selection */}
                {status === 'success' && (
                    <div className="animate-fade-in w-full">
                        {/* Hero Section */}
                        <div className="text-center mb-16 space-y-6">
                            <h2 className="text-blue-400 font-bold tracking-[0.2em] uppercase text-sm">Real-time AI Translation Portal</h2>
                            <h1 className="text-5xl md:text-6xl font-black text-white tracking-tight leading-tight">
                                Breaking Language <br className="hidden md:block"/> Barriers in Healthcare
                            </h1>
                            <p className="text-gray-400 max-w-2xl mx-auto text-lg">
                                Select a live session below to experience seamless, low-latency medical simultaneous translation powered by advanced AI.
                            </p>
                        </div>

                        {/* Projects Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {projects.map(p => (
                                <button 
                                    key={p.slug}
                                    onClick={() => navigate(`/${p.slug}`)}
                                    className="group relative bg-gray-800/40 backdrop-blur-sm hover:bg-gray-800 border border-gray-700/50 hover:border-blue-500/50 p-8 rounded-3xl transition-all text-left flex flex-col justify-between overflow-hidden shadow-xl hover:shadow-blue-900/20 min-h-[200px]"
                                >
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-all"></div>
                                    
                                    <div className="z-10">
                                        <div className="flex items-center gap-3 mb-4">
                                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                            <span className="text-xs font-bold text-green-500 uppercase tracking-wider">Live Now</span>
                                        </div>
                                        <h3 className="text-2xl font-bold text-white group-hover:text-blue-400 transition-colors mb-4 line-clamp-2">{p.name}</h3>
                                        
                                        <div className="flex flex-wrap gap-2">
                                            {(p.targetLanguages ?? []).map(l => (
                                                <span key={l} className="text-[11px] font-bold uppercase bg-gray-900/80 text-gray-300 px-3 py-1.5 rounded-full border border-gray-700">
                                                    {l === 'ko' ? '🇰🇷 Korean' : l === 'en' ? '🇺🇸 English' : l === 'ja' ? '🇯🇵 Japanese' : l}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    
                                    <div className="z-10 mt-6 flex items-center justify-between border-t border-gray-700/50 pt-4">
                                        <span className="text-sm text-gray-500 font-medium">Join Session</span>
                                        <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition-all transform group-hover:translate-x-1">
                                            →
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>

                        {projects.length === 0 && (
                            <div className="text-center py-20 bg-gray-800/20 border border-gray-800 rounded-3xl mt-8">
                                <div className="text-4xl mb-4">💤</div>
                                <h3 className="text-xl font-bold text-gray-300 mb-2">No Live Sessions</h3>
                                <p className="text-gray-500">There are currently no public conferences running.</p>
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="w-full p-6 text-center border-t border-gray-800/50 mt-auto z-10">
                <div className="text-gray-600 text-sm font-medium">
                    © {new Date().getFullYear()} HONG COMM. All rights reserved.
                </div>
            </footer>
        </div>
    );
};

export default Landing;
