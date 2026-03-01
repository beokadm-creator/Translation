import React, { useState, useEffect } from 'react';
import { Clock, Calendar } from 'lucide-react';
import type { Project } from '../types/schema';
import { motion } from 'framer-motion';

interface ParkingProps {
  project: Project;
  onLiveStart: () => void;
}

const Parking: React.FC<ParkingProps> = ({ project, onLiveStart }) => {
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date();
      const startDateTimeString = `${project.schedule.date}T${project.schedule.startTime}`;
      const targetDate = new Date(startDateTimeString);
      
      const difference = targetDate.getTime() - now.getTime();

      if (difference <= 0) {
        onLiveStart();
        return null;
      }

      return {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
      };
    };

    const initialTime = calculateTimeLeft();
    Promise.resolve().then(() => setTimeLeft(initialTime));

    if (!initialTime) return;
    const timer = setInterval(() => {
      const time = calculateTimeLeft();
      setTimeLeft(time);
      if (!time) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [project, onLiveStart]);

  if (!timeLeft) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black flex flex-col items-center justify-center p-6 text-center text-white">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="max-w-3xl w-full flex flex-col items-center"
      >
        {project.logoUrl ? (
          <img 
            src={project.logoUrl} 
            alt={project.name} 
            className="w-32 h-32 md:w-40 md:h-40 object-contain mb-8 rounded-2xl shadow-2xl bg-white p-4"
          />
        ) : (
          <div className="w-24 h-24 bg-gray-700 rounded-full flex items-center justify-center mb-8">
            <Calendar className="w-10 h-10 text-gray-400" />
          </div>
        )}
        
        <h1 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight">
          {project.name}
        </h1>
        
        <p className="text-xl text-gray-400 mb-12 flex items-center">
          <Clock className="w-5 h-5 mr-2 text-blue-400" />
          Event starts soon
        </p>

        {/* Custom Parking Message */}
        {project.settings?.parkingMessage && (
           <div className="mb-12 p-6 bg-white/5 rounded-xl border border-white/10 backdrop-blur-sm max-w-2xl w-full">
             <p className="text-lg text-gray-200 leading-relaxed whitespace-pre-wrap">
               {project.settings.parkingMessage}
             </p>
           </div>
        )}

        <div className="grid grid-cols-4 gap-4 md:gap-8 mb-16">
          {[
            { label: 'Days', value: timeLeft.days },
            { label: 'Hours', value: timeLeft.hours },
            { label: 'Minutes', value: timeLeft.minutes },
            { label: 'Seconds', value: timeLeft.seconds },
          ].map((item) => (
            <div key={item.label} className="flex flex-col items-center">
              <div className="w-16 h-16 md:w-24 md:h-24 bg-gray-800/50 rounded-2xl border border-gray-700 flex items-center justify-center text-2xl md:text-4xl font-bold text-white shadow-lg backdrop-blur-md">
                {String(item.value).padStart(2, '0')}
              </div>
              <span className="text-xs md:text-sm text-gray-500 mt-3 uppercase tracking-widest font-medium">
                {item.label}
              </span>
            </div>
          ))}
        </div>

        <div className="text-sm text-gray-500 animate-pulse">
          Please wait on this page. The live translation will start automatically.
        </div>
      </motion.div>
    </div>
  );
};

export default Parking;
