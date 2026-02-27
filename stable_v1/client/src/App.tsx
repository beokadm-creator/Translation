import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import Layout from './components/Layout';
import Projects from './pages/Projects';
import Login from './pages/Login';
import Overlay from './pages/Overlay';
import Presenter from './pages/Presenter';
import Audience from './pages/Audience';
import GoLive from './pages/GoLive';

const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const location = useLocation();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
    });
    return () => unsubscribe();
  }, []);

  if (isAuthenticated === null) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* Public Routes */}
        <Route path="/p/:projectId" element={<Audience />} />
        <Route path="/p/:projectId/overlay" element={<Overlay />} />
        <Route path="/p/:projectId/presenter" element={<Presenter />} />
        <Route path="/p/:projectId/live" element={<RequireAuth><GoLive /></RequireAuth>} />
        
        {/* Protected Admin Routes */}
        <Route path="/" element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }>
          <Route index element={<Projects />} />
        </Route>
        
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
