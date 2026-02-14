
import React, { useState, useEffect } from 'react';
import { AnimatedLoaderIcon } from './icons/AnimatedLoaderIcon';

interface LoaderProps {
    isQueued?: boolean;
}

const messages = [
  "Consulting pedagogical frameworks...",
  "Crafting questions at the right difficulty...",
  "Aligning questions with Bloom's Taxonomy...",
  "Assembling your custom assessment...",
  "Applying final linguistic polish...",
  "Almost ready, preparing the editor..."
];

const Loader: React.FC<LoaderProps> = ({ isQueued = false }) => {
  const [messageIndex, setMessageIndex] = useState(0);
  const [isFading, setIsFading] = useState(false);
  const [countdown, setCountdown] = useState(120); // 2 minutes in seconds

  useEffect(() => {
    if (isQueued) {
        const timer = setInterval(() => {
            setCountdown(prev => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => clearInterval(timer);
    }

    const intervalId = setInterval(() => {
      setIsFading(true);
      setTimeout(() => {
        setMessageIndex(prevIndex => (prevIndex + 1) % messages.length);
        setIsFading(false);
      }, 500); // Wait for fade-out to complete
    }, 3000); // Change message every 3 seconds

    return () => clearInterval(intervalId);
  }, [isQueued]);

  const formatTime = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center justify-center p-10 text-center animate-fade-in-up min-h-[300px]">
      <AnimatedLoaderIcon className={`w-24 h-24 mb-4 ${isQueued ? 'text-amber-500' : 'text-indigo-500'}`} />
      
      {isQueued ? (
          <>
            <h2 className="mt-6 text-2xl font-bold text-slate-800 dark:text-slate-200 tracking-tight animate-pulse">
                High Traffic: You are in Queue
            </h2>
            <p className="mt-2 text-slate-600 dark:text-slate-400 max-w-md">
                Our servers are currently busy crafting papers for other teachers. We have reserved your spot.
            </p>
            <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 uppercase tracking-wider">Estimated Wait</p>
                <p className="text-4xl font-bold text-amber-600 dark:text-amber-400 font-mono mt-1">{formatTime(countdown)}</p>
            </div>
            <p className="mt-4 text-sm text-slate-500">System will auto-retry when timer ends.</p>
          </>
      ) : (
          <>
            <h2 className="mt-6 text-2xl font-bold text-slate-800 dark:text-slate-200 tracking-tight animate-subtle-pulse">
                Generating Your Question Paper
            </h2>
            <p className={`mt-2 text-slate-600 dark:text-slate-400 h-6 transition-opacity duration-500 ${isFading ? 'opacity-0' : 'opacity-100'}`}>
                {messages[messageIndex]}
            </p>
          </>
      )}
    </div>
  );
};

export default Loader;
