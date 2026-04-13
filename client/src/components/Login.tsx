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
    <div className="min-h-screen flex items-center justify-center bg-[#f9fafb] dark:bg-[#111827] text-[#111827] dark:text-[#f9fafb]">
      <form onSubmit={handleLogin} className="bg-[#ffffff] dark:bg-[#1f2937] p-8 rounded-xl w-96 space-y-4">
        <h2 className="text-2xl font-bold mb-4">Admin Login</h2>
        <input 
          className="w-full p-2 bg-[#f3f4f6] dark:bg-[#374151] rounded-xl"
          placeholder="Email" 
          value={email} 
          onChange={e => setEmail(e.target.value)} 
        />
        <input 
          className="w-full p-2 bg-[#f3f4f6] dark:bg-[#374151] rounded-xl"
          type="password" 
          placeholder="Password" 
          value={password} 
          onChange={e => setPassword(e.target.value)} 
        />
        <button className="w-full bg-[#1e3a5f] text-[#ffffff] p-2 rounded-xl font-bold">Sign In</button>
      </form>
    </div>
  );
};

export default Login;
