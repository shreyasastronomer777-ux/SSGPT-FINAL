import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Chat } from '@google/genai';
import { type QuestionPaperData, type PaperStyles, type ImageState, type TextBoxState, Question, WatermarkState, LogoState, QuestionType, UploadedImage, Difficulty, Taxonomy } from '../types';
import { createEditingChat, getAiEditResponse, translatePaperService, editImage, translateQuestionService } from '../services/geminiService';
import { generateHtmlFromPaperData, generateAnswerKeyHtml } from '../services/htmlGenerator';
import EditorSidebar from './EditorToolbar';
import RichTextToolbar from './RichTextToolbar';
import ImageGenerationModal from './ImageGenerationModal';
import EditableImage from './EditableImage';
import EditableTextBox from './EditableTextBox';
import CoEditorChat, { type CoEditorMessage } from './CoEditorChat';
import { AiIcon } from './icons/AiIcon';
import { GalleryIcon } from './icons/GalleryIcon';
import { ImageGallery } from './ImageGallery';
import { ProImageEditor } from './ProImageEditor';

const A4_WIDTH_PX = 794; const A4_HEIGHT_PX = 1123; const LETTER_WIDTH_PX = 816; const LETTER_HEIGHT_PX = 1056;

const triggerMathRendering = (element: HTMLElement | null) => {
    if (!element || !(window as any).renderMathInElement) return;
    (window as any).renderMathInElement(element, { delimiters: [{left: '$', right: '$', display: false}], throwOnError: false });
};

const Editor = forwardRef<any, { paperData: QuestionPaperData; onSave: (p: QuestionPaperData) => void; onSaveAndExit: () => void; onReady: () => void; }>((props, ref) => {
    const { paperData, onSave, onSaveAndExit, onReady } = props;
    
    const [state, setState] = useState({
        paper: paperData,
        styles: { fontFamily: "'Times New Roman', Times, serif", headingColor: '#000000', borderColor: '#000000', borderWidth: 1, borderStyle: 'solid' as const },
        images: [] as ImageState[],
        textBoxes: [] as TextBoxState[],
        logo: { src: paperData.schoolLogo, position: paperData.schoolLogo ? 'header-center' : 'none' as any, size: 150, opacity: 0.1 },
        watermark: { type: 'none' as any, text: 'CONFIDENTIAL', color: '#cccccc', fontSize: 80, opacity: 0.1, rotation: -45 },
    });

    const [sidebarView, setSidebarView] = useState<'toolbar' | 'chat' | 'gallery'>('toolbar');
    const [coEditorMessages, setCoEditorMessages] = useState<CoEditorMessage[]>([]);
    const [isCoEditorTyping, setIsCoEditorTyping] = useState(false);
    const [editingChat, setEditingChat] = useState<Chat | null>(null);
    const [pagesHtml, setPagesHtml] = useState<string[]>([]);
    const [isImageModalVisible, setImageModalVisible] = useState(false);
    const [imageToEditInPro, setImageToEditInPro] = useState<UploadedImage | null>(null);
    const pagesContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const chat = createEditingChat(paperData);
        setEditingChat(chat);
        setCoEditorMessages([{ id: '1', sender: 'bot', text: "Ready to refine your paper. You can ask me to change styles, add questions, or modify content." }]);
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
            setTimeout(() => triggerMathRendering(pagesContainerRef.current), 50);
        };
        paginate();
    }, [state.paper.htmlContent, state.styles]);

    const handleUpdatePaper = (updater: (p: QuestionPaperData) => QuestionPaperData) => {
        setState(s => {
            const newPaper = updater(s.paper);
            newPaper.htmlContent = generateHtmlFromPaperData(newPaper);
            return { ...s, paper: newPaper };
        });
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const data = e.dataTransfer.getData('application/json');
        if (!data) return;
        const uploaded = JSON.parse(data) as UploadedImage;
        const rect = pagesContainerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left - 100;
        const y = e.clientY - rect.top - 100;
        const newImg: ImageState = { id: Date.now().toString(), src: uploaded.url, x, y, width: 200, height: 150, pageIndex: 0, rotation: 0 };
        setState(s => ({ ...s, images: [...s.images, newImg] }));
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
                        handleUpdatePaper(p => ({ ...p, questions: [...p.questions, { ...args, questionNumber: p.questions.length + 1, styles: {}, options: args.options ? JSON.parse(args.options) : null }] }));
                    } else if (call.name === 'updateQuestion') {
                        handleUpdatePaper(p => ({ ...p, questions: p.questions.map(q => q.questionNumber === args.questionNumber ? { ...q, ...args.updates } : q) }));
                    } else if (call.name === 'deleteQuestion') {
                        handleUpdatePaper(p => ({ ...p, questions: p.questions.filter(q => q.questionNumber !== args.questionNumber).map((q, i) => ({ ...q, questionNumber: i + 1 })) }));
                    } else if (call.name === 'updatePaperStyles') {
                        setState(s => ({ ...s, styles: { ...s.styles, ...args } }));
                    }
                });
            }
            if (res.text) setCoEditorMessages(prev => [...prev, { id: (Date.now()+1).toString(), sender: 'bot', text: res.text || "Updated." }]);
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
            <div className="w-[320px] bg-white dark:bg-slate-900 border-r dark:border-slate-800 flex flex-col shadow-xl z-10">
                <div className="p-2 border-b flex gap-1">
                    <button onClick={() => setSidebarView('toolbar')} className={`flex-1 py-2 rounded ${sidebarView === 'toolbar' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Tools</button>
                    <button onClick={() => setSidebarView('chat')} className={`flex-1 py-2 rounded ${sidebarView === 'chat' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><AiIcon className="w-4 h-4 mx-auto"/></button>
                    <button onClick={() => setSidebarView('gallery')} className={`flex-1 py-2 rounded ${sidebarView === 'gallery' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><GalleryIcon className="w-4 h-4 mx-auto"/></button>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {sidebarView === 'toolbar' && <EditorSidebar styles={state.styles} onStyleChange={(k, v) => setState(s => ({...s, styles: {...s.styles, [k]: v}}))} paperSize="a4" onPaperSizeChange={()=>{}} logo={state.logo} watermark={state.watermark} onBrandingUpdate={u => setState(s => ({...s, ...u}))} onOpenImageModal={() => setImageModalVisible(true)} onUploadImageClick={() => {}} />}
                    {sidebarView === 'chat' && <CoEditorChat messages={coEditorMessages} isTyping={isCoEditorTyping} onSendMessage={handleCoEditorSend} />}
                    {sidebarView === 'gallery' && <ImageGallery isCompact onEditImage={setImageToEditInPro} />}
                </div>
            </div>
            <main className="flex-1 overflow-auto p-12 relative" onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
                <div ref={pagesContainerRef}>
                    {pagesHtml.map((html, i) => (
                        <div key={i} className="bg-white dark:bg-slate-900 shadow-2xl mx-auto mb-8 relative" style={{ width: A4_WIDTH_PX, height: A4_HEIGHT_PX, border: `${state.styles.borderWidth}px solid ${state.styles.borderColor}` }}>
                            <div className="prose dark:prose-invert p-[70px]" dangerouslySetInnerHTML={{ __html: html }} />
                            {state.images.map(img => <EditableImage key={img.id} imageState={img} onUpdate={u => setState(s => ({...s, images: s.images.map(i => i.id === u.id ? u : i)}))} onDelete={id => setState(s => ({...s, images: s.images.filter(i => i.id !== id)}))} onAiEdit={async ()=>{}} />)}
                        </div>
                    ))}
                </div>
            </main>
        </div>
    );
});
export default Editor;
