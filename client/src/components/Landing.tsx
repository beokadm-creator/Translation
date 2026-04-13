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
        <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col relative font-sans selection:bg-blue-500/30">
            {/* Linear-style grid background */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>

            {/* Header */}
            <header className="z-10 w-full px-6 py-4 flex justify-between items-center border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                        <span className="text-white font-black text-sm tracking-tighter">HC</span>
                    </div>
                    <span className="text-sm font-semibold tracking-widest text-gray-300 uppercase">
                        HONG COMM.
                    </span>
                </div>
                <span className="text-xs text-gray-600 font-medium tracking-wider uppercase">Simultaneous Translation</span>
            </header>

            <main className="z-10 flex-grow flex flex-col items-center justify-center p-6 w-full max-w-4xl mx-auto">

                {/* Loading state */}
                {status === 'loading' && (
                    <div className="flex items-center gap-2 text-gray-500 text-sm tracking-widest uppercase">
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
                        Loading
                    </div>
                )}

                {/* Project list */}
                {status === 'success' && (
                    <div className="w-full space-y-8">
                        {/* Section header */}
                        <div className="space-y-1 border-b border-white/5 pb-6">
                            <p className="text-xs text-gray-500 font-medium tracking-widest uppercase flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                                Live Sessions
                            </p>
                            <h1 className="text-2xl font-semibold text-gray-100 tracking-tight">Select a Hall</h1>
                            <p className="text-sm text-gray-500 mt-1">
                                Real-time AI-powered simultaneous translation for medical conferences.
                            </p>
                        </div>

                        {/* Projects list */}
                        <div className="grid grid-cols-1 gap-3">
                            {projects.map(p => (
                                <button
                                    key={p.slug}
                                    onClick={() => navigate(`/${p.slug}`)}
                                    className="group bg-[#111111] hover:bg-[#1a1a1a] border border-white/5 hover:border-white/20 p-5 rounded-xl transition-all text-left flex items-center justify-between"
                                >
                                    <div className="space-y-2">
                                        <h3 className="text-base font-medium text-gray-200 group-hover:text-white transition-colors">
                                            {p.name}
                                        </h3>
                                        <div className="flex flex-wrap gap-1.5">
                                            {(p.targetLanguages ?? []).map(l => (
                                                <span key={l} className="text-[10px] uppercase bg-white/5 text-gray-400 px-2 py-0.5 rounded-md font-medium tracking-wider">
                                                    {l === 'ko' ? 'KO' : l === 'en' ? 'EN' : l === 'ja' ? 'JA' : l}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="text-gray-600 group-hover:text-white transition-colors flex-shrink-0 ml-4">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M5 12h14"/>
                                            <path d="m12 5 7 7-7 7"/>
                                        </svg>
                                    </div>
                                </button>
                            ))}
                        </div>

                        {projects.length === 0 && (
                            <div className="text-center text-gray-500 py-16 border border-dashed border-white/10 rounded-xl bg-[#111111]/50">
                                <p className="text-sm font-medium">No sessions available</p>
                                <p className="text-xs text-gray-600 mt-1">There are currently no active conferences.</p>
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="z-10 w-full px-6 py-4 border-t border-white/5">
                <div className="text-gray-600 text-xs font-medium text-center">
                    © {new Date().getFullYear()} HONG COMM. All rights reserved.
                </div>
            </footer>
        </div>
    );
};

export default Landing;
