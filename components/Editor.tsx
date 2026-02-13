import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Chat } from '@google/genai';
import { type QuestionPaperData, type PaperStyles, type ImageState, type TextBoxState, Question, WatermarkState, LogoState, QuestionType, UploadedImage, Difficulty, Taxonomy } from '../types';
import { createEditingChat, getAiEditResponse, generateHtmlFromPaperData } from '../services/geminiService';
import EditorSidebar from './EditorToolbar';
import EditableImage from './EditableImage';
import CoEditorChat, { type CoEditorMessage } from './CoEditorChat';
import { AiIcon } from './icons/AiIcon';
import { GalleryIcon } from './icons/GalleryIcon';
import { ImageGallery } from './ImageGallery';

const A4_WIDTH_PX = 794; const A4_HEIGHT_PX = 1123;

const triggerMathRendering = (element: HTMLElement | null) => {
    if (!element || !(window as any).renderMathInElement) return;
    try {
        (window as any).renderMathInElement(element, { 
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false},
                {left: '\\(', right: '\\)', display: false},
                {left: '\\[', right: '\\]', display: true}
            ], 
            throwOnError: false 
        });
    } catch (err) {
        console.error("KaTeX render error:", err);
    }
};

const Editor = forwardRef<any, { paperData: QuestionPaperData; onSave: (p: QuestionPaperData) => void; onSaveAndExit: () => void; onReady: () => void; }>((props, ref) => {
    const { paperData, onSave, onSaveAndExit, onReady } = props;
    
    const [state, setState] = useState({
        paper: paperData,
        styles: { fontFamily: "'Times New Roman', Times, serif", headingColor: '#000000', borderColor: '#000000', borderWidth: 1, borderStyle: 'solid' as const },
        images: [] as ImageState[],
        logo: { src: paperData.schoolLogo, position: paperData.schoolLogo ? 'header-center' : 'none' as any, size: 150, opacity: 0.1 },
        watermark: { type: 'none' as any, text: 'DRAFT', color: '#cccccc', fontSize: 80, opacity: 0.1, rotation: -45 },
    });

    const [sidebarView, setSidebarView] = useState<'toolbar' | 'chat' | 'gallery'>('toolbar');
    const [coEditorMessages, setCoEditorMessages] = useState<CoEditorMessage[]>([]);
    const [isCoEditorTyping, setIsCoEditorTyping] = useState(false);
    const [editingChat, setEditingChat] = useState<Chat | null>(null);
    const [pagesHtml, setPagesHtml] = useState<string[]>([]);
    const pagesContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setEditingChat(createEditingChat(paperData));
        setCoEditorMessages([{ id: '1', sender: 'bot', text: "I'm your AI Co-Editor. I can add questions, change wording, or delete sections for you. Use LaTeX for math like $5 \\times 4$. What would you like to do?" }]);
        onReady();
    }, []);

    useEffect(() => {
        const paginate = () => {
            const container = document.createElement('div');
            container.style.width = `${A4_WIDTH_PX - 140}px`;
            container.style.fontFamily = state.styles.fontFamily;
            container.innerHTML = state.paper.htmlContent;
            document.body.appendChild(container);
            const children = Array.from(container.querySelector('div')?.children || []);
            const pages: string[] = [];
            let current = ""; let h = 0;
            children.forEach(child => {
                const el = child as HTMLElement;
                const elH = el.offsetHeight + 20;
                if (h + elH > A4_HEIGHT_PX - 120 && current) { pages.push(current); current = ""; h = 0; }
                current += el.outerHTML; h += elH;
            });
            if (current) pages.push(current);
            document.body.removeChild(container);
            setPagesHtml(pages.length ? pages : ['']);
            
            // Apply font family directly to the pages container
            if (pagesContainerRef.current) {
                pagesContainerRef.current.style.fontFamily = state.styles.fontFamily;
            }
            
            setTimeout(() => triggerMathRendering(pagesContainerRef.current), 100);
        };
        paginate();
    }, [state.paper.htmlContent, state.styles]);

    const handleUpdatePaper = (updater: (p: QuestionPaperData) => QuestionPaperData) => {
        setState(s => {
            const newPaper = updater(s.paper);
            newPaper.htmlContent = (generateHtmlFromPaperData as any)(newPaper);
            return { ...s, paper: newPaper };
        });
    };

    const handleDrop = (e: React.DragEvent, pageIndex: number) => {
        e.preventDefault();
        const data = e.dataTransfer.getData('application/json');
        if (!data) return;
        try {
            const uploaded = JSON.parse(data) as UploadedImage;
            const rect = e.currentTarget.getBoundingClientRect();
            // Calculate coordinates relative to the target page element
            const x = e.clientX - rect.left - 75;
            const y = e.clientY - rect.top - 50;
            
            setState(s => ({ 
                ...s, 
                images: [...s.images, { 
                    id: `img-${Date.now()}`, 
                    src: uploaded.url, 
                    x: Math.max(0, x), 
                    y: Math.max(0, y), 
                    width: 150, 
                    height: 100, 
                    pageIndex, 
                    rotation: 0 
                }] 
            }));
        } catch (err) {
            console.error("Drop handling failed", err);
        }
    };

    const handleCoEditorSend = async (msg: string) => {
        if (!editingChat || isCoEditorTyping) return;
        setCoEditorMessages(prev => [...prev, { id: Date.now().toString(), sender: 'user', text: msg }]);
        setIsCoEditorTyping(true);
        try {
            const res = await getAiEditResponse(editingChat, msg);
            if (res.functionCalls?.length) {
                res.functionCalls.forEach(call => {
                    const args = call.args as any;
                    if (call.name === 'addQuestion') {
                        handleUpdatePaper(p => ({ ...p, questions: [...p.questions, { ...args, questionNumber: p.questions.length + 1, difficulty: Difficulty.Medium, taxonomy: Taxonomy.Understanding, styles: {} }] }));
                    } else if (call.name === 'updateQuestion') {
                        handleUpdatePaper(p => ({ ...p, questions: p.questions.map(q => q.questionNumber === args.questionNumber ? { ...q, ...args.updates } : q) }));
                    } else if (call.name === 'deleteQuestion') {
                        handleUpdatePaper(p => ({ ...p, questions: p.questions.filter(q => q.questionNumber !== args.questionNumber).map((q, i) => ({ ...q, questionNumber: i + 1 })) }));
                    }
                });
            }
            if (res.text) {
                setCoEditorMessages(prev => [...prev, { id: (Date.now()+1).toString(), sender: 'bot', text: res.text || "Updated." }]);
                setTimeout(() => triggerMathRendering(document.querySelector('.chat-scrollbar')), 100);
            }
        } catch (e) { console.error(e); }
        finally { setIsCoEditorTyping(false); }
    };

    useImperativeHandle(ref, () => ({
        handleSaveAndExitClick: onSaveAndExit,
        openExportModal: () => alert("Exporting PDF..."),
        paperSubject: state.paper.subject,
        undo: () => {}, redo: () => {}, canUndo: false, canRedo: false
    }));

    return (
        <div className="flex h-full bg-slate-200 dark:bg-gray-900 overflow-hidden">
            <div className="w-80 bg-white dark:bg-slate-900 border-r dark:border-slate-800 flex flex-col shadow-2xl z-10">
                <div className="flex border-b dark:border-slate-800">
                    <button onClick={() => setSidebarView('toolbar')} className={`flex-1 p-3 text-xs font-black tracking-widest uppercase ${sidebarView === 'toolbar' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Design</button>
                    <button onClick={() => setSidebarView('chat')} className={`flex-1 p-3 text-xs font-black tracking-widest uppercase ${sidebarView === 'chat' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><AiIcon className="w-4 h-4 mx-auto"/></button>
                    <button onClick={() => setSidebarView('gallery')} className={`flex-1 p-3 text-xs font-black tracking-widest uppercase ${sidebarView === 'gallery' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><GalleryIcon className="w-4 h-4 mx-auto"/></button>
                </div>
                <div className="flex-1 overflow-y-auto chat-scrollbar">
                    {sidebarView === 'toolbar' && <EditorSidebar styles={state.styles} onStyleChange={(k, v) => setState(s => ({...s, styles: {...s.styles, [k]: v}}))} paperSize="a4" onPaperSizeChange={()=>{}} logo={state.logo} watermark={state.watermark} onBrandingUpdate={u => setState(s => ({...s, ...u}))} onOpenImageModal={() => {}} onUploadImageClick={() => {}} />}
                    {sidebarView === 'chat' && <CoEditorChat messages={coEditorMessages} isTyping={isCoEditorTyping} onSendMessage={handleCoEditorSend} />}
                    {sidebarView === 'gallery' && <ImageGallery isCompact onEditImage={() => {}} />}
                </div>
            </div>
            <main className="flex-1 overflow-auto p-12 bg-slate-300 dark:bg-slate-950/20" ref={pagesContainerRef}>
                {pagesHtml.map((html, i) => (
                    <div key={i} className="bg-white shadow-2xl mx-auto mb-10 relative overflow-hidden" 
                        onDragOver={e => e.preventDefault()} 
                        onDrop={e => handleDrop(e, i)}
                        style={{ width: A4_WIDTH_PX, height: A4_HEIGHT_PX, border: `${state.styles.borderWidth}px solid ${state.styles.borderColor}` }}>
                        <div className="prose max-w-none p-[70px] select-text" style={{ fontFamily: state.styles.fontFamily }} dangerouslySetInnerHTML={{ __html: html }} />
                        {state.images.filter(img => img.pageIndex === i).map(img => (
                            <EditableImage key={img.id} imageState={img} 
                                onUpdate={u => setState(s => ({...s, images: s.images.map(x => x.id === u.id ? u : x)}))} 
                                onDelete={id => setState(s => ({...s, images: s.images.filter(x => x.id !== id)}))} 
                                onAiEdit={async ()=>{}} 
                            />
                        ))}
                    </div>
                ))}
            </main>
        </div>
    );
});
export default Editor;
