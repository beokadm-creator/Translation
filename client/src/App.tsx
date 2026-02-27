import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';

import Login from './components/Login';
import AdminLanding from './components/AdminLanding';
import AdminDashboard from './components/AdminDashboard';
import Landing from './components/Landing';
import AudienceView from './components/AudienceView';

import OverlayView from './components/OverlayView';

const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const location = useLocation();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
    });
    return () => unsubscribe();
  }, []);

  if (isAuthenticated === null) return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Loading...</div>;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;

  return <>{children}</>;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public: Root Landing */}
        <Route path="/" element={<Landing />} />

        {/* Public: Audience View (Direct Access like /hanwha) */}
        <Route path="/:projectId" element={<AudienceView />} />
        
        {/* Legacy Support */}
        <Route path="/p/:projectId" element={<AudienceView />} />
        
        {/* Public: Overlay View (For OBS) */}
        <Route path="/overlay/:projectId" element={<OverlayView />} />
        <Route path="/overlay/:projectId/:lang" element={<OverlayView />} />

        {/* Public: Login */}
        <Route path="/login" element={<Login />} />
        
        {/* Protected: Admin */}
        <Route path="/admin" element={<RequireAuth><AdminLanding /></RequireAuth>} />
        <Route path="/p/:projectId/admin" element={<RequireAuth><AdminDashboard /></RequireAuth>} />
        <Route path="/:projectId/admin" element={<RequireAuth><AdminDashboard /></RequireAuth>} />
        
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
