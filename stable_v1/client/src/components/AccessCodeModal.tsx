import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface AccessCodeModalProps {
  isOpen: boolean;
  correctCode: string | null;
  onSuccess: () => void;
}

const AccessCodeModal: React.FC<AccessCodeModalProps> = ({ isOpen, correctCode, onSuccess }) => {
  const [inputCode, setInputCode] = useState('');
  const [error, setError] = useState(false);

  if (!isOpen || !correctCode) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputCode === correctCode) {
      onSuccess();
    } else {
      setError(true);
      setTimeout(() => setError(false), 500); // Reset for animation replay
      setInputCode('');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8 text-center"
      >
        <div className="mx-auto bg-blue-50 w-16 h-16 rounded-full flex items-center justify-center mb-6 ring-4 ring-blue-50/50">
          <Lock className="w-8 h-8 text-blue-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Required</h2>
        <p className="text-gray-500 text-sm mb-8 leading-relaxed">
          Please enter the access code provided by the organizer to join this session.
        </p>

        <form onSubmit={handleSubmit}>
          <motion.div
            animate={error ? { x: [-10, 10, -10, 10, 0] } : {}}
            transition={{ duration: 0.4 }}
          >
            <input
              type="text"
              value={inputCode}
              onChange={(e) => {
                setInputCode(e.target.value);
                if(error) setError(false);
              }}
              placeholder="Enter Code"
              className={`w-full px-4 py-3 border-2 rounded-xl mb-4 text-center text-2xl font-bold tracking-[0.5em] transition-all placeholder:tracking-normal placeholder:font-normal placeholder:text-gray-400 ${
                error 
                  ? 'border-red-500 focus:border-red-500 bg-red-50 text-red-900' 
                  : 'border-gray-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10'
              } outline-none`}
              autoFocus
              maxLength={6}
            />
          </motion.div>
          
          <AnimatePresence>
            {error && (
              <motion.p 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-red-500 text-sm mb-4 font-medium"
              >
                Incorrect code. Please try again.
              </motion.p>
            )}
          </AnimatePresence>
          
          <button
            type="submit"
            disabled={!inputCode}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3.5 px-4 rounded-xl transition-all shadow-lg hover:shadow-blue-600/20 active:scale-[0.98]"
          >
            Join Session
          </button>
        </form>
      </motion.div>
    </div>
  );
};

export default AccessCodeModal;
