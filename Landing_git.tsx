import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { rtdb } from '../firebase';
import { ref, get } from 'firebase/database';
import type { ProjectSettings } from '../types';

const Landing: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // --- State ---
    const [accessCode, setAccessCode] = useState("");
    const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
    const [conference, setConference] = useState<{title: string, id: string} | null>(null);
    const [projects, setProjects] = useState<ProjectSettings[]>([]);
    // Define loadProjects before autoLogin since it's used in autoLogin
    const loadProjects = useCallback(async (confId: string) => {
        const projSnap = await get(ref(rtdb, 'projects'));
        if (projSnap.exists()) {
            const data = projSnap.val();
            const list = Object.keys(data).map(k => {
                const s = data[k].settings || {};
                return { ...s, slug: k } as ProjectSettings & { slug: string };
            }).filter((p) => p.conferenceId === confId);
            setProjects(list);
        }
    }, []);

    // Define autoLogin before useEffect to satisfy React Hooks exhaustive-deps
    const autoLogin = useCallback(async (confId: string) => {
        setStatus('loading');
        try {
            const snap = await get(ref(rtdb, `conferences/${confId}`));
            if (!snap.exists()) {
                setStatus('error'); // Invalid Conf ID
                return;
            }
            const data = snap.val();
            const conf = { id: confId, title: data.title };

            setConference(conf);
            await loadProjects(conf.id);
            setStatus('success');
        } catch {
            setStatus('error');
        }
    }, [loadProjects]);
    // Auto-login via URL Query ?conf={id}
    useEffect(() => {
        const confId = searchParams.get('conf');
        if (confId) {
            // Wrap in setTimeout to avoid calling setState synchronously in effect
            Promise.resolve().then(() => autoLogin(confId));
        }
    }, [searchParams, autoLogin]);
    const handleEnter = async () => {
        if (!accessCode) return;
        setStatus('loading');
        
        try {
            // 1. Find Conference by Access Code
            const confSnap = await get(ref(rtdb, 'conferences'));
            let foundConf: {id: string, title: string} | null = null;
            
            if (confSnap.exists()) {
                const data = confSnap.val();
                // Optimization: query by child 'accessCode' is better, but this works for small scale
                const matchedKey = Object.keys(data).find(k => data[k].accessCode === accessCode);
                if (matchedKey) {
                    foundConf = { id: matchedKey, title: data[matchedKey].title };
                }
            }

            if (!foundConf) {
                setStatus('error');
                return;
            }

            setConference(foundConf);
            await loadProjects(foundConf.id);
            setStatus('success');
        } catch (e) {
            console.error(e);
            setStatus('error');
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/40 via-gray-900 to-gray-900 pointer-events-none"></div>

            <div className="z-10 w-full max-w-md space-y-8 text-center">
                
                {/* Stage 1: Access Code Input */}
                {status !== 'success' && (
                    <div className="animate-fade-in-up space-y-6">
                        <h1 className="text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500 tracking-tight">
                            HONG COMM.
                            <span className="block text-2xl font-medium text-gray-400 mt-2">Simultaneous Translation</span>
                        </h1>
                        
                        <div className="bg-gray-800/50 backdrop-blur-lg p-8 rounded-2xl border border-gray-700 shadow-2xl">
                            <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Access Code</label>
                            <input 
                                type="text" 
                                className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-widest focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder-gray-700"
                                placeholder="CODE"
                                value={accessCode}
                                onChange={e => { setAccessCode(e.target.value.toUpperCase()); setStatus('idle'); }}
                                onKeyDown={e => e.key === 'Enter' && handleEnter()}
                            />
                            
                            {status === 'error' && (
                                <div className="text-red-500 text-sm mt-3 font-bold animate-shake">
                                    Invalid Access Code
                                </div>
                            )}

                            <button 
                                onClick={handleEnter}
                                disabled={status === 'loading'}
                                className="w-full mt-6 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-bold py-3 rounded-xl transition-all shadow-lg disabled:opacity-50"
                            >
                                {status === 'loading' ? 'Verifying...' : 'ENTER'}
                            </button>
                        </div>
                        
                        <div className="text-gray-600 text-xs mt-8">
                            짤 2025 HONG COMM. All rights reserved.
                        </div>
                    </div>
                )}

                {/* Stage 2: Hall Selection */}
                {status === 'success' && conference && (
                    <div className="animate-fade-in space-y-6 w-full max-w-2xl mx-auto">
                        <div className="text-center mb-8">
                            <h2 className="text-sm text-blue-400 font-bold tracking-widest uppercase mb-2">Welcome to</h2>
                            <h1 className="text-3xl font-bold text-white">{conference.title}</h1>
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                            {projects.map(p => (
                                <button 
                                    key={p.slug}
                                    onClick={() => navigate(`/${p.slug}`)}
                                    className="group relative bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-blue-500 p-6 rounded-xl transition-all text-left flex items-center justify-between overflow-hidden"
                                >
                                    <div>
                                        <h3 className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors">{p.name}</h3>
                                        <div className="flex gap-2 mt-2">
                                            {p.targetLanguages.map(l => (
                                                <span key={l} className="text-[10px] uppercase bg-gray-900 text-gray-400 px-2 py-1 rounded border border-gray-700">
                                                    {l === 'ko' ? '?눖?눟 KO' : l === 'en' ? '?눣?눡 EN' : l === 'ja' ? '?눓?눝 JA' : l}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-gray-500 group-hover:bg-blue-600 group-hover:text-white transition-all">
                                        ??                                    </div>
                                </button>
                            ))}

                            {projects.length === 0 && (
                                <div className="text-center text-gray-500 py-10">
                                    No halls open yet.
                                </div>
                            )}
                        </div>
                        
                        <button onClick={() => { setStatus('idle'); setAccessCode(""); }} className="text-gray-500 hover:text-white text-sm mt-8 underline">
                            ??Back to Access Code
                        </button>
                    </div>
                )}

            </div>
        </div>
    );
};

export default Landing;
