
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import { MicIcon } from './icons/MicIcon';
import { StopIcon } from './icons/StopIcon';
import { SpinnerIcon } from './icons/SpinnerIcon';
import { extractConfigFromTranscript } from '../services/geminiService';

interface VoiceConfiguratorProps {
    onConfigExtracted: (config: any) => void;
}

export const VoiceConfigurator: React.FC<VoiceConfiguratorProps> = ({ onConfigExtracted }) => {
    const [isActive, setIsActive] = useState(false);
    const [isExtracting, setIsExtracting] = useState(false);
    const [transcript, setTranscript] = useState('');
    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const startSession = async () => {
        setIsActive(true);
        setTranscript('');
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            
            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                callbacks: {
                    onopen: () => {
                        const source = inputAudioContext.createMediaStreamSource(stream);
                        const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
                        scriptProcessor.onaudioprocess = (e) => {
                            const inputData = e.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            sessionPromiseRef.current?.then(session => session.sendRealtimeInput({ media: pcmBlob }));
                        };
                        source.connect(scriptProcessor);
                        scriptProcessor.connect(inputAudioContext.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            setTranscript(prev => prev + ' ' + message.serverContent?.inputTranscription?.text);
                        }
                    },
                    onerror: (e) => console.error("Voice Error", e),
                    onclose: () => {
                        stream.getTracks().forEach(t => t.stop());
                        inputAudioContext.close();
                    }
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    systemInstruction: "Transcribe accurately. Do not talk back."
                }
            });
        } catch (err) {
            console.error(err);
            setIsActive(false);
        }
    };

    const stopSession = async () => {
        sessionPromiseRef.current?.then(s => s.close());
        setIsActive(false);
        
        if (transcript.trim()) {
            setIsExtracting(true);
            try {
                const config = await extractConfigFromTranscript(transcript);
                if (config) {
                    onConfigExtracted(config);
                }
            } catch (e) {
                alert("Failed to extract configuration. Please try again or fill manually.");
            } finally {
                setIsExtracting(false);
            }
        }
    };

    const createBlob = (data: Float32Array): Blob => {
        const l = data.length;
        const int16 = new Int16Array(l);
        for (let i = 0; i < l; i++) int16[i] = data[i] * 32768;
        return {
            data: btoa(String.fromCharCode(...new Uint8Array(int16.buffer))),
            mimeType: 'audio/pcm;rate=16000',
        };
    };

    return (
        <div className="relative">
            <button
                type="button"
                onClick={isActive ? stopSession : startSession}
                disabled={isExtracting}
                className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold transition-all shadow-lg ${isActive ? 'bg-red-500 text-white animate-pulse' : 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50 hover:bg-indigo-50 dark:hover:bg-slate-600'}`}
            >
                {isExtracting ? <SpinnerIcon className="w-5 h-5" /> : isActive ? <StopIcon className="w-5 h-5" /> : <MicIcon className="w-5 h-5" />}
                {isExtracting ? 'Applying Config...' : isActive ? 'Listening...' : 'Voice Builder'}
            </button>
            
            {isActive && (
                <div className="absolute top-full left-0 mt-4 p-4 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border dark:border-slate-700 w-64 z-50 animate-fade-in">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Live Transcript</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300 italic min-h-[40px]">
                        {transcript || 'Start speaking your requirements...'}
                    </p>
                </div>
            )}
        </div>
    );
};
