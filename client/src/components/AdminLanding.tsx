import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { rtdb } from '../firebase';
import { ref, set, get, child, remove } from 'firebase/database';
import type { ProjectSettings, Conference } from '../types';
import { QRCodeSVG } from 'qrcode.react';

const AdminLanding: React.FC = () => {
  const navigate = useNavigate();
  
  // --- State ---
  const [view, setView] = useState<'conferences' | 'cleanup'>('conferences');
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [selectedConfId, setSelectedConfId] = useState<string | null>(null);
  const [showQR, setShowQR] = useState<string | null>(null); // Conf ID for QR modal
  const [showProjQR, setShowProjQR] = useState<string | null>(null); // Proj Slug for QR modal
  
  // Projects for the selected conference
  const [confProjects, setConfProjects] = useState<ProjectSettings[]>([]);
  
  // All Projects (for Cleanup)
  const [allProjects, setAllProjects] = useState<{id: string, name: string, confId?: string}[]>([]);

  // Forms
  const [isCreatingConf, setIsCreatingConf] = useState(false);
  const [isCreatingProj, setIsCreatingProj] = useState(false);
  
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
              dates,
              startDate: confForm.startDate,
              endDate: confForm.endDate
          });
          
          setIsCreatingConf(false);
          setConfForm({ id: "", title: "", startDate: "", endDate: "" });
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
          bufferIds: []
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
      <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
              HONG COMM. Conference Admin Platform
          </h1>
          <div className="flex gap-4">
              <button 
                  onClick={() => setView('conferences')} 
                  className={`px-4 py-2 rounded text-sm font-bold transition-all ${view === 'conferences' ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'}`}
              >
                  Conferences
              </button>
              <button 
                  onClick={() => setView('cleanup')} 
                  className={`px-4 py-2 rounded text-sm font-bold transition-all flex items-center gap-2 ${view === 'cleanup' ? 'bg-red-600 text-white shadow-lg' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'}`}
              >
                  <span>👻</span> Cleanup
              </button>
          </div>
      </div>

      {/* --- View: Conferences --- */}
      {view === 'conferences' && (
          <div className="flex gap-8 h-[calc(100vh-200px)]">
              {/* Left: Conference List */}
              <div className="w-1/3 bg-gray-800 rounded-lg p-4 flex flex-col border border-gray-700">
                  <div className="flex justify-between items-center mb-4">
                      <h2 className="text-xl font-bold">Conferences</h2>
                      <button onClick={() => setIsCreatingConf(true)} className="text-sm bg-blue-600 px-3 py-1 rounded hover:bg-blue-500">+ New</button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2">
                      {conferences.map(c => (
                          <div 
                              key={c.id} 
                              onClick={() => setSelectedConfId(c.id)}
                              className={`p-4 rounded cursor-pointer transition-all ${selectedConfId === c.id ? 'bg-blue-900/50 border border-blue-500' : 'bg-gray-700 hover:bg-gray-600'}`}
                          >
                              <div className="font-bold text-lg">{c.title}</div>
                              <div className="text-sm text-gray-400 flex justify-between mt-2">
                                  <span>{c.dates}</span>
                              </div>
                              <div className="mt-2 flex gap-2">
                                  <button 
                                      onClick={(e) => { e.stopPropagation(); setShowQR(c.id); }} 
                                      className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded flex items-center gap-1"
                                  >
                                      📱 QR Code
                                  </button>
                                  {/* Edit button placeholder - logic can be added later */}
                                  <button className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded">✏️ Edit</button>
                                  <button 
                                      onClick={(e) => { e.stopPropagation(); handleDeleteConference(c.id); }}
                                      className="text-xs bg-red-600 hover:bg-red-500 px-2 py-1 rounded"
                                  >
                                      🗑️ Delete
                                  </button>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>

              {/* Right: Project List (Filtered) */}
              <div className="flex-1 bg-gray-800 rounded-lg p-6 border border-gray-700 flex flex-col">
                  {selectedConfId ? (
                      <>
                          <div className="flex justify-between items-center mb-6">
                              <h2 className="text-2xl font-bold">Projects (Halls)</h2>
                              <button onClick={() => setIsCreatingProj(true)} className="bg-purple-600 px-4 py-2 rounded font-bold hover:bg-purple-500">+ Add Hall</button>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto">
                              {confProjects.map(p => (
                                  <div key={p.slug} className="bg-gray-700 p-4 rounded border border-gray-600 hover:border-purple-500 transition-all relative group">
                                      <div onClick={() => navigate(`/p/${p.slug}/admin`)} className="cursor-pointer">
                                          <h3 className="text-lg font-bold">{p.name}</h3>
                                          <div className="text-xs text-gray-400 mt-1">ID: {p.slug}</div>
                                          <div className="mt-2 flex gap-1">
                                              {p.targetLanguages.map(l => <span key={l} className="px-1.5 py-0.5 bg-gray-600 rounded text-[10px] uppercase">{l}</span>)}
                                          </div>
                                      </div>
                                      <button 
                                          onClick={() => handleDeleteProject(p.slug)}
                                          className="absolute top-2 right-2 text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                      >
                                          🗑️
                                      </button>
                                      <button 
                                          onClick={(e) => { e.stopPropagation(); setShowProjQR(p.slug); }}
                                          className="absolute top-2 right-8 text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                          title="Show QR Code"
                                      >
                                          📱
                                      </button>
                                  </div>
                              ))}
                              {confProjects.length === 0 && <div className="text-gray-500 italic">No projects in this conference.</div>}
                          </div>
                      </>
                  ) : (
                      <div className="flex items-center justify-center h-full text-gray-500 text-lg">
                          Select a Conference to manage Projects
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* --- View: Cleanup --- */}
      {view === 'cleanup' && (
          <div className="bg-gray-800 rounded-lg p-6 border border-red-900/30">
              <h2 className="text-2xl font-bold mb-4 text-red-400">👻 Ghost Data Cleanup</h2>
              <p className="text-gray-400 mb-6">These are ALL projects found in the database. You can permanently delete unused or "ghost" projects here.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {allProjects.map(p => (
                      <div key={p.id} className="bg-gray-900 p-4 rounded border border-gray-700 relative group">
                          <h3 className="font-bold text-gray-200">{p.name}</h3>
                          <div className="text-xs text-gray-500 font-mono mt-1">{p.id}</div>
                          <div className="mt-2">
                              {p.confId ? (
                                  <span className="text-xs bg-green-900 text-green-300 px-2 py-1 rounded">Linked</span>
                              ) : (
                                  <span className="text-xs bg-red-900 text-red-300 px-2 py-1 rounded">Orphan (Ghost?)</span>
                              )}
                          </div>
                          <button 
                              onClick={() => handleDeleteProject(p.id)}
                              className="absolute top-2 right-2 bg-red-600 hover:bg-red-500 text-white p-1 rounded text-xs shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                              Delete
                          </button>
                      </div>
                  ))}
              </div>
          </div>
      )}

      {/* --- Modals --- */}
      {isCreatingConf && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
              <div className="bg-gray-800 p-6 rounded-lg w-full max-w-md space-y-4 border border-gray-600">
                  <h2 className="text-xl font-bold">Create Conference</h2>
                  <input className="w-full bg-gray-700 p-2 rounded" placeholder="Conference Title" value={confForm.title} onChange={e => setConfForm({...confForm, title: e.target.value})} />
                  <div className="flex gap-2">
                      <div className="flex-1">
                          <label className="text-xs text-gray-400 block mb-1">Start Date</label>
                          <input type="date" className="w-full bg-gray-700 p-2 rounded" value={confForm.startDate} onChange={e => setConfForm({...confForm, startDate: e.target.value})} />
                      </div>
                      <div className="flex-1">
                          <label className="text-xs text-gray-400 block mb-1">End Date</label>
                          <input type="date" className="w-full bg-gray-700 p-2 rounded" value={confForm.endDate} onChange={e => setConfForm({...confForm, endDate: e.target.value})} />
                      </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                      <button onClick={() => setIsCreatingConf(false)} className="px-4 py-2 text-gray-400">Cancel</button>
                      <button onClick={handleCreateConf} className="px-4 py-2 bg-blue-600 rounded font-bold">Create</button>
                  </div>
              </div>
          </div>
      )}

      {isCreatingProj && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
              <div className="bg-gray-800 p-6 rounded-lg w-full max-w-md space-y-4 border border-gray-600">
                  <h2 className="text-xl font-bold">Add Project (Hall)</h2>
                  <input className="w-full bg-gray-700 p-2 rounded" placeholder="Hall Name (e.g. Hanwha Hall)" value={projForm.name} onChange={e => setProjForm({...projForm, name: e.target.value})} />
                  <input className="w-full bg-gray-700 p-2 rounded" placeholder="Unique Slug (ID)" value={projForm.slug} onChange={e => setProjForm({...projForm, slug: e.target.value})} />
                  <div className="flex justify-end gap-2 mt-4">
                      <button onClick={() => setIsCreatingProj(false)} className="px-4 py-2 text-gray-400">Cancel</button>
                      <button onClick={handleCreateProject} className="px-4 py-2 bg-purple-600 rounded font-bold">Create</button>
                  </div>
              </div>
          </div>
      )}

      {/* --- QR Modal --- */}
      {showQR && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={() => setShowQR(null)}>
              <div className="bg-white p-8 rounded-lg flex flex-col items-center gap-4" onClick={e => e.stopPropagation()}>
                  <h2 className="text-black text-xl font-bold">Conference Access QR</h2>
                  <QRCodeSVG 
                      value={`${window.location.origin}/?conf=${showQR}`} 
                      size={256}
                      level={"H"}
                      includeMargin={true}
                  />
                  <div className="text-black text-center">
                      <div className="text-sm text-gray-500">Scan to join directly</div>
                      <div className="font-mono text-xs mt-2 bg-gray-100 p-2 rounded">
                          {`${window.location.origin}/?conf=${showQR}`}
                      </div>
                  </div>
                  <button onClick={() => setShowQR(null)} className="text-gray-500 hover:text-black">Close</button>
              </div>
          </div>
      )}

      {showProjQR && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={() => setShowProjQR(null)}>
              <div className="bg-white p-8 rounded-lg flex flex-col items-center gap-4" onClick={e => e.stopPropagation()}>
                  <h2 className="text-black text-xl font-bold">Hall Access QR</h2>
                  <QRCodeSVG 
                      value={`${window.location.origin}/p/${showProjQR}`} 
                      size={256}
                      level={"H"}
                      includeMargin={true}
                  />
                  <div className="text-black text-center">
                      <div className="text-sm text-gray-500">Scan to join this hall directly</div>
                      <div className="font-mono text-xs mt-2 bg-gray-100 p-2 rounded">
                          {`${window.location.origin}/p/${showProjQR}`}
                      </div>
                  </div>
                  <button onClick={() => setShowProjQR(null)} className="text-gray-500 hover:text-black">Close</button>
              </div>
          </div>
      )}

    </div>
  );
};

export default AdminLanding;
