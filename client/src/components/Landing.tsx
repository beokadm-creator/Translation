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
    // confId=undefined → load all projects (no filter)
    const loadProjects = useCallback(async (confId?: string) => {
        const projSnap = await get(ref(rtdb, 'projects'));
        if (projSnap.exists()) {
            const data = projSnap.val();
            const list = Object.keys(data).map(k => {
                const s = data[k].settings || {};
                return { ...s, slug: k } as ProjectSettings & { slug: string };
            }).filter((p) => !confId || p.conferenceId === confId);
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
    // Auto-login via URL Query ?conf={id}, or load all projects directly if they exist
    useEffect(() => {
        const confId = searchParams.get('conf');
        if (confId) {
            Promise.resolve().then(() => autoLogin(confId));
            return;
        }

        // No conf param — load all projects directly. Show access code only if no projects found.
        const checkAndAutoLoad = async () => {
            setStatus('loading');
            try {
                const projSnap = await get(ref(rtdb, 'projects'));
                if (projSnap.exists()) {
                    const data = projSnap.val();
                    const list = Object.keys(data).map(k => {
                        const s = data[k].settings || {};
                        return { ...s, slug: k } as ProjectSettings & { slug: string };
                    });
                    setProjects(list);
                    setConference({ id: 'default', title: 'Live Translation' });
                    setStatus('success');
                } else {
                    setStatus('idle');
                }
            } catch {
                setStatus('idle');
            }
        };

        Promise.resolve().then(checkAndAutoLoad);
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
            await loadProjects(foundConf.id); // filter to this conference
            setStatus('success');
        } catch (e) {
            console.error(e);
            setStatus('error');
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-4 relative font-sans selection:bg-blue-500/30">
            {/* Minimal Grid Background (Optional, Linear style) */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>

            <div className="z-10 w-full max-w-md space-y-8 text-center">
                
                {/* Initial loading check */}
                {status === 'loading' && accessCode === '' && (
                    <div className="text-gray-500 text-sm tracking-widest uppercase flex items-center justify-center gap-2">
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
                        Loading
                    </div>
                )}

                {/* Stage 1: Access Code Input */}
                {status !== 'success' && !(status === 'loading' && accessCode === '') && (
                    <div className="space-y-8 animate-in fade-in duration-500">
                        <div className="space-y-2">
                            <h1 className="text-2xl font-semibold tracking-tight text-gray-100">
                                HONG COMM.
                            </h1>
                            <p className="text-sm text-gray-400">Simultaneous Translation</p>
                        </div>
                        
                        <div className="bg-[#111111] p-8 rounded-xl border border-white/5 shadow-2xl space-y-6 text-left">
                            <div className="space-y-2">
                                <label className="block text-xs font-medium text-gray-400 uppercase tracking-widest">Access Code</label>
                                <input 
                                    type="text" 
                                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-lg font-mono tracking-widest focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder-gray-600 text-gray-100"
                                    placeholder="Enter Code"
                                    value={accessCode}
                                    onChange={e => { setAccessCode(e.target.value.toUpperCase()); setStatus('idle'); }}
                                    onKeyDown={e => e.key === 'Enter' && handleEnter()}
                                />
                            </div>
                            
                            {status === 'error' && (
                                <div className="text-red-400 text-xs flex items-center gap-2">
                                    <span className="w-1 h-1 bg-red-400 rounded-full"></span>
                                    Invalid Access Code
                                </div>
                            )}

                            <button 
                                onClick={handleEnter}
                                disabled={status === 'loading' || !accessCode}
                                className="w-full bg-white text-black hover:bg-gray-200 font-medium py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                            >
                                {status === 'loading' ? 'Verifying...' : 'Continue'}
                            </button>
                        </div>
                        
                        <div className="text-gray-600 text-xs">
                            © 2025 HONG COMM. All rights reserved.
                        </div>
                    </div>
                )}

                {/* Stage 2: Hall Selection */}
                {status === 'success' && conference && (
                    <div className="animate-in fade-in duration-500 space-y-8 w-full max-w-2xl mx-auto">
                        <div className="text-left space-y-2 border-b border-white/5 pb-6">
                            <h2 className="text-xs text-gray-500 font-medium tracking-widest uppercase flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                                Active Conference
                            </h2>
                            <h1 className="text-2xl font-semibold text-gray-100">{conference.title}</h1>
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                            {projects.map(p => (
                                <button 
                                    key={p.slug}
                                    onClick={() => navigate(`/${p.slug}`)}
                                    className="group bg-[#111111] hover:bg-[#1a1a1a] border border-white/5 hover:border-white/20 p-5 rounded-xl transition-all text-left flex items-center justify-between"
                                >
                                    <div className="space-y-2">
                                        <h3 className="text-lg font-medium text-gray-200 group-hover:text-white transition-colors">{p.name}</h3>
                                        <div className="flex gap-2">
                                            {(p.targetLanguages ?? []).map(l => (
                                                <span key={l} className="text-[10px] uppercase bg-white/5 text-gray-400 px-2 py-0.5 rounded-md font-medium tracking-wider">
                                                    {l === 'ko' ? 'KO' : l === 'en' ? 'EN' : l === 'ja' ? 'JA' : l}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="text-gray-500 group-hover:text-white transition-colors">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
                                    </div>
                                </button>
                            ))}

                            {projects.length === 0 && (
                                <div className="text-center text-gray-500 py-12 border border-dashed border-white/10 rounded-xl bg-[#111111]/50">
                                    No halls available at the moment.
                                </div>
                            )}
                        </div>
                        
                        <div className="text-left">
                            <button onClick={() => { setStatus('idle'); setAccessCode(""); }} className="text-gray-500 hover:text-gray-300 text-sm transition-colors flex items-center gap-2">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"></path></svg>
                                Back
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default Landing;
