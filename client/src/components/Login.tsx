import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { useNavigate } from 'react-router-dom';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/admin');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Login failed: ${message}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0a0a0a] text-white font-sans selection:bg-blue-500/30 p-4">
      {/* Minimal Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>
      
      <div className="z-10 w-full max-w-sm space-y-8 animate-in fade-in duration-500">
        <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-100">Admin Platform</h1>
            <p className="text-sm text-gray-400">Sign in to manage conferences</p>
        </div>

        <form onSubmit={handleLogin} className="bg-[#111111] p-8 rounded-xl border border-white/5 shadow-2xl space-y-5">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-widest">Email</label>
              <input 
                className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-100 placeholder-gray-600"
                placeholder="admin@example.com" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                required
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-widest">Password</label>
              <input 
                className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-2.5 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-100 placeholder-gray-600"
                type="password" 
                placeholder="••••••••" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                required
              />
            </div>
          </div>
          
          <button 
            type="submit"
            className="w-full bg-white text-black hover:bg-gray-200 font-medium py-2.5 rounded-lg transition-colors text-sm mt-4"
          >
            Sign In
          </button>
        </form>

        <div className="text-center">
          <button onClick={() => navigate('/')} className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-2 justify-center w-full">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"></path></svg>
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
