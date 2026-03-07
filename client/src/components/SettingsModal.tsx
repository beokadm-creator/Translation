import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import type { Project } from '../types/schema';
import { Save, RefreshCw, Upload, Layout, Type, Calendar, Lock, MessageSquare } from 'lucide-react';

interface SettingsModalProps {
  project: Project;
  onUpdate: () => void;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ project, onUpdate, onClose }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'appearance'>('general');
  const [loading, setLoading] = useState(false);

  // General State
  const [generalData, setGeneralData] = useState({
    name: project.name,
    slug: project.slug || '',
    accessCode: project.accessCode || '',
    parkingMessage: project.settings?.parkingMessage || '',
    schedule: { ...project.schedule },
    targetLangs: project.settings?.targetLangs || ['ko', 'en']
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [previewLogo, setPreviewLogo] = useState(project.logoUrl);

  const SUPPORTED_LANGS = [
    { code: 'ko', label: 'Korean (한국어)' },
    { code: 'en', label: 'English (영어)' },
  ];

  // Appearance State
  const [appearance, setAppearance] = useState(project.settings?.appearance || {
    backgroundColor: '#000000',
    opacity: 0.0,
    textColor: '#ffffff',
    fontSize: 'medium',
    fontFamily: 'sans-serif'
  });

  const handleGeneralChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name.includes('.')) {
      const [parent, child] = name.split('.');
      setGeneralData(prev => ({
        ...prev,
        [parent]: { ...(prev as Record<string, unknown>)[parent] as Record<string, unknown>, [child]: value }
      }));
    } else {
      setGeneralData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setLogoFile(file);
      setPreviewLogo(URL.createObjectURL(file));
    }
  };

  const handleAppearanceChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setAppearance(prev => ({
      ...prev,
      [name]: name === 'opacity' ? parseFloat(value) : value
    }));
  };

  const handleTargetLangChange = (code: string) => {
    setGeneralData(prev => {
      const current = prev.targetLangs;
      const updated = current.includes(code)
        ? current.filter(c => c !== code)
        : [...current, code];
      return { ...prev, targetLangs: updated };
    });
  };

  const handleSave = async () => {
    if (!project.id) return;
    setLoading(true);
    try {
      const docRef = doc(db, 'projects', project.id);
      let logoUrl = project.logoUrl;

      if (logoFile) {
        const storageRef = ref(storage, `logos/${Date.now()}_${logoFile.name}`);
        await uploadBytes(storageRef, logoFile);
        logoUrl = await getDownloadURL(storageRef);
      }

      await updateDoc(docRef, {
        name: generalData.name,
        slug: generalData.slug || null,
        accessCode: generalData.accessCode || null,
        schedule: generalData.schedule,
        logoUrl,
        'settings.parkingMessage': generalData.parkingMessage,
        'settings.targetLangs': generalData.targetLangs,
        'settings.appearance': appearance
      });

      onUpdate();
      alert('Settings saved successfully!');
      onClose();
    } catch (error) {
      console.error("Error saving settings:", error);
      alert('Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const getFontSizePx = (size: string) => {
    switch (size) {
      case 'small': return '18px';
      case 'medium': return '24px';
      case 'large': return '36px';
      case 'xlarge': return '48px';
      default: return '24px';
    }
  };

  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl flex overflow-hidden max-h-[90vh]">
        {/* Sidebar Navigation */}
        <div className="w-64 bg-gray-50 border-r border-gray-200 p-4 flex flex-col">
          <h3 className="font-bold text-gray-500 text-xs uppercase tracking-wider mb-4">Settings</h3>
          <button
            onClick={() => setActiveTab('general')}
            className={`flex items-center px-4 py-3 rounded-lg text-sm font-medium mb-2 transition-colors ${activeTab === 'general' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
          >
            <Layout className="w-4 h-4 mr-3" />
            General & Parking
          </button>
          <button
            onClick={() => setActiveTab('appearance')}
            className={`flex items-center px-4 py-3 rounded-lg text-sm font-medium mb-2 transition-colors ${activeTab === 'appearance' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
          >
            <Type className="w-4 h-4 mr-3" />
            Subtitle Appearance
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <div className="flex-1 overflow-y-auto p-8 max-h-[calc(90vh-80px)]">
            {activeTab === 'general' ? (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
                  <input
                    type="text"
                    name="name"
                    value={generalData.name}
                    onChange={handleGeneralChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Custom URL Slug (Optional)
                    <span className="text-gray-400 text-xs ml-2 font-normal">e.g. my-event-2024</span>
                  </label>
                  <div className="flex">
                    <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">
                      /p/
                    </span>
                    <input
                      type="text"
                      name="slug"
                      value={generalData.slug}
                      onChange={(e) => {
                        // Simple slug validation: lowercase, numbers, hyphens only
                        const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                        setGeneralData(prev => ({ ...prev, slug: val }));
                      }}
                      placeholder="my-event-name"
                      className="flex-1 border border-gray-300 rounded-r-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Project Logo</label>
                  <div className="flex items-center space-x-4">
                    {previewLogo && (
                      <img src={previewLogo} alt="Logo" className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
                    )}
                    <label className="cursor-pointer bg-white border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-50 flex items-center shadow-sm">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload New Logo
                      <input type="file" className="hidden" onChange={handleLogoChange} accept="image/*" />
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      <Calendar className="w-4 h-4 inline mr-1" />
                      Date
                    </label>
                    <input
                      type="date"
                      name="schedule.date"
                      value={generalData.schedule.date}
                      onChange={handleGeneralChange}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      <Lock className="w-4 h-4 inline mr-1" />
                      Access Code (Optional)
                    </label>
                    <input
                      type="text"
                      name="accessCode"
                      value={generalData.accessCode}
                      onChange={handleGeneralChange}
                      maxLength={4}
                      placeholder="e.g. 1234"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                    <input
                      type="time"
                      name="schedule.startTime"
                      value={generalData.schedule.startTime}
                      onChange={handleGeneralChange}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                    <input
                      type="time"
                      name="schedule.endTime"
                      value={generalData.schedule.endTime}
                      onChange={handleGeneralChange}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <label className="block text-sm font-medium text-gray-700 mb-3">Target Languages</label>
                  <div className="grid grid-cols-2 gap-3">
                    {SUPPORTED_LANGS.map(lang => (
                      <label key={lang.code} className={`flex items-center space-x-3 p-3 border rounded-lg cursor-pointer transition-all ${generalData.targetLangs.includes(lang.code)
                          ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-200'
                          : 'hover:bg-gray-50 border-gray-200'
                        }`}>
                        <input
                          type="checkbox"
                          checked={generalData.targetLangs.includes(lang.code)}
                          onChange={() => handleTargetLangChange(lang.code)}
                          className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-gray-300"
                        />
                        <span className="text-sm text-gray-700 font-medium">{lang.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <MessageSquare className="w-4 h-4 inline mr-1" />
                    Parking Page Message
                  </label>
                  <textarea
                    name="parkingMessage"
                    value={generalData.parkingMessage}
                    onChange={handleGeneralChange}
                    rows={3}
                    placeholder="Message shown to users before/after the event..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>
            ) : (
              <div className="flex space-x-6 h-full">
                {/* Appearance Controls */}
                <div className="w-1/3 space-y-5 overflow-y-auto pr-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Text Color</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        name="textColor"
                        value={appearance.textColor}
                        onChange={handleAppearanceChange}
                        className="h-10 w-10 rounded cursor-pointer border border-gray-300"
                      />
                      <span className="text-sm text-gray-500">{appearance.textColor}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Background Color</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        name="backgroundColor"
                        value={appearance.backgroundColor}
                        onChange={handleAppearanceChange}
                        className="h-10 w-10 rounded cursor-pointer border border-gray-300"
                      />
                      <span className="text-sm text-gray-500">{appearance.backgroundColor}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Background Opacity: {appearance.opacity}</label>
                    <input
                      type="range"
                      name="opacity"
                      min="0"
                      max="1"
                      step="0.1"
                      value={appearance.opacity}
                      onChange={handleAppearanceChange}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Font Size</label>
                    <select
                      name="fontSize"
                      value={appearance.fontSize}
                      onChange={handleAppearanceChange}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                      <option value="xlarge">Extra Large</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Font Family</label>
                    <select
                      name="fontFamily"
                      value={appearance.fontFamily}
                      onChange={handleAppearanceChange}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="sans-serif">Sans Serif</option>
                      <option value="serif">Serif</option>
                      <option value="monospace">Monospace</option>
                      <option value="'Noto Sans KR', sans-serif">Noto Sans KR</option>
                    </select>
                  </div>
                </div>

                {/* Live Preview */}
                <div className="flex-1 bg-gray-900 rounded-xl overflow-hidden relative flex flex-col justify-end p-8 bg-[url('https://images.unsplash.com/photo-1524178232363-1fb2b075b655?ixlib=rb-1.2.1&auto=format&fit=crop&w=1950&q=80')] bg-cover bg-center">
                  <div className="absolute inset-0 bg-black bg-opacity-40"></div>
                  <div className="relative z-10 w-full text-center">
                    <p className="text-white/50 text-xs mb-4">Audience View Simulation</p>
                    <div
                      style={{
                        backgroundColor: hexToRgba(appearance.backgroundColor, appearance.opacity),
                        color: appearance.textColor,
                        fontSize: getFontSizePx(appearance.fontSize),
                        fontFamily: appearance.fontFamily,
                        padding: '16px 24px',
                        borderRadius: '12px',
                        display: 'inline-block',
                        maxWidth: '80%',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      This is how your subtitles will appear to the audience.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-white text-gray-700 font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center font-medium shadow-sm disabled:opacity-50"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;