import React, { useState, useEffect } from 'react';
import { collection, addDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import type { Project } from '../types/schema';
import { Plus, Settings, Calendar, Clock, Lock, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
 
import SettingsModal from '../components/SettingsModal';

const Projects: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  

  // Form State
  const [formData, setFormData] = useState<Partial<Project>>({
    name: '',
    accessCode: '',
    schedule: { date: '', startTime: '', endTime: '' },
    settings: { 
      glossaries: [], 
      theme: {},
      appearance: {
        backgroundColor: '#000000',
        textColor: '#ffffff',
        fontSize: 'medium',
        fontFamily: 'sans-serif',
        opacity: 0.8
      }
    }
  });

  const fetchProjects = async () => {
    const querySnapshot = await getDocs(collection(db, 'projects'));
    const projectsList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
    setProjects(projectsList);
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name.includes('.')) {
      const [parent, child] = name.split('.');
      setFormData(prev => ({
        ...prev,
        [parent]: { ...(prev as any)[parent], [child]: value }
      }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const newProject: any = {
        ...formData,
        logoUrl: '', // Logo can be added in settings
        status: 'scheduled',
        settings: formData.settings || { 
          glossaries: [], 
          theme: {},
          appearance: {
            backgroundColor: '#000000',
            textColor: '#ffffff',
            fontSize: 'medium',
            fontFamily: 'sans-serif',
            opacity: 0.8
          }
        }
      };

      await addDoc(collection(db, 'projects'), newProject);
      setIsModalOpen(false);
      setFormData({
        name: '',
        accessCode: '',
        schedule: { date: '', startTime: '', endTime: '' },
        settings: { 
          glossaries: [], 
          theme: {},
          appearance: {
            backgroundColor: '#000000',
            textColor: '#ffffff',
            fontSize: 'medium',
            fontFamily: 'sans-serif',
            opacity: 0.8
          }
        }
      });
      fetchProjects();
    } catch (error: any) {
      console.error("Error creating project:", error);
      alert("Failed to create project: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'live': return 'bg-red-100 text-red-800 border-red-200';
      case 'scheduled': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'ended': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Projects</h2>
          <p className="text-gray-500 mt-1">Manage your translation sessions</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 text-white px-5 py-2.5 rounded-lg flex items-center hover:bg-blue-700 shadow-sm transition-all font-medium"
        >
          <Plus className="w-5 h-5 mr-2" />
          New Project
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects.map(project => (
          <div key={project.id} className="bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow overflow-hidden flex flex-col">
            <div className="p-6 flex-1">
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden border border-gray-100">
                  {project.logoUrl ? (
                    <img src={project.logoUrl} alt={project.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xl font-bold text-gray-400">{project.name[0]}</span>
                  )}
                </div>
                <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full border ${getStatusColor(project.status)}`}>
                  {project.status.toUpperCase()}
                </span>
              </div>
              
              <h3 className="text-xl font-bold text-gray-900 mb-2 truncate">{project.name}</h3>
              
              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex items-center">
                  <Calendar className="w-4 h-4 mr-2 text-gray-400" />
                  {project.schedule?.date || 'No Date'}
                </div>
                <div className="flex items-center">
                  <Clock className="w-4 h-4 mr-2 text-gray-400" />
                  {project.schedule?.startTime} - {project.schedule?.endTime}
                </div>
                {project.accessCode && (
                  <div className="flex items-center text-gray-500">
                    <Lock className="w-4 h-4 mr-2 text-gray-400" />
                    Code: {project.accessCode}
                  </div>
                )}
              </div>

              
            </div>

            <div className="bg-gray-50 px-6 py-4 border-t border-gray-100 flex justify-between items-center">
              <button
                onClick={() => setEditingProject(project)}
                className="text-gray-600 hover:text-gray-900 flex items-center text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </button>
              <button
                onClick={() => navigate(`/p/${project.id}/live`)}
                className="text-gray-600 hover:text-gray-900 flex items-center text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
                title="Go Live"
              >
                <Play className="w-4 h-4 mr-2" />
                Go Live
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Unified Settings Modal */}
      {editingProject && (
        <SettingsModal
          project={editingProject}
          onUpdate={() => {
            fetchProjects();
            setEditingProject(null);
          }}
          onClose={() => setEditingProject(null)}
        />
      )}

      {/* Create Modal (Simplified for creation, full settings available after) */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-xl font-bold mb-4">Create New Project</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  className="w-full rounded-lg border-gray-300 border p-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              
              {/* ... Other inputs can be simplified or keep minimal ... */}
              {/* For now keeping the basic ones */}
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    name="schedule.date"
                    value={formData.schedule?.date}
                    onChange={handleInputChange}
                    className="w-full rounded-lg border-gray-300 border p-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Code (Opt)</label>
                  <input
                    type="text"
                    name="accessCode"
                    value={formData.accessCode || ''}
                    onChange={handleInputChange}
                    maxLength={4}
                    className="w-full rounded-lg border-gray-300 border p-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start</label>
                  <input
                    type="time"
                    name="schedule.startTime"
                    value={formData.schedule?.startTime}
                    onChange={handleInputChange}
                    className="w-full rounded-lg border-gray-300 border p-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End</label>
                  <input
                    type="time"
                    name="schedule.endTime"
                    value={formData.schedule?.endTime}
                    onChange={handleInputChange}
                    className="w-full rounded-lg border-gray-300 border p-2"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm disabled:opacity-50"
                >
                  {loading ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Projects;
