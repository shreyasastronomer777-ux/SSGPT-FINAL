import React, { useState, useEffect } from 'react';
import { AnimatedLoaderIcon } from './icons/AnimatedLoaderIcon';

const messages = [
  "Consulting pedagogical frameworks...",
  "Crafting questions at the right difficulty...",
  "Aligning questions with Bloom's Taxonomy...",
  "Assembling your custom assessment...",
  "Applying final linguistic polish...",
  "Preparing the export-ready paper..."
];

const Loader: React.FC = () => {
  const [messageIndex, setMessageIndex] = useState(0);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setIsFading(true);
      setTimeout(() => {
        setMessageIndex(prevIndex => (prevIndex + 1) % messages.length);
        setIsFading(false);
      }, 500);
    }, 3000);

    return () => clearInterval(intervalId);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center p-10 text-center animate-fade-in-up h-full">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-indigo-500/10 blur-3xl rounded-full" />
        <AnimatedLoaderIcon className="w-32 h-32 relative text-indigo-500" />
      </div>
      
      <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          Generating Your Question Paper
      </h2>
      <p className={`mt-3 text-lg font-medium text-slate-500 dark:text-slate-400 h-8 transition-opacity duration-500 ${isFading ? 'opacity-0' : 'opacity-100'}`}>
          {messages[messageIndex]}
      </p>
    </div>
  );
};

export default Loader;