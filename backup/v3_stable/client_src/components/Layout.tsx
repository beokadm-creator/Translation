import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import { LayoutDashboard, Mic } from 'lucide-react';
import StatusBar from './StatusBar';

const Layout: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200">
        <div className="p-6">
          <h1 className="text-xl font-bold text-gray-800">AI Translator</h1>
        </div>
        <nav className="mt-6 px-4 space-y-2">
          <Link
            to="/"
            className="flex items-center px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <LayoutDashboard className="w-5 h-5 mr-3" />
            Projects
          </Link>
          <Link
            to="/live" // This might be parameterized later, e.g., /live/:projectId
            className="flex items-center px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <Mic className="w-5 h-5 mr-3" />
            Live Console
          </Link>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-8">
        <StatusBar />
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
