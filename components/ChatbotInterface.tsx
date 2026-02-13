import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { GoogleGenAI, Chat, FunctionDeclaration, Type, LiveServerMessage, Modality, Blob, Part } from "@google/genai";
import { type FormData, QuestionType, Difficulty, Taxonomy, type VoiceOption } from '../types';
import { generateChatResponseStream, generateTextToSpeech } from '../services/geminiService';
import { SpinnerIcon } from './icons/SpinnerIcon';
import { AttachmentIcon } from './icons/AttachmentIcon';
import { VoiceIcon } from './icons/VoiceIcon';
import { StopIcon } from './icons/StopIcon';
import VoiceModeModal from './VoiceModeModal';
import { SSGPT_LOGO_URL } from '../constants';

type Message = { id: string; sender: 'bot' | 'user'; text: string; grounding?: any[] };
type AttachedFile = { name: string; data: string; mimeType: string; };

const CopyIcon = (props: any) => ( <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>);
const SendIcon = (props: any) => ( <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="currentColor" {...props}><path d="M3.4 20.4l17.45-7.48c.81-.35.81-1.49 0-1.84L3.4 3.6c-.66-.29-1.39.2-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"></path></svg>);

const systemInstruction = "You are SSGPT. Help educators create exams. Gather: School, Class, Subject, Topics, Time, Language, and Distribution. ALWAYS use LaTeX $...$ for math. Call 'generatePaper' when details are ready.";
const generatePaperTool: FunctionDeclaration = { 
  name: 'generatePaper', 
  description: 'Call ONLY when all paper details are gathered.', 
  parameters: { 
    type: Type.OBJECT, 
    properties: { 
      schoolName: { type: Type.STRING }, className: { type: Type.STRING }, subject: { type: Type.STRING }, topics: { type: Type.STRING }, 
      timeAllowed: { type: Type.STRING }, language: { type: Type.STRING },
      questionDistribution: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { type: { type: Type.STRING }, count: { type: Type.INTEGER }, marks: { type: Type.INTEGER }, difficulty: { type: Type.STRING }, taxonomy: { type: Type.STRING } }, required: ['type', 'count', 'marks'] } },
    }, 
    required: ['schoolName', 'className', 'subject', 'topics', 'questionDistribution', 'language', 'timeAllowed'] 
  } 
};

const MessageBubble = memo(({ message, onSpeak }: { message: Message, onSpeak: (t: string) => void }) => {
    useEffect(() => {
        if ((window as any).renderMathInElement) {
            (window as any).renderMathInElement(document.body, { delimiters: [{left: '$', right: '$', display: false}], throwOnError: false });
        }
    }, [message.text]);

    return (
        <div className={`flex items-start gap-3 w-full ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            {message.sender === 'bot' && <img src={SSGPT_LOGO_URL} alt="AI" className="w-8 h-8 rounded-full flex-shrink-0" />}
            <div className={`px-4 py-3 rounded-2xl max-w-xl shadow-md border ${message.sender === 'bot' ? 'bg-white dark:bg-slate-800' : 'bg-green-100 dark:bg-green-900/40 text-slate-800 dark:text-slate-200'}`}>
                <div className="prose-chat" dangerouslySetInnerHTML={{ __html: message.text.replace(/\n/g, '<br/>') }} />
            </div>
        </div>
    );
});

const ChatbotInterface: React.FC<{ onGenerate: (formData: FormData) => void }> = ({ onGenerate }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [chat, setChat] = useState<Chat | null>(null);
  const [isLiveSessionActive, setIsLiveSessionActive] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  let nextStartTime = 0;

  useEffect(() => {
    if (!process.env.API_KEY) return;
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const newChat = ai.chats.create({ model: 'gemini-3-flash-preview', config: { systemInstruction, tools: [{ functionDeclarations: [generatePaperTool] }] } });
    setChat(newChat);
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isBotTyping || !chat) return;
    setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'user', text }]);
    setUserInput('');
    setIsBotTyping(true);
    try {
      const responseStream = await generateChatResponseStream(chat, [{ text }], false, false);
      const botMsgId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, { id: botMsgId, sender: 'bot', text: '' }]);
      let fullText = "";
      for await (const chunk of responseStream) {
        if (chunk.text) {
          fullText += chunk.text;
          setMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, text: fullText } : m));
        }
        if (chunk.functionCalls?.length) {
            onGenerate(chunk.functionCalls[0].args as FormData);
        }
      }
    } catch (e) { console.error(e); }
    finally { setIsBotTyping(false); }
  };

  const startLiveSession = async (voice: VoiceOption) => {
    setIsVoiceModalOpen(false); setIsLiveSessionActive(true);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const inputCtx = new AudioContext({ sampleRate: 16000 });
    
    sessionPromiseRef.current = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => {
          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmBlob = createBlob(inputData);
            sessionPromiseRef.current?.then(s => s.sendRealtimeInput({ media: pcmBlob }));
          };
          source.connect(processor); processor.connect(inputCtx.destination);
        },
        onmessage: async (message: LiveServerMessage) => {
          const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (base64Audio) {
            const outCtx = outputAudioContextRef.current!;
            nextStartTime = Math.max(nextStartTime, outCtx.currentTime);
            const buffer = await decodeAudioData(decode(base64Audio), outCtx, 24000, 1);
            const source = outCtx.createBufferSource();
            source.buffer = buffer; source.connect(outCtx.destination);
            source.start(nextStartTime); nextStartTime += buffer.duration;
            sourcesRef.current.add(source);
          }
          if (message.serverContent?.interrupted) {
            sourcesRef.current.forEach(s => s.stop()); sourcesRef.current.clear(); nextStartTime = 0;
          }
        },
        onerror: (e) => console.error(e),
        onclose: () => { stream.getTracks().forEach(t => t.stop()); inputCtx.close(); }
      },
      config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.id } } }, systemInstruction }
    });
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-black overflow-hidden">
      <div className="flex-1 p-4 overflow-y-auto space-y-6">
        <div className="max-w-3xl mx-auto w-full space-y-6">
          {messages.map(m => <MessageBubble key={m.id} message={m} onSpeak={() => {}} />)}
          {isBotTyping && <div className="animate-pulse text-slate-400 text-sm">SSGPT is thinking...</div>}
        </div>
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 bg-white dark:bg-slate-900 border-t dark:border-slate-800">
        <div className="max-w-3xl mx-auto flex gap-2">
          <input value={userInput} onChange={e => setUserInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage(userInput)} placeholder="Ask anything..." className="flex-1 p-3 rounded-xl border dark:border-slate-700 bg-transparent" />
          <button onClick={() => setIsVoiceModalOpen(true)} className="p-3 bg-indigo-600 text-white rounded-xl"><VoiceIcon className="w-6 h-6"/></button>
          <button onClick={() => handleSendMessage(userInput)} className="p-3 bg-indigo-600 text-white rounded-xl"><SendIcon className="w-6 h-6"/></button>
        </div>
      </div>
      {isVoiceModalOpen && <VoiceModeModal onClose={() => setIsVoiceModalOpen(false)} onStart={startLiveSession} />}
      {isLiveSessionActive && (
        <div className="fixed inset-0 bg-slate-950/90 z-50 flex flex-col items-center justify-center gap-6">
          <div className="w-32 h-32 bg-indigo-500 rounded-full animate-pulse shadow-2xl shadow-indigo-500/50" />
          <p className="text-white font-bold text-xl">Listening...</p>
          <button onClick={() => { setIsLiveSessionActive(false); sessionPromiseRef.current?.then(s => s.close()); }} className="px-8 py-3 bg-red-600 text-white rounded-full font-black">End Session</button>
        </div>
      )}
    </div>
  );
};

const createBlob = (data: Float32Array): Blob => {
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
  return { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
};
const encode = (b: Uint8Array) => btoa(Array.from(b).map(c => String.fromCharCode(c)).join(''));
const decode = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decodeAudioData(data: Uint8Array, ctx: AudioContext, rate: number, ch: number) {
  const i16 = new Int16Array(data.buffer);
  const buf = ctx.createBuffer(ch, i16.length / ch, rate);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = i16[i * ch + c] / 32768.0;
  }
  return buf;
}
export default ChatbotInterface;
