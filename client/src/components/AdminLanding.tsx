import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { rtdb } from '../firebase';
import { ref, get, set, remove } from 'firebase/database';
import type { Conference, ProjectSettings } from '../types';

interface ProjectListItem extends ProjectSettings {
  id: string;
  confId?: string;
}

const AdminLanding: React.FC = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<'conferences' | 'cleanup'>('conferences');
  
  // --- Conferences View State ---
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [selectedConfId, setSelectedConfId] = useState<string | null>(null);
  const [confProjects, setConfProjects] = useState<ProjectSettings[]>([]);
  const [isCreatingConf, setIsCreatingConf] = useState(false);
  const [isCreatingProj, setIsCreatingProj] = useState(false);
  const [showQR, setShowQR] = useState<string | null>(null);
  
  const [confForm, setConfForm] = useState({
      id: "", title: "", startDate: "", endDate: ""
  });
  
  const [projForm, setProjForm] = useState<ProjectSettings>({
    name: "",
    slug: "",
    date: new Date().toISOString().split('T')[0],
    targetLanguages: ["en"],
    parkingMessage: "The session will start shortly.",
    conferenceId: ""
  });

  // --- Cleanup View State ---
  const [allProjects, setAllProjects] = useState<ProjectListItem[]>([]);

  useEffect(() => {
      loadConferences();
      loadAllProjects();
  }, []);

  useEffect(() => {
      if (selectedConfId) {
          const filtered = allProjects.filter(p => p.confId === selectedConfId);
          setConfProjects(filtered);
      } else {
          setConfProjects([]);
      }
  }, [selectedConfId, allProjects]);

  const loadConferences = async () => {
      const snap = await get(ref(rtdb, 'conferences'));
      if (snap.exists()) {
          const data = snap.val();
          const list = Object.keys(data).map(k => data[k] as Conference);
          setConferences(list);
      } else {
          setConferences([]);
      }
  };

  const loadAllProjects = async () => {
      const snap = await get(ref(rtdb, 'projects'));
      if (snap.exists()) {
          const data = snap.val();
          const list = Object.keys(data).map(k => {
              const s = data[k].settings || {};
              return { ...s, id: k, confId: s.conferenceId } as ProjectListItem;
          });
          setAllProjects(list);
      } else {
          setAllProjects([]);
      }
  };

  const handleCreateConf = async () => {
      if (!confForm.title || !confForm.startDate || !confForm.endDate) return alert("Fill all fields");
      const id = "conf_" + Date.now();
      const dates = `${confForm.startDate} ~ ${confForm.endDate}`;
      
      try {
          await set(ref(rtdb, `conferences/${id}`), { 
              id, 
              title: confForm.title, 
              dates,
              startDate: confForm.startDate,
              endDate: confForm.endDate
          });
          
          setIsCreatingConf(false);
          setConfForm({ id: "", title: "", startDate: "", endDate: "" });
          alert("Conference Created Successfully!");
          loadConferences();
      } catch (e) {
          console.error(e);
          alert("Failed to create conference");
      }
  };

  const handleDeleteConference = async (id: string) => {
      if (!window.confirm("Are you sure you want to delete this conference AND all its projects?")) return;
      try {
          const projsToDelete = allProjects.filter(p => p.confId === id);
          for (const p of projsToDelete) {
              await remove(ref(rtdb, `projects/${p.id}`));
          }
          await remove(ref(rtdb, `conferences/${id}`));
          if (selectedConfId === id) setSelectedConfId(null);
          loadConferences();
          loadAllProjects();
      } catch (e) {
          console.error(e);
          alert("Delete failed");
      }
  };

  const handleCreateProject = async () => {
      if (!projForm.name || !projForm.slug || !selectedConfId) return alert("Fill required fields");
      
      const projectId = projForm.slug.replace(/[^a-z0-9-_]/gi, '').toLowerCase();
      const projectRef = ref(rtdb, `projects/${projectId}`);
      
      try {
          const snap = await get(projectRef);
          if (snap.exists()) {
              return alert("Slug already exists! Choose another.");
          }
          
          await set(ref(rtdb, `projects/${projectId}/settings`), {
              ...projForm,
              slug: projectId,
              conferenceId: selectedConfId
          });
          await set(ref(rtdb, `projects/${projectId}/state`), {
              bufferText: "",
              bufferIds: []
          });
          
          setIsCreatingProj(false);
          setProjForm(prev => ({...prev, name: "", slug: ""}));
          alert("Project created successfully!");
          loadAllProjects();
      } catch (e) {
          console.error(e);
          alert("Failed to create project");
      }
  };

  const handleDeleteProject = async (id: string) => {
      if (!window.confirm("Are you sure you want to delete this project?")) return;
      try {
          await remove(ref(rtdb, `projects/${id}`));
          loadAllProjects();
      } catch (e) {
          console.error(e);
          alert("Delete failed");
      }
  };

  return (
      <div className="min-h-screen bg-[#f9fafb] dark:bg-[#111827] text-[#111827] dark:text-[#f9fafb] font-sans flex flex-col">
          {/* Header */}
          <header className="border-b border-[#e5e7eb] dark:border-[#374151] bg-[#ffffff] dark:bg-[#1f2937] px-6 py-4 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#1e3a5f] text-[#f9fafb] flex items-center justify-center font-bold text-sm shadow-sm">HC</div>
                  <h1 className="font-semibold tracking-wide text-sm uppercase text-[#6b7280] dark:text-[#9ca3af]">Admin Terminal</h1>
              </div>
              <div className="flex gap-2">
                  <button 
                      onClick={() => setView('conferences')} 
                      className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors border ${view === 'conferences' ? 'bg-[#1e3a5f] text-[#f9fafb] border-[#1e3a5f]' : 'bg-transparent text-[#6b7280] dark:text-[#9ca3af] border-[#e5e7eb] dark:border-[#374151] hover:bg-[#e5e7eb] dark:hover:bg-[#374151]'}`}
                  >
                      Conferences
                  </button>
                  <button 
                      onClick={() => setView('cleanup')} 
                      className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors border ${view === 'cleanup' ? 'bg-red-600 text-white border-red-600' : 'bg-transparent text-[#6b7280] dark:text-[#9ca3af] border-[#e5e7eb] dark:border-[#374151] hover:bg-[#e5e7eb] dark:hover:bg-[#374151]'}`}
                  >
                      Cleanup
                  </button>
              </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 flex overflow-hidden">
              {view === 'conferences' && (
                  <div className="flex w-full">
                      {/* Left Sidebar: Conferences */}
                      <div className="w-1/3 max-w-sm border-r border-[#e5e7eb] dark:border-[#374151] bg-[#ffffff] dark:bg-[#1f2937] flex flex-col">
                          <div className="p-4 border-b border-[#e5e7eb] dark:border-[#374151] flex justify-between items-center">
                              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#6b7280]">Conferences</h2>
                              <button onClick={() => setIsCreatingConf(true)} className="text-xs bg-[#1e3a5f] hover:bg-[#24456f] text-[#f9fafb] px-3 py-1 rounded-xl transition-colors font-medium">
                                  + New
                              </button>
                          </div>
                          <div className="flex-1 overflow-y-auto p-3 space-y-2">
                              {conferences.map(c => (
                                  <div 
                                      key={c.id} 
                                      onClick={() => setSelectedConfId(c.id)}
                                      className={`p-4 rounded-2xl cursor-pointer border transition-colors ${selectedConfId === c.id ? 'bg-[#1e3a5f]/10 border-[#1e3a5f]' : 'bg-[#f9fafb] dark:bg-[#111827] border-[#e5e7eb] dark:border-[#374151] hover:border-[#9ca3af] dark:hover:border-[#6b7280]'}`}
                                  >
                                      <div className="font-semibold text-sm mb-1">{c.title}</div>
                                      <div className="text-xs text-[#6b7280]">{c.dates}</div>
                                      <div className="mt-3 flex gap-2">
                                          <button 
                                              onClick={(e) => { e.stopPropagation(); setShowQR(c.id); }} 
                                              className="text-[10px] uppercase font-bold text-[#1e3a5f] dark:text-[#d4af37] border border-[#1e3a5f]/20 dark:border-[#d4af37]/30 px-2 py-1 rounded-xl hover:bg-[#1e3a5f]/10 dark:hover:bg-[#d4af37]/10 transition-colors"
                                          >
                                              QR Code
                                          </button>
                                          <button 
                                              onClick={(e) => { e.stopPropagation(); handleDeleteConference(c.id); }}
                                              className="text-[10px] uppercase font-bold text-red-600 dark:text-red-400 border border-red-600/20 dark:border-red-400/30 px-2 py-1 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ml-auto"
                                          >
                                              Delete
                                          </button>
                                      </div>
                                  </div>
                              ))}
                              {conferences.length === 0 && (
                                  <div className="text-xs text-[#6b7280] p-4 text-center">No conferences found.</div>
                              )}
                          </div>
                      </div>

                      {/* Right Panel: Projects */}
                      <div className="flex-1 bg-[#f9fafb] dark:bg-[#111827] flex flex-col">
                          {selectedConfId ? (
                              <>
                                  <div className="p-6 border-b border-[#e5e7eb] dark:border-[#374151] flex justify-between items-center bg-[#ffffff] dark:bg-[#1f2937]">
                                      <h2 className="text-lg font-semibold">Associated Halls</h2>
                                      <button onClick={() => setIsCreatingProj(true)} className="bg-[#d4af37] text-[#111827] px-4 py-1.5 rounded-xl text-sm font-bold hover:bg-[#b5952f] transition-colors">
                                          + Add Hall
                                      </button>
                                  </div>
                                  <div className="p-6 flex-1 overflow-y-auto">
                                      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                                          {confProjects.map(p => (
                                              <div key={p.slug} className="bg-[#ffffff] dark:bg-[#1f2937] p-5 rounded-2xl border border-[#e5e7eb] dark:border-[#374151] hover:border-[#1e3a5f] dark:hover:border-[#d4af37] transition-colors group relative flex flex-col justify-between">
                                                  <div onClick={() => navigate(`/p/${p.slug}/admin`)} className="cursor-pointer">
                                                      <h3 className="font-bold text-base mb-1 group-hover:text-[#1e3a5f] dark:group-hover:text-[#d4af37] transition-colors">{p.name}</h3>
                                                      <div className="text-xs text-[#6b7280] font-mono mb-3">{p.slug}</div>
                                                      <div className="flex gap-1 flex-wrap">
                                                          {p.targetLanguages.map(l => <span key={l} className="px-2 py-0.5 bg-[#f3f4f6] dark:bg-[#374151] text-[#6b7280] dark:text-[#d1d5db] rounded-xl text-[10px] font-bold uppercase">{l}</span>)}
                                                      </div>
                                                  </div>
                                                  <div className="mt-4 pt-4 border-t border-[#e5e7eb] dark:border-[#374151] flex justify-between items-center">
                                                      <span className="text-xs font-semibold text-[#1e3a5f] dark:text-[#d4af37] opacity-0 group-hover:opacity-100 transition-opacity">Open Dashboard →</span>
                                                      <button 
                                                          onClick={() => handleDeleteProject(p.slug)}
                                                          className="text-[#6b7280] hover:text-red-600 dark:hover:text-red-400 p-1"
                                                      >
                                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                      </button>
                                                  </div>
                                              </div>
                                          ))}
                                          {confProjects.length === 0 && <div className="text-[#6b7280] text-sm">No halls created yet.</div>}
                                      </div>
                                  </div>
                              </>
                          ) : (
                              <div className="flex-1 flex items-center justify-center text-[#6b7280] text-sm">
                                  Select a conference from the left panel to manage its halls.
                              </div>
                          )}
                      </div>
                  </div>
              )}

              {view === 'cleanup' && (
                  <div className="p-8 w-full overflow-y-auto">
                      <div className="max-w-6xl mx-auto">
                          <h2 className="text-2xl font-bold mb-2">Ghost Data Cleanup</h2>
                          <p className="text-sm text-[#6b7280] mb-8">Review all database projects and remove unlinked or obsolete halls.</p>
                          
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                              {allProjects.map(p => (
                                  <div key={p.id} className="bg-[#ffffff] dark:bg-[#1f2937] p-4 rounded-2xl border border-[#e5e7eb] dark:border-[#374151] relative group flex flex-col">
                                      <h3 className="font-semibold text-sm mb-1">{p.name}</h3>
                                      <div className="text-[10px] text-[#6b7280] font-mono mb-3">{p.id}</div>
                                      <div className="mt-auto flex justify-between items-center">
                                          {p.confId ? (
                                              <span className="text-[10px] uppercase font-bold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-xl">Linked</span>
                                          ) : (
                                              <span className="text-[10px] uppercase font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded-xl">Orphan</span>
                                          )}
                                          <button 
                                              onClick={() => handleDeleteProject(p.id)}
                                              className="text-[10px] uppercase font-bold text-red-600 dark:text-red-400 hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                                          >
                                              Delete
                                          </button>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              )}
          </main>

          {/* --- Modals --- */}
          {isCreatingConf && (
              <div className="fixed inset-0 bg-[#111827]/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                  <div className="bg-[#ffffff] dark:bg-[#1f2937] p-6 rounded-2xl w-full max-w-sm border border-[#e5e7eb] dark:border-[#374151] shadow-2xl">
                      <h2 className="text-lg font-bold mb-4">Create Conference</h2>
                      <div className="space-y-4">
                          <div>
                              <label className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-1 block">Title</label>
                              <input className="w-full bg-[#f9fafb] dark:bg-[#111827] border border-[#e5e7eb] dark:border-[#374151] focus:border-[#1e3a5f] dark:focus:border-[#d4af37] outline-none p-2.5 rounded-xl text-sm transition-colors" placeholder="e.g. 2025 Global Summit" value={confForm.title} onChange={e => setConfForm({...confForm, title: e.target.value})} />
                          </div>
                          <div className="flex gap-4">
                              <div className="flex-1">
                                  <label className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-1 block">Start Date</label>
                                  <input type="date" className="w-full bg-[#f9fafb] dark:bg-[#111827] border border-[#e5e7eb] dark:border-[#374151] outline-none p-2.5 rounded-xl text-sm" value={confForm.startDate} onChange={e => setConfForm({...confForm, startDate: e.target.value})} />
                              </div>
                              <div className="flex-1">
                                  <label className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-1 block">End Date</label>
                                  <input type="date" className="w-full bg-[#f9fafb] dark:bg-[#111827] border border-[#e5e7eb] dark:border-[#374151] outline-none p-2.5 rounded-xl text-sm" value={confForm.endDate} onChange={e => setConfForm({...confForm, endDate: e.target.value})} />
                              </div>
                          </div>
                      </div>
                      <div className="flex justify-end gap-2 mt-6">
                          <button onClick={() => setIsCreatingConf(false)} className="px-4 py-2 text-sm font-semibold text-[#6b7280] hover:text-[#111827] dark:hover:text-[#f9fafb]">Cancel</button>
                          <button onClick={handleCreateConf} className="px-4 py-2 bg-[#1e3a5f] hover:bg-[#24456f] text-[#ffffff] rounded-xl text-sm font-bold">Create</button>
                      </div>
                  </div>
              </div>
          )}

          {isCreatingProj && (
              <div className="fixed inset-0 bg-[#111827]/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                  <div className="bg-[#ffffff] dark:bg-[#1f2937] p-6 rounded-2xl w-full max-w-sm border border-[#e5e7eb] dark:border-[#374151] shadow-2xl">
                      <h2 className="text-lg font-bold mb-4">Add Hall</h2>
                      <div className="space-y-4">
                          <div>
                              <label className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-1 block">Hall Name</label>
                              <input className="w-full bg-[#f9fafb] dark:bg-[#111827] border border-[#e5e7eb] dark:border-[#374151] focus:border-[#1e3a5f] dark:focus:border-[#d4af37] outline-none p-2.5 rounded-xl text-sm" placeholder="e.g. Main Hall A" value={projForm.name} onChange={e => setProjForm({...projForm, name: e.target.value})} />
                          </div>
                          <div>
                              <label className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-1 block">Unique Slug</label>
                              <input className="w-full bg-[#f9fafb] dark:bg-[#111827] border border-[#e5e7eb] dark:border-[#374151] focus:border-[#1e3a5f] dark:focus:border-[#d4af37] outline-none p-2.5 rounded-xl text-sm font-mono" placeholder="e.g. main-hall-a" value={projForm.slug} onChange={e => setProjForm({...projForm, slug: e.target.value})} />
                          </div>
                      </div>
                      <div className="flex justify-end gap-2 mt-6">
                          <button onClick={() => setIsCreatingProj(false)} className="px-4 py-2 text-sm font-semibold text-[#6b7280] hover:text-[#111827] dark:hover:text-[#f9fafb]">Cancel</button>
                          <button onClick={handleCreateProject} className="px-4 py-2 bg-[#d4af37] hover:bg-[#b5952f] text-[#111827] rounded-xl text-sm font-bold">Create</button>
                      </div>
                  </div>
              </div>
          )}

          {/* --- QR Modal --- */}
          {showQR && (
              <div className="fixed inset-0 bg-[#111827]/50 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setShowQR(null)}>
                  <div className="bg-[#ffffff] dark:bg-[#1f2937] p-8 rounded-2xl flex flex-col items-center shadow-2xl border border-[#e5e7eb] dark:border-[#374151]" onClick={e => e.stopPropagation()}>
                      <h2 className="text-lg font-bold mb-2">QR Code URL</h2>
                      <div className="text-sm text-[#6b7280] mb-4">Scan or copy to join directly</div>
                      <div className="font-mono text-xs bg-[#f3f4f6] dark:bg-[#111827] p-3 rounded-xl border border-[#e5e7eb] dark:border-[#374151] select-all">
                          {`${window.location.origin}/?conf=${showQR}`}
                      </div>
                      <button onClick={() => setShowQR(null)} className="mt-6 text-sm font-semibold text-[#1e3a5f] dark:text-[#d4af37]">Close</button>
                  </div>
              </div>
          )}
      </div>
  );
};

export default AdminLanding;
