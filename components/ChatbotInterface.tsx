import { type Part } from '@google/genai';
import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { GoogleGenAI, Chat, FunctionDeclaration, Type, LiveServerMessage, Modality, Blob, GenerateContentResponse } from "@google/genai";
import { type FormData, QuestionType, Difficulty, Taxonomy, type VoiceOption } from '../types';
import { generateChatResponseStream, generateTextToSpeech } from '../services/geminiService';
import { SpinnerIcon } from './icons/SpinnerIcon';
import { AttachmentIcon } from './icons/AttachmentIcon';
import { VoiceIcon } from './icons/VoiceIcon';
import { StopIcon } from './icons/StopIcon';
import { MicIcon } from './icons/MicIcon';
import VoiceModeModal from './VoiceModeModal';
import { SSGPT_LOGO_URL } from '../constants';

type Message = { id: string; sender: 'bot' | 'user'; text: string; grounding?: any[] };
const SendIcon = (props: any) => ( <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="currentColor" {...props}><path d="M3.4 20.4l17.45-7.48c.81-.35.81-1.49 0-1.84L3.4 3.6c-.66-.29-1.39.2-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"></path></svg>);

const systemInstruction = `You are SSGPT, an expert Academic Assistant. 
STRICT MATH: For any mathematical content, symbols (like multiply/divide), or formulas, you MUST use LaTeX wrapped in $ delimiters for inline and $$ for display. 
Example: "Calculate $5 \\times 4$". 
ALWAYS use double backslashes for commands. 
NEVER use plain text for fractions, powers, or roots. Call 'generatePaper' when all exam details are ready.`;

const generatePaperTool: FunctionDeclaration = { 
  name: 'generatePaper', 
  description: 'Generate paper once all details are gathered.', 
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

const MessageBubble = memo(({ message }: { message: Message }) => {
    const bubbleRef = useRef<HTMLDivElement>(null);
    
    const triggerMath = useCallback(() => {
        if (bubbleRef.current && (window as any).renderMathInElement) {
            try {
                (window as any).renderMathInElement(bubbleRef.current, { 
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false},
                        {left: '\\(', right: '\\)', display: false},
                        {left: '\\[', right: '\\]', display: true}
                    ], 
                    throwOnError: false 
                });
            } catch (err) {
                console.warn("Math rendering failed in bubble", err);
            }
        }
    }, []);

    useEffect(() => { triggerMath(); }, [message.text, triggerMath]);

    return (
        <div className={`flex items-start gap-3 w-full ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            {message.sender === 'bot' && <img src={SSGPT_LOGO_URL} alt="AI" className="w-8 h-8 rounded-full flex-shrink-0 shadow-sm border border-slate-200 dark:border-slate-700" />}
            <div ref={bubbleRef} className={`px-4 py-3 rounded-2xl max-w-[85%] md:max-w-xl shadow-sm border transition-all duration-300 ${message.sender === 'bot' ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-none' : 'bg-indigo-600 text-white border-indigo-500 rounded-br-none'}`}>
                <div className="prose-chat text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: message.text.replace(/\n/g, '<br/>') }} />
            </div>
        </div>
    );
});

const ChatbotInterface: React.FC<{ onGenerate: (formData: FormData) => void }> = ({ onGenerate }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const [chat, setChat] = useState<Chat | null>(null);
  const [isLiveSessionActive, setIsLiveSessionActive] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [aiLiveTranscript, setAiLiveTranscript] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);

  useEffect(() => {
    if (!process.env.API_KEY) return;
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    setChat(ai.chats.create({ 
        model: 'gemini-2.5-flash', 
        config: { systemInstruction, tools: [{ functionDeclarations: [generatePaperTool] }] } 
    }));
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isBotTyping]);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isBotTyping || !chat) return;
    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, sender: 'user', text }]);
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
    } catch (e) { 
        console.error(e);
        setMessages(prev => [...prev, { id: `err-${Date.now()}`, sender: 'bot', text: "I encountered an error. Please try again or check your configuration." }]);
    } finally { setIsBotTyping(false); }
  };

  const startLiveSession = async (voice: VoiceOption) => {
    setIsVoiceModalOpen(false); 
    setIsLiveSessionActive(true);
    setTranscript(''); 
    setAiLiveTranscript('');
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
            const pcmBlob = createBlob(e.inputBuffer.getChannelData(0));
            sessionPromiseRef.current?.then((session) => session.sendRealtimeInput({ media: pcmBlob }));
          };
          source.connect(processor); processor.connect(inputCtx.destination);
        },
        onmessage: async (message: LiveServerMessage) => {
          if (message.serverContent?.inputTranscription) setTranscript(t => t + message.serverContent!.inputTranscription!.text);
          if (message.serverContent?.outputTranscription) setAiLiveTranscript(t => t + message.serverContent!.outputTranscription!.text);
          
          const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (base64Audio) {
            const outCtx = outputAudioContextRef.current!;
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
            const buffer = await decodeAudioData(decode(base64Audio), outCtx, 24000, 1);
            const source = outCtx.createBufferSource();
            source.buffer = buffer; 
            source.connect(outCtx.destination);
            source.start(nextStartTimeRef.current); 
            nextStartTimeRef.current += buffer.duration;
            sourcesRef.current.add(source);
            source.onended = () => sourcesRef.current.delete(source);
          }
          
          if (message.serverContent?.interrupted) {
            sourcesRef.current.forEach(s => s.stop());
            sourcesRef.current.clear();
            nextStartTimeRef.current = 0;
          }

          if (message.toolCall?.functionCalls?.length) {
              onGenerate(message.toolCall.functionCalls[0].args as FormData);
              endLiveSession();
          }
        },
        onclose: () => { 
            stream.getTracks().forEach(t => t.stop()); 
            inputCtx.close(); 
            setIsLiveSessionActive(false); 
        }
      },
      config: { 
        responseModalities: [Modality.AUDIO], 
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.id } } }, 
        systemInstruction, 
        tools: [{ functionDeclarations: [generatePaperTool] }], 
        inputAudioTranscription: {}, 
        outputAudioTranscription: {} 
      }
    });
  };

  const endLiveSession = () => {
    setIsLiveSessionActive(false);
    sessionPromiseRef.current?.then(s => s.close());
  };

  const handleDictate = async () => {
    if (isDictating) {
        sessionPromiseRef.current?.then(s => s.close());
        setIsDictating(false);
        return;
    }
    setIsDictating(true);
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
                    const pcmBlob = createBlob(e.inputBuffer.getChannelData(0));
                    sessionPromiseRef.current?.then(s => s.sendRealtimeInput({ media: pcmBlob }));
                };
                source.connect(processor); processor.connect(inputCtx.destination);
            },
            onmessage: (m) => { 
              if (m.serverContent?.inputTranscription) {
                setUserInput(p => p + m.serverContent!.inputTranscription!.text); 
              }
            },
            onclose: () => { 
                stream.getTracks().forEach(t => t.stop()); 
                inputCtx.close(); 
                setIsDictating(false); 
            }
        },
        config: { 
            responseModalities: [Modality.AUDIO], 
            inputAudioTranscription: {}, 
            systemInstruction: "Transcribe user audio into text accurately. Provide no spoken response." 
        }
    });
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-black overflow-hidden relative">
      <div className="flex-1 p-4 overflow-y-auto space-y-6 chat-scrollbar">
        <div className="max-w-4xl mx-auto w-full space-y-6 pt-4">
          {messages.map(m => <MessageBubble key={m.id} message={m} />)}
          {isBotTyping && <div className="animate-pulse text-slate-400 text-xs pl-12 font-bold uppercase tracking-widest">SSGPT is crafting a response...</div>}
        </div>
        <div ref={messagesEndRef} />
      </div>
      <div className="p-6 bg-white dark:bg-slate-900 border-t dark:border-slate-800 shadow-2xl z-20">
        <div className="max-w-4xl mx-auto flex gap-4 items-end">
          <div className="flex-1 relative group">
             <textarea 
                value={userInput} 
                onChange={e => setUserInput(e.target.value)} 
                onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage(userInput);
                    }
                }} 
                placeholder="Type your exam requirements..." 
                className="w-full p-4 pr-14 rounded-2xl border-2 border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all resize-none min-h-[56px] max-h-32" 
                rows={1}
             />
             <button 
                onClick={handleDictate} 
                className={`absolute right-3 bottom-3 p-2 rounded-xl transition-all ${isDictating ? 'bg-red-500 text-white animate-pulse ring-4 ring-red-500/20' : 'text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400'}`} 
                title="Dictate"
             >
                <MicIcon className="w-6 h-6"/>
             </button>
          </div>
          <div className="flex gap-2 mb-1">
            <button 
              onClick={() => setIsVoiceModalOpen(true)} 
              className="p-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl hover:bg-indigo-100 dark:hover:bg-indigo-900/30 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all shadow-sm group"
              title="Voice Mode"
            >
              <VoiceIcon className="w-6 h-6 group-hover:scale-110 transition-transform"/>
            </button>
            <button 
              onClick={() => handleSendMessage(userInput)} 
              disabled={!userInput.trim() || isBotTyping}
              className="p-4 bg-indigo-600 text-white rounded-2xl shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 hover:scale-105 active:scale-95 disabled:opacity-50 transition-all"
            >
              <SendIcon className="w-6 h-6"/>
            </button>
          </div>
        </div>
      </div>
      {isVoiceModalOpen && <VoiceModeModal onClose={() => setIsVoiceModalOpen(false)} onStart={startLiveSession} />}
      {isLiveSessionActive && (
        <div className="fixed inset-0 bg-slate-950/98 backdrop-blur-3xl z-[100] flex flex-col items-center justify-center p-8 animate-fade-in text-center">
          <div className="relative mb-16">
            <div className="w-56 h-56 bg-indigo-500/20 rounded-full animate-ping absolute inset-0" />
            <div className="w-56 h-56 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-full flex items-center justify-center shadow-2xl border-8 border-white/5 relative z-10">
                <VoiceIcon className="w-24 h-24 text-white" />
            </div>
          </div>
          <div className="max-w-lg space-y-8">
            <h3 className="text-4xl font-black text-white tracking-tight uppercase">Voice Active</h3>
            <div className="space-y-4">
                <p className="text-indigo-400 text-2xl font-bold italic h-10 line-clamp-1">{transcript || "Listening closely..."}</p>
                <p className="text-slate-400 text-xl font-medium h-24 overflow-hidden leading-relaxed">{aiLiveTranscript || "The assistant is ready to chat."}</p>
            </div>
          </div>
          <button onClick={endLiveSession} className="mt-20 px-16 py-5 bg-red-600 text-white rounded-full font-black text-2xl hover:scale-105 hover:bg-red-700 transition-all shadow-2xl shadow-red-900/40">End Conversation</button>
        </div>
      )}
    </div>
  );
};

const createBlob = (d: Float32Array) => { 
    const i16 = new Int16Array(d.length); 
    for(let i=0; i<d.length; i++) i16[i] = d[i]*32768; 
    return { 
        data: btoa(Array.from(new Uint8Array(i16.buffer)).map(c => String.fromCharCode(c)).join('')), 
        mimeType: 'audio/pcm;rate=16000' 
    }; 
};
const decode = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decodeAudioData(data: Uint8Array, ctx: AudioContext, rate: number, ch: number) { 
    const i16 = new Int16Array(data.buffer); 
    const buf = ctx.createBuffer(ch, i16.length/ch, rate); 
    for(let c=0; c<ch; c++) { 
        const d = buf.getChannelData(c); 
        for(let i=0; i<i16.length/ch; i++) d[i] = i16[i*ch+c]/32768.0; 
    } 
    return buf; 
}

export default ChatbotInterface;