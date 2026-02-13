import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Chat, FunctionDeclaration, Type, LiveServerMessage, Modality, Blob, Part, GenerateContentResponse } from "@google/genai";
import { type FormData, QuestionType, Difficulty, Taxonomy, type VoiceOption } from '../types';
import { generateChatResponseStream, generateTextToSpeech } from '../services/geminiService';
import { SpinnerIcon } from './icons/SpinnerIcon';
import { VoiceIcon } from './icons/VoiceIcon';
import { StopIcon } from './icons/StopIcon';
import VoiceModeModal from './VoiceModeModal';
import { SSGPT_LOGO_URL } from '../constants';

type Message = { id: string; sender: 'bot' | 'user'; text: string; grounding?: any[] };
type ConversationTurn = { user: string; ai: string; id: number };

const CopyIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>);
const NewChatIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5l0 14" /><path d="M5 12l14 0" /></svg>);
const SendIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="currentColor"><path d="M3.4 20.4l17.45-7.48c.81-.35.81-1.49 0-1.84L3.4 3.6c-.66-.29-1.39.2-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"></path></svg>);
const SpeakIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>);

const generatePaperFunctionDeclaration: FunctionDeclaration = { name: 'generatePaper', description: 'Triggered when all exam configuration details are ready.', parameters: { type: Type.OBJECT, properties: { schoolName: { type: Type.STRING }, className: { type: Type.STRING }, subject: { type: Type.STRING }, topics: { type: Type.STRING }, timeAllowed: { type: Type.STRING }, questionDistribution: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { type: { type: Type.STRING }, count: { type: Type.INTEGER }, marks: { type: Type.INTEGER }, difficulty: { type: Type.STRING }, taxonomy: { type: Type.STRING } }, required: ['type', 'count', 'marks', 'difficulty', 'taxonomy'] } }, language: { type: Type.STRING } }, required: ['schoolName', 'className', 'subject', 'topics', 'questionDistribution', 'language', 'timeAllowed'] } };

const systemInstruction = `You are SSGPT, an elite AI for Educators. Your goal is to guide teachers in creating board-standard examination papers.

**PROFESSIONAL CONDUCT:**
- Maintain a highly professional academic tone.
- Collaborate with the teacher to gather School Name, Grade, Subject, Topics, Time, and Question Mix.

**STRICT MATH FORMATTING (MANDATORY):**
- Use professional LaTeX for ALL math content (variables, symbols, formulas, fractions).
- Wrap LaTeX in single dollar signs: $...$.
- ALWAYS use $\\frac{a}{b}$ for fractions. NEVER use plain text like "1/2".

**PROACTIVE ASSISTANCE:**
- Suggest pedagogical improvements for questions.
- Support 100+ languages including regional Indian languages.`;

function parseMarkdownToHTML(text: string) {
    let html = text.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/\n/g, '<br />').replace(/(<br \/>\s*){2,}/g, '<br />');
    return html;
}

// Fix: Added React to imports and implemented proper manual encoding/decoding for Live API as per GenAI guidelines.
const ChatbotInterface: React.FC<{ onGenerate: (formData: FormData) => void }> = ({ onGenerate }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [userInput, setUserInput] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isLiveSessionActive, setIsLiveSessionActive] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [currentUserText, setCurrentUserText] = useState('');
  const [currentAiText, setCurrentAiText] = useState('');
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);

  const initChat = useCallback(async () => {
    setIsBotTyping(true); setMessages([]);
    try {
      if (!process.env.API_KEY) throw new Error("API KEY MISSING");
      // Fix: Followed guideline to initialize ai client instance locally right before usage.
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const newChat = ai.chats.create({ model: 'gemini-3-flash-preview', config: { systemInstruction, tools: [{ functionDeclarations: [generatePaperFunctionDeclaration] }] } });
      setChat(newChat);
      const stream = await newChat.sendMessageStream({ message: "Start session" });
      const botMsg: Message = { id: `bot-${Date.now()}`, sender: 'bot', text: '' };
      setMessages([botMsg]);
      for await (const chunk of stream) { setMessages(prev => prev.map(m => m.id === botMsg.id ? {...m, text: m.text + (chunk.text || '')} : m)); }
    } catch (e) { setMessages([{ id: 'err', sender: 'bot', text: "Internal Error Occurred. Please refresh." }]); }
    finally { setIsBotTyping(false); }
  }, []);

  useEffect(() => { initChat(); outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 }); }, [initChat]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isBotTyping]);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isBotTyping || !chat) return;
    setMessages(prev => [...prev, { id: `user-${Date.now()}`, sender: 'user', text }]);
    setUserInput(''); setIsBotTyping(true);
    try {
      const stream = await generateChatResponseStream(chat, [{ text }], false, false);
      const botMsg: Message = { id: `bot-${Date.now()}`, sender: 'bot', text: '' };
      setMessages(prev => [...prev, botMsg]);
      let functionCalls: any[] = [];
      for await (const chunk of stream) {
        if (chunk.functionCalls) functionCalls = functionCalls.concat(chunk.functionCalls);
        if (chunk.text) setMessages(prev => prev.map(m => m.id === botMsg.id ? {...m, text: m.text + chunk.text} : m));
      }
      if (functionCalls.length > 0 && functionCalls[0].name === 'generatePaper') {
          onGenerate(functionCalls[0].args as FormData);
      }
    } catch (e) { console.error(e); }
    finally { setIsBotTyping(false); }
  };

  const startLiveSession = async (voice: VoiceOption) => {
    setIsVoiceModalOpen(false); setIsLiveSessionActive(true);
    // Fix: Create new GoogleGenAI instance for Live session.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    sessionPromiseRef.current = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmBlob = createBlob(inputData);
                // Fix: Solely rely on sessionPromise resolves to send realtime input.
                sessionPromiseRef.current?.then(s => s.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(processor); processor.connect(inputCtx.destination);
        },
        onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) setCurrentUserText(message.serverContent.inputTranscription.text);
            if (message.serverContent?.outputTranscription) setCurrentAiText(message.serverContent.outputTranscription.text);
            if (message.serverContent?.turnComplete) {
                setConversationHistory(p => [...p, { user: currentUserText, ai: currentAiText, id: Date.now() }]);
                setCurrentUserText(''); setCurrentAiText('');
            }
            if (message.toolCall?.functionCalls?.[0]?.name === 'generatePaper') {
                onGenerate(message.toolCall.functionCalls[0].args as FormData);
                endLiveSession();
            }
            const base64EncodedAudioString = message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
            if (base64EncodedAudioString) {
                setIsAiSpeaking(true);
                // Fix: Manual decoding of PCM audio stream as per guidelines.
                const audioBuffer = await decodeAudioData(decode(base64EncodedAudioString), outputAudioContextRef.current!, 24000, 1);
                const source = outputAudioContextRef.current!.createBufferSource();
                source.buffer = audioBuffer; source.connect(outputAudioContextRef.current!.destination);
                source.onended = () => setIsAiSpeaking(false);
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContextRef.current!.currentTime);
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
            }
        },
        onclose: () => { stream.getTracks().forEach(t => t.stop()); inputCtx.close(); },
        onerror: (e) => console.error(e),
      },
      config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.id }}}, systemInstruction, tools: [{ functionDeclarations: [generatePaperFunctionDeclaration] }], inputAudioTranscription: {}, outputAudioTranscription: {} },
    });
  };

  const endLiveSession = () => { sessionPromiseRef.current?.then(s => s.close()); setIsLiveSessionActive(false); };

  // Fix: Manual encoding and decoding helpers for Live API as per guidelines.
  function encode(bytes: Uint8Array) {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) { binary += String.fromCharCode(bytes[i]); }
    return btoa(binary);
  }

  function decode(base64: string) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) { bytes[i] = binaryString.charCodeAt(i); }
    return bytes;
  }

  async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) {
        channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
      }
    }
    return buffer;
  }

  function createBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) { int16[i] = data[i] * 32768; }
    return { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
  }

  return (
    <div className="relative flex flex-col h-full bg-slate-50 dark:bg-black">
        <div className="flex-1 p-4 space-y-6 overflow-y-auto">
            <div className="max-w-3xl mx-auto w-full space-y-6">
                {messages.map(m => (
                    <div key={m.id} className={`flex items-start gap-3 w-full ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {m.sender === 'bot' && <img src={SSGPT_LOGO_URL} alt="Bot" className="w-8 h-8 rounded-full shadow-md" />}
                        <div className={`px-4 py-3 rounded-2xl max-w-xl shadow-sm border ${m.sender === 'bot' ? 'bg-white dark:bg-slate-800 rounded-bl-none text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700' : 'bg-indigo-600 text-white rounded-br-none border-indigo-500'}`}>
                            <div dangerouslySetInnerHTML={{ __html: parseMarkdownToHTML(m.text) }} />
                        </div>
                    </div>
                ))}
                {isBotTyping && <div className="flex gap-2 p-4 animate-pulse text-slate-400">Thinking...</div>}
                <div ref={messagesEndRef} />
            </div>
        </div>
        <div className="p-4 bg-white dark:bg-slate-900 border-t dark:border-slate-800">
            <div className="max-w-3xl mx-auto flex gap-2">
                <input value={userInput} onChange={e => setUserInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage(userInput)} placeholder="Message SSGPT..." className="flex-1 p-3 rounded-xl border dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none" />
                <button onClick={() => setIsVoiceModalOpen(true)} className="p-3 bg-indigo-100 text-indigo-600 dark:bg-slate-800 dark:text-indigo-400 rounded-xl hover:bg-indigo-200 transition-colors"><VoiceIcon className="w-6 h-6"/></button>
                <button onClick={() => handleSendMessage(userInput)} className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-lg"><SendIcon className="w-6 h-6"/></button>
            </div>
        </div>
        {isVoiceModalOpen && <VoiceModeModal onClose={() => setIsVoiceModalOpen(false)} onStart={startLiveSession} />}
        {isLiveSessionActive && (
            <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-xl flex flex-col items-center justify-center z-50 p-6">
                <div className={`w-48 h-48 rounded-full border-4 ${isAiSpeaking ? 'border-indigo-500 animate-pulse' : 'border-slate-700'} flex items-center justify-center overflow-hidden shadow-2xl`}>
                    <img src={SSGPT_LOGO_URL} className="w-24 h-24" alt="Logo" />
                </div>
                <div className="my-12 text-white text-center space-y-4 max-w-2xl">
                    <p className="text-2xl font-bold tracking-tight">{currentUserText || "Listening..."}</p>
                    <p className="text-xl opacity-60 italic">{currentAiText}</p>
                </div>
                <button onClick={endLiveSession} className="bg-red-600 text-white px-10 py-4 rounded-full font-black text-lg hover:bg-red-700 hover:scale-105 transition-all shadow-xl">End Session</button>
            </div>
        )}
    </div>
  );
};

export default ChatbotInterface;