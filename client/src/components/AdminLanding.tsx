import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { rtdb } from '../firebase';
import { ref, set, get, child, remove } from 'firebase/database';
import type { ProjectSettings, Conference } from '../types';

import { QRCodeSVG } from 'qrcode.react';

const AdminLanding: React.FC = () => {
  const navigate = useNavigate();
  
  // --- State ---
  const [view] = useState<'conferences' | 'cleanup'>('conferences');
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [selectedConfId, setSelectedConfId] = useState<string | null>(null);
  const [showQR, setShowQR] = useState<string | null>(null); // Conf ID for QR modal
  
  // Projects for the selected conference
  const [confProjects, setConfProjects] = useState<ProjectSettings[]>([]);
  
  // All Projects (for Cleanup)
  const [, setAllProjects] = useState<{id: string, name: string, confId?: string}[]>([]);

  // Forms
  const [isCreatingConf, setIsCreatingConf] = useState(false);
  const [isCreatingProj, setIsCreatingProj] = useState(false);
  
  const [confForm, setConfForm] = useState({
      id: "", title: "", accessCode: "", startDate: "", endDate: ""
  });
  
  const [projForm, setProjForm] = useState<ProjectSettings>({
    name: "",
    slug: "",
    date: new Date().toISOString().split('T')[0],
    accessCode: "",
    targetLanguages: ["en"],
    parkingMessage: "The session will start shortly.",
    conferenceId: ""
  });

  // --- Effects ---

  // 1. Load Conferences
  useEffect(() => {
      const loadConfs = async () => {
          const snap = await get(ref(rtdb, 'conferences'));
          if (snap.exists()) {
              const data = snap.val();
              const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
              setConferences(list);
          } else {
              setConferences([]);
          }
      };
      loadConfs();
  }, [isCreatingConf]); // Reload after create

  // 2. Load Projects when Conference Selected
  useEffect(() => {
      if (!selectedConfId) {
          // Return early without calling setState
          return;
      }

      const loadProjects = async () => {
          // In a real app, use query orderByChild('settings/conferenceId').equalTo(selectedConfId)
          // For now, we fetch all and filter client side (simpler for this scale)
          const snap = await get(ref(rtdb, 'projects'));
          if (snap.exists()) {
              const data = snap.val();
              const list = Object.keys(data).map(k => {
                  const s = data[k].settings || {};
                  return { ...s, slug: k } as ProjectSettings & { slug: string };
              }).filter(p => p.conferenceId === selectedConfId);
              setConfProjects(list);
          } else {
              setConfProjects([]);
          }
      };
      loadProjects();
  }, [selectedConfId, isCreatingProj]);

  // 3. Load ALL Projects for Cleanup
  useEffect(() => {
      if (view === 'cleanup') {
          const loadAll = async () => {
              // Fetch keys only first using REST if possible, but SDK `get` is fine for now
              const snap = await get(ref(rtdb, 'projects'));
              if (snap.exists()) {
                  const data = snap.val();
                  const list = Object.keys(data).map(k => ({
                      id: k,
                      name: data[k].settings?.name || "Unknown Project",
                      confId: data[k].settings?.conferenceId
                  }));
                  setAllProjects(list);
              }
          };
          loadAll();
      }
  }, [view]);

  // --- Handlers ---

  const handleCreateConf = async () => {
      console.log("Create Conference Clicked", confForm);
      if (!confForm.title || !confForm.startDate || !confForm.endDate) {
          return alert("Title and Dates are required.");
      }
      
      const id = `conf_${Date.now()}`;
      const dates = `${confForm.startDate} ~ ${confForm.endDate}`;
      
      try {
          await set(ref(rtdb, `conferences/${id}`), { 
              id, 
              title: confForm.title, 
              accessCode: confForm.accessCode, 
              dates,
              startDate: confForm.startDate,
              endDate: confForm.endDate
          });
          
          setIsCreatingConf(false);
          setConfForm({ id: "", title: "", accessCode: "", startDate: "", endDate: "" });
          alert("Conference Created Successfully!");
} catch (error: unknown) {
          console.error("Create Failed:", error);
          const message = error instanceof Error ? error.message : 'Unknown error';
          alert("Create Failed: " + message);
      }
  };

  const handleCreateProject = async () => {
      if (!projForm.slug || !projForm.name) return alert("Slug and Name required");
      if (!selectedConfId) return alert("No Conference Selected");

      const projectId = projForm.slug.replace(/[^a-z0-9-_]/gi, '').toLowerCase();
      const projectRef = ref(rtdb, `projects/${projectId}`);
      
      const snap = await get(projectRef);
      if (snap.exists()) return alert("Project ID exists!");

      await set(child(projectRef, 'settings'), {
          ...projForm,
          slug: projectId,
          conferenceId: selectedConfId
      });

      // Init State
      await set(child(projectRef, 'state'), {
          bufferText: "",
          bufferIds: [],
          lastGeminiTime: 0
      });

      setIsCreatingProj(false);
      alert("Project Created!");
  };

  const handleDeleteProject = async (projectId: string) => {
      if (!window.confirm(`PERMANENTLY DELETE project "${projectId}"? All data will be lost.`)) return;
      await remove(ref(rtdb, `projects/${projectId}`));
      
      // Refresh list
      setAllProjects(prev => prev.filter(p => p.id !== projectId));
      setConfProjects(prev => prev.filter(p => p.slug !== projectId));
  };

  const handleDeleteConference = async (confId: string) => {
      if (!window.confirm(`PERMANENTLY DELETE conference? All related projects will also be affected.`)) return;
      await remove(ref(rtdb, `conferences/${confId}`));
      
      // Refresh list
      setConferences(prev => prev.filter(c => c.id !== confId));
      if (selectedConfId === confId) setSelectedConfId(null);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-200 p-8 font-sans selection:bg-blue-500/30">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8 border-b border-white/5 pb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-100">
                Conference Platform
            </h1>
        </div>

        {/* --- View: Conferences --- */}
        {view === 'conferences' && (
            <div className="flex flex-col md:flex-row gap-6 h-[calc(100vh-200px)]">
                {/* Left: Conference List */}
                <div className="w-full md:w-1/3 bg-[#111111] rounded-xl flex flex-col border border-white/5 shadow-xl">
                    <div className="flex justify-between items-center p-5 border-b border-white/5">
                        <h2 className="text-sm font-medium text-gray-300 uppercase tracking-widest">Conferences</h2>
                        <button onClick={() => setIsCreatingConf(true)} className="text-xs bg-white text-black px-3 py-1.5 rounded-md hover:bg-gray-200 font-medium transition-colors">+ New</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {conferences.map(c => (
                            <div 
                                key={c.id} 
                                onClick={() => setSelectedConfId(c.id)}
                                className={`p-4 rounded-lg cursor-pointer transition-all ${selectedConfId === c.id ? 'bg-white/10 border border-white/20' : 'bg-[#1a1a1a] hover:bg-[#222] border border-transparent'}`}
                            >
                                <div className="font-medium text-gray-100">{c.title}</div>
                                <div className="text-xs text-gray-500 flex justify-between mt-1">
                                    <span className="font-mono">Code: {c.accessCode}</span>
                                    <span>{c.dates}</span>
                                </div>
                                <div className="mt-3 flex gap-2">
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); setShowQR(c.id); }} 
                                        className="text-[10px] bg-white/5 hover:bg-white/10 text-gray-300 px-2 py-1 rounded transition-colors"
                                    >
                                        QR
                                    </button>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); handleDeleteConference(c.id); }}
                                        className="text-[10px] bg-red-500/10 hover:bg-red-500/20 text-red-400 px-2 py-1 rounded transition-colors"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                        {conferences.length === 0 && (
                            <div className="text-center text-sm text-gray-500 py-8">No conferences found.</div>
                        )}
                    </div>
                </div>

                {/* Right: Project List (Filtered) */}
                <div className="flex-1 bg-[#111111] rounded-xl p-6 border border-white/5 shadow-xl flex flex-col">
                    {selectedConfId ? (
                        <>
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-sm font-medium text-gray-300 uppercase tracking-widest">Halls</h2>
                                <button onClick={() => setIsCreatingProj(true)} className="bg-white text-black px-4 py-1.5 rounded-md text-xs font-medium hover:bg-gray-200 transition-colors">+ Add Hall</button>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto">
                                {confProjects.map(p => (
                                    <div key={p.slug} className="bg-[#1a1a1a] p-5 rounded-lg border border-white/5 hover:border-white/20 transition-all relative group">
                                        <div onClick={() => navigate(`/p/${p.slug}/admin`)} className="cursor-pointer">
                                            <h3 className="text-sm font-medium text-gray-100 group-hover:text-white">{p.name}</h3>
                                            <div className="text-[10px] text-gray-500 font-mono mt-1">ID: {p.slug}</div>
                                            <div className="mt-3 flex gap-1.5">
                                                {p.targetLanguages.map(l => <span key={l} className="px-2 py-0.5 bg-white/5 rounded text-[10px] uppercase font-medium text-gray-400">{l}</span>)}
                                            </div>
                                        </div>
                                        <button 
                                            onClick={() => handleDeleteProject(p.slug)}
                                            className="absolute top-3 right-3 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                                        </button>
                                    </div>
                                ))}
                                {confProjects.length === 0 && <div className="text-sm text-gray-500 py-8 col-span-2">No halls in this conference.</div>}
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-4">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><line x1="3" x2="21" y1="9" y2="9"></line><line x1="9" x2="9" y1="21" y2="9"></line></svg>
                            <span className="text-sm">Select a conference to view halls</span>
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* --- Modals --- */}
        {isCreatingConf && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
                <div className="bg-[#111111] p-6 rounded-xl w-full max-w-md space-y-5 border border-white/10 shadow-2xl">
                    <h2 className="text-lg font-medium text-gray-100">Create Conference</h2>
                    <div className="space-y-3">
                        <input className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-white/30 outline-none text-gray-100 placeholder-gray-600" placeholder="Conference Title" value={confForm.title} onChange={e => setConfForm({...confForm, title: e.target.value})} />
                        <input className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:ring-1 focus:ring-white/30 outline-none text-gray-100 placeholder-gray-600" placeholder="Access Code (Optional)" value={confForm.accessCode} onChange={e => setConfForm({...confForm, accessCode: e.target.value})} />
                        <div className="flex gap-3">
                            <div className="flex-1 space-y-1">
                                <label className="text-[10px] text-gray-500 uppercase tracking-wider">Start Date</label>
                                <input type="date" className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 outline-none focus:ring-1 focus:ring-white/30" value={confForm.startDate} onChange={e => setConfForm({...confForm, startDate: e.target.value})} />
                            </div>
                            <div className="flex-1 space-y-1">
                                <label className="text-[10px] text-gray-500 uppercase tracking-wider">End Date</label>
                                <input type="date" className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 outline-none focus:ring-1 focus:ring-white/30" value={confForm.endDate} onChange={e => setConfForm({...confForm, endDate: e.target.value})} />
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-end gap-3 pt-2 border-t border-white/5">
                        <button onClick={() => setIsCreatingConf(false)} className="px-4 py-2 text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
                        <button onClick={handleCreateConf} className="px-4 py-2 bg-white text-black rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors">Create</button>
                    </div>
                </div>
            </div>
        )}

        {isCreatingProj && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
                <div className="bg-[#111111] p-6 rounded-xl w-full max-w-md space-y-5 border border-white/10 shadow-2xl">
                    <h2 className="text-lg font-medium text-gray-100">Add Hall</h2>
                    <div className="space-y-3">
                        <input className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-white/30 outline-none text-gray-100 placeholder-gray-600" placeholder="Hall Name (e.g. Main Hall)" value={projForm.name} onChange={e => setProjForm({...projForm, name: e.target.value})} />
                        <input className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:ring-1 focus:ring-white/30 outline-none text-gray-100 placeholder-gray-600" placeholder="Unique ID (e.g. main-hall)" value={projForm.slug} onChange={e => setProjForm({...projForm, slug: e.target.value})} />
                    </div>
                    <div className="flex justify-end gap-3 pt-2 border-t border-white/5">
                        <button onClick={() => setIsCreatingProj(false)} className="px-4 py-2 text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
                        <button onClick={handleCreateProject} className="px-4 py-2 bg-white text-black rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors">Add</button>
                    </div>
                </div>
            </div>
        )}

        {/* --- QR Modal --- */}
        {showQR && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200" onClick={() => setShowQR(null)}>
                <div className="bg-white p-8 rounded-2xl flex flex-col items-center gap-6 shadow-2xl" onClick={e => e.stopPropagation()}>
                    <h2 className="text-black text-lg font-semibold tracking-tight">Access QR Code</h2>
                    <div className="p-4 bg-white rounded-xl border border-gray-100">
                        <QRCodeSVG 
                            value={`${window.location.origin}/?conf=${showQR}`} 
                            size={200}
                            level={"H"}
                        />
                    </div>
                    <div className="text-center w-full">
                        <div className="font-mono text-xs text-gray-500 bg-gray-50 p-3 rounded-lg border border-gray-100 w-full truncate">
                            {`${window.location.origin}/?conf=${showQR}`}
                        </div>
                    </div>
                    <button onClick={() => setShowQR(null)} className="text-sm text-gray-500 hover:text-black font-medium transition-colors">Close</button>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

export default AdminLanding;
