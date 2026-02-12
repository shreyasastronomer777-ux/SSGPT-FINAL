import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Chat, FunctionDeclaration, Type, LiveServerMessage, Modality, Blob, Part } from "@google/genai";
import { type FormData, QuestionType, Difficulty, Taxonomy, type VoiceOption } from '../types';
import { generateChatResponseStream, generateTextToSpeech } from '../services/geminiService';
import { SpinnerIcon } from './icons/SpinnerIcon';
import { AttachmentIcon } from './icons/AttachmentIcon';
import { VoiceIcon } from './icons/VoiceIcon';
import { StopIcon } from './icons/StopIcon';
import VoiceModeModal from './VoiceModeModal';
import { SSGPT_LOGO_URL } from '../constants';

// --- Types ---
type Message = { id: string; sender: 'bot' | 'user'; text: string; grounding?: any[] };
type AttachedFile = { name: string; data: string; mimeType: string; };
type ConversationTurn = { user: string; ai: string; id: number };

type AIModelConfig = {
    id: string;
    name: string;
    modelName: string;
    description: string;
    icon: string;
    useThinking?: boolean;
};

const MODELS: AIModelConfig[] = [
    { 
        id: 'ssgpt-1', 
        name: 'SSGPT 1', 
        modelName: 'gemini-2.5-flash', 
        description: 'Fast & Reliable (Free Tier Optimised)', 
        icon: '⚡' 
    },
    { 
        id: 'ssgpt-1.5', 
        name: 'SSGPT 1.5', 
        modelName: 'gemini-2.5-pro', 
        description: 'Balanced Reasoning', 
        icon: '✨' 
    },
    { 
        id: 'ssgpt-7', 
        name: 'SSGPT 7', 
        modelName: 'gemini-2.5-pro', 
        description: 'Deep Thinking Mode', 
        icon: '🧠',
        useThinking: true
    },
];

// --- Icons ---
const CopyIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => ( <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>);
const NewChatIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => ( <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12 5l0 14" /><path d="M5 12l14 0" /></svg>);
const SendIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => ( <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="currentColor" {...props}><path d="M3.4 20.4l17.45-7.48c.81-.35.81-1.49 0-1.84L3.4 3.6c-.66-.29-1.39.2-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"></path></svg>);
const SpeakIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>);
const ChevronDownIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="m6 9 6 6 6-6"/></svg>);

const generatePaperFunctionDeclaration: FunctionDeclaration = { name: 'generatePaper', description: 'Collect academic details to generate an exam paper.', parameters: { type: Type.OBJECT, properties: { schoolName: { type: Type.STRING }, className: { type: Type.STRING }, subject: { type: Type.STRING }, topics: { type: Type.STRING }, timeAllowed: { type: Type.STRING }, questionDistribution: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { type: { type: Type.STRING }, count: { type: Type.INTEGER }, marks: { type: Type.INTEGER }, difficulty: { type: Type.STRING }, taxonomy: { type: Type.STRING } }, required: ['type', 'count', 'marks', 'difficulty', 'taxonomy'] } }, language: { type: Type.STRING } }, required: ['schoolName', 'className', 'subject', 'topics', 'questionDistribution', 'language', 'timeAllowed'] } };
const systemInstruction = `You are SSGPT, an AI for educators. Help users create exams. For ALL math, use LaTeX $...$. GUIDE: ask for Subject, Class, Topics, Distribution.`;

const TypingIndicator: React.FC = () => (
    <div className="flex items-end gap-3 justify-start animate-slide-in-left">
        <img src={SSGPT_LOGO_URL} alt="SSGPT Logo" className="w-8 h-8 rounded-full self-start flex-shrink-0" />
        <div className="px-4 py-3 rounded-2xl bg-white dark:bg-slate-800 rounded-bl-none text-slate-800 dark:text-slate-200 shadow-md border border-slate-200 dark:border-slate-700/80">
            <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
            </div>
        </div>
    </div>
);

function parseMarkdownToHTML(text: string) {
    let html = text.trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    html = html.replace(/```([\s\S]*?)```/g, (match, code) => `<pre class="bg-slate-100 dark:bg-slate-900 p-2 rounded-md overflow-x-auto my-2"><code>${code.trim()}</code></pre>`);
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/^([ \t]*)([\*\-]) (.*$)/gm, (match, indent, bullet, content) => `${indent}<ul><li>${content}</li></ul>`);
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    html = html.replace(/^([ \t]*)\d+\. (.*$)/gm, (match, indent, content) => `${indent}<ol><li>${content}</li></ol>`);
    html = html.replace(/<\/ol>\s*<ol>/g, '');
    html = html.replace(/\n/g, '<br />').replace(/(<br \/>\s*){2,}/g, '<br />');
    return html;
}

const triggerMathRendering = (element: HTMLElement | null) => {
    if (!element) return;
    try {
        if ((window as any).renderMathInElement) {
            (window as any).renderMathInElement(element, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false},
                    {left: '\\(', right: '\\)', display: false},
                    {left: '\\[', right: '\\]', display: true}
                ],
                throwOnError: false
            });
        }
    } catch (e) {
        console.warn("KaTeX rendering failed", e);
    }
};

const ModelSelector: React.FC<{ selectedModelId: string; onSelect: (id: string) => void }> = ({ selectedModelId, onSelect }) => {
    const [isOpen, setIsOpen] = useState(false);
    const selectedModel = MODELS.find(m => m.id === selectedModelId) || MODELS[0];
    const dropdownRef = useRef<HTMLDivElement>(null);
    useEffect(() => { const handleClickOutside = (event: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsOpen(false); }; document.addEventListener("mousedown", handleClickOutside); return () => document.removeEventListener("mousedown", handleClickOutside); }, []);
    return (
        <div className="relative" ref={dropdownRef}>
            <button onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-2 px-3 py-1.5 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border border-slate-200 dark:border-slate-700 rounded-full text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 transition-all shadow-sm">
                <span>{selectedModel.icon}</span> <span>{selectedModel.name}</span> <ChevronDownIcon className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border dark:border-slate-700 p-2 z-50 animate-zoom-in">
                    <div className="space-y-1">
                        {MODELS.map(model => (
                            <button key={model.id} onClick={() => { onSelect(model.id); setIsOpen(false); }} className={`w-full text-left p-2 rounded-lg flex items-center gap-3 transition-colors ${selectedModelId === model.id ? 'bg-indigo-50 dark:bg-indigo-900/30 ring-1 ring-indigo-500/30' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                                <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-lg shadow-sm">{model.icon}</div>
                                <div><p className={`text-sm font-bold ${selectedModelId === model.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-800 dark:text-slate-200'}`}>{model.name}</p><p className="text-xs text-slate-500 dark:text-slate-400">{model.description}</p></div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const ChatbotInterface: React.FC<{ onGenerate: (formData: FormData) => void }> = ({ onGenerate }) => {
  const [messages, setMessages] = useState<Message[]>([]); const [chat, setChat] = useState<Chat | null>(null); const [userInput, setUserInput] = useState(''); const [isBotTyping, setIsBotTyping] = useState(false); const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]); const messagesEndRef = useRef<HTMLDivElement>(null); const fileInputRef = useRef<HTMLInputElement>(null);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false); const [isLiveSessionActive, setIsLiveSessionActive] = useState(false); const [isAiSpeaking, setIsAiSpeaking] = useState(false); const sessionPromiseRef = useRef<Promise<any> | null>(null); const outputAudioContextRef = useRef<AudioContext | null>(null); let nextStartTime = 0;
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]); const [currentUserText, setCurrentUserText] = useState(''); const [currentAiText, setCurrentAiText] = useState(''); const userUtteranceRef = useRef(''); const aiUtteranceRef = useRef(''); const conversationEndRef = useRef<HTMLDivElement>(null);
  const [useSearch, setUseSearch] = useState(false); const [useThinking, setUseThinking] = useState(false);
  const audioPlaybackSource = useRef<AudioBufferSourceNode | null>(null);
  const [selectedModelId, setSelectedModelId] = useState('ssgpt-1');
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const initChat = useCallback(async () => {
    setIsBotTyping(true); setMessages([]);
    try {
      if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
      const selectedModel = MODELS.find(m => m.id === selectedModelId) || MODELS[0];
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const config: any = { systemInstruction, tools: [{ functionDeclarations: [generatePaperFunctionDeclaration] }] };
      if (selectedModel.useThinking) config.thinkingConfig = { thinkingBudget: 4096 };
      const newChat = ai.chats.create({ model: selectedModel.modelName, config });
      setChat(newChat);
      const responseStream = await newChat.sendMessageStream({ message: "Start conversation" });
      const newBotMessage: Message = { id: `bot-${Date.now()}`, sender: 'bot', text: '' };
      setMessages([newBotMessage]);
      for await (const chunk of responseStream) { setMessages(prev => prev.map(msg => msg.id === newBotMessage.id ? {...msg, text: msg.text + chunk.text} : msg)); }
    } catch (error) { setMessages([{ id: 'bot-error', sender: 'bot', text: "Internal Error Occurred" }]);
    } finally { setIsBotTyping(false); }
  }, [selectedModelId]);
    
  useEffect(() => { initChat(); outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 }); return () => { isLiveSessionActive && sessionPromiseRef.current?.then(session => session.close()); }; }, [initChat]);

  // Handle Math Rendering whenever messages change
  useEffect(() => {
    const timer = setTimeout(() => {
        triggerMathRendering(chatContainerRef.current);
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, isBotTyping]);

  const handleSendMessage = async (messageText: string) => {
    const text = messageText.trim();
    if ((!text && attachedFiles.length === 0) || isBotTyping || !chat) return;
    setMessages(prev => [...prev, { id: `user-${Date.now()}`, sender: 'user', text: text || "[File attached]" }]);
    setUserInput(''); setIsBotTyping(true);
    try {
      const messageParts: Part[] = []; if (text) messageParts.push({ text });
      attachedFiles.forEach(f => messageParts.push({ inlineData: { data: f.data, mimeType: f.mimeType } }));
      setAttachedFiles([]);
      const responseStream = await generateChatResponseStream(chat, messageParts, useSearch, useThinking);
      const newBotMessage: Message = { id: `bot-${Date.now()}`, sender: 'bot', text: '' };
      setMessages(prev => [...prev, newBotMessage]);
      let functionCalls: any[] = [];
      for await (const chunk of responseStream) {
        if (chunk.functionCalls) functionCalls = functionCalls.concat(chunk.functionCalls);
        if(chunk.text) setMessages(prev => prev.map(msg => msg.id === newBotMessage.id ? {...msg, text: msg.text + chunk.text} : msg));
      }
      if (functionCalls.length > 0 && functionCalls[0].name === 'generatePaper') { handleTriggerGeneration(functionCalls[0].args); return; }
    } catch (error) { setMessages(prev => [...prev, { id: 'bot-err', sender: 'bot', text: "Internal Error Occurred" }]);
    } finally { setIsBotTyping(false); }
  };
  
  const handleTriggerGeneration = (args: any) => { 
    onGenerate(args as FormData); 
  };
  
  const startLiveSession = async (voice: VoiceOption) => {
    setIsVoiceModalOpen(false); setIsLiveSessionActive(true); setConversationHistory([]); userUtteranceRef.current = ''; aiUtteranceRef.current = '';
    if (!process.env.API_KEY) { setCurrentUserText("Internal Error Occurred"); return; }
    let stream: MediaStream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch(err) { setIsLiveSessionActive(false); return; }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY }); const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 }); nextStartTime = 0;
    sessionPromiseRef.current = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => { setCurrentUserText("Connected! Speak now."); const source = inputAudioContext.createMediaStreamSource(stream); const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1); scriptProcessor.onaudioprocess = (e) => { const pcmBlob = createBlob(e.inputBuffer.getChannelData(0)); sessionPromiseRef.current?.then((session) => session.sendRealtimeInput({ media: pcmBlob })); }; source.connect(scriptProcessor); scriptProcessor.connect(inputAudioContext.destination); },
        onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) userUtteranceRef.current = message.serverContent.inputTranscription.text; if (message.serverContent?.outputTranscription) aiUtteranceRef.current = message.serverContent.outputTranscription.text; setCurrentUserText(userUtteranceRef.current); setCurrentAiText(aiUtteranceRef.current);
            if (message.serverContent?.turnComplete) { if (userUtteranceRef.current || aiUtteranceRef.current) setConversationHistory(prev => [...prev, { user: userUtteranceRef.current, ai: aiUtteranceRef.current, id: Date.now() }]); userUtteranceRef.current = ''; aiUtteranceRef.current = ''; }
            if (message.toolCall?.functionCalls?.[0]?.name === 'generatePaper') { handleTriggerGeneration(message.toolCall.functionCalls[0].args); endLiveSession(); return; }
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) { setIsAiSpeaking(true); const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContextRef.current!, 24000, 1); const source = outputAudioContextRef.current!.createBufferSource(); source.buffer = audioBuffer; source.connect(outputAudioContextRef.current!.destination); source.addEventListener('ended', () => { if(outputAudioContextRef.current) setIsAiSpeaking(false); }); source.start(nextStartTime); nextStartTime = nextStartTime + audioBuffer.duration; }
        },
        onerror: (e) => { setCurrentUserText("Internal Error Occurred"); endLiveSession(); },
        onclose: () => { stream?.getTracks().forEach(t => t.stop()); inputAudioContext.close(); },
      },
      config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.id }}}, systemInstruction, tools: [{ functionDeclarations: [generatePaperFunctionDeclaration] }], inputAudioTranscription: {}, outputAudioTranscription: {} },
    });
  };
  const endLiveSession = () => { sessionPromiseRef.current?.then(s => s.close()); setIsLiveSessionActive(false); };

  const MessageBubble: React.FC<{ message: Message }> = ({ message }) => (
    <div className={`flex items-start gap-3 w-full ${message.sender === 'user' ? 'justify-end animate-slide-in-right' : 'justify-start animate-slide-in-left'}`}>
        {message.sender === 'bot' && <img src={SSGPT_LOGO_URL} alt="SSGPT Logo" className="w-8 h-8 rounded-full flex-shrink-0" />}
        <div className={`prose-chat px-4 py-3 rounded-2xl max-w-xl shadow-md border ${message.sender === 'bot' ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200' : 'bg-green-100 dark:bg-green-900/40'}`}>
            <div dangerouslySetInnerHTML={{ __html: parseMarkdownToHTML(message.text) }} />
        </div>
    </div>
  );

  return (
    <div className="relative flex flex-col h-full w-full bg-slate-50 dark:bg-black" ref={chatContainerRef}>
        <div className="absolute top-4 left-4 z-20 flex gap-2">
            <button onClick={initChat} className="w-10 h-10 flex items-center justify-center bg-white dark:bg-slate-800 rounded-full shadow-md"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M12 5l0 14" /><path d="M5 12l14 0" /></svg></button>
            <ModelSelector selectedModelId={selectedModelId} onSelect={setSelectedModelId} />
        </div>
        <div className="flex-1 p-4 space-y-6 overflow-y-auto">
            <div className="max-w-3xl mx-auto w-full space-y-6">
                {messages.map(m => <MessageBubble key={m.id} message={m} />)}
                {isBotTyping && <TypingIndicator />}
            </div>
            <div ref={messagesEndRef} />
        </div>
        <div className="p-4 bg-white dark:bg-black">
            <div className="max-w-3xl mx-auto flex gap-2">
                <input value={userInput} onChange={e => setUserInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage(userInput)} placeholder="Message SSGPT..." className="flex-1 p-3 rounded-xl border dark:border-slate-700 bg-transparent" />
                <button onClick={() => setIsVoiceModalOpen(true)} className="p-3 bg-indigo-600 text-white rounded-xl"><VoiceIcon /></button>
                <button onClick={() => handleSendMessage(userInput)} className="p-3 bg-indigo-600 text-white rounded-xl"><SendIcon /></button>
            </div>
        </div>
        {isVoiceModalOpen && <VoiceModeModal onClose={() => setIsVoiceModalOpen(false)} onStart={startLiveSession} />}
        {isLiveSessionActive && (
             <div className="fixed inset-0 bg-gray-900/95 backdrop-blur-2xl flex flex-col items-center justify-center z-50 p-4">
                 <div className={`w-48 h-48 rounded-full border-4 ${isAiSpeaking ? 'border-indigo-500 animate-pulse' : 'border-slate-700'} flex items-center justify-center overflow-hidden`}>
                    <img src={SSGPT_LOGO_URL} className="w-24 h-24" />
                 </div>
                 <div className="my-10 text-white text-center">
                    <p className="text-xl font-bold">{currentUserText || "..."}</p>
                    <p className="text-lg opacity-70 mt-2">{currentAiText}</p>
                 </div>
                 <button onClick={endLiveSession} className="bg-red-600 text-white px-8 py-3 rounded-full font-bold">End Session</button>
             </div>
        )}
    </div>
  );
};

function encode(bytes: Uint8Array) { let binary = ''; const len = bytes.byteLength; for (let i = 0; i < len; i++) { binary += String.fromCharCode(bytes[i]); } return btoa(binary); }
function decode(base64: string) { const binaryString = atob(base64); const len = binaryString.length; const bytes = new Uint8Array(len); for (let i = 0; i < len; i++) { bytes[i] = binaryString.charCodeAt(i); } return bytes; }
async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> { const dataInt16 = new Int16Array(data.buffer); const frameCount = dataInt16.length / numChannels; const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate); for (let channel = 0; channel < numChannels; channel++) { const channelData = buffer.getChannelData(channel); for (let i = 0; i < frameCount; i++) { channelData[i] = dataInt16[i * numChannels + channel] / 32768.0; } } return buffer; }
function createBlob(data: Float32Array): Blob { const l = data.length; const int16 = new Int16Array(l); for (let i = 0; i < l; i++) { int16[i] = data[i] * 32768; } return { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' }; }

export default ChatbotInterface;
