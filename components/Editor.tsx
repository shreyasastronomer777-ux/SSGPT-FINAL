import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Chat } from '@google/genai';
import { type QuestionPaperData, type ImageState, Difficulty, Taxonomy, QuestionType } from '../types';
import { createEditingChat, getAiEditResponse, generateHtmlFromPaperData } from '../services/geminiService';
import EditorSidebar from './EditorToolbar';
import EditableImage from './EditableImage';
import CoEditorChat, { type CoEditorMessage } from './CoEditorChat';
import { AiIcon } from './icons/AiIcon';
import { GalleryIcon } from './icons/GalleryIcon';
import { ImageGallery } from './ImageGallery';
import { SpinnerIcon } from './icons/SpinnerIcon';

const A4_WIDTH_PX = 794; 
const A4_HEIGHT_PX = 1123;

const triggerMath = (el: HTMLElement | null) => {
    if (!el || !(window as any).renderMathInElement) return;
    try {
        (window as any).renderMathInElement(el, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false},
                {left: '\\(', right: '\\)', display: false},
                {left: '\\[', right: '\\]', display: true}
            ],
            throwOnError: false
        });
    } catch (e) {
        console.warn("Math rendering failed during processing", e);
    }
};

const Editor = forwardRef<any, { paperData: QuestionPaperData; onSave: (p: QuestionPaperData) => void; onSaveAndExit: () => void; onReady: () => void; }>((props, ref) => {
    const { paperData, onSave, onSaveAndExit, onReady } = props;
    const [state, setState] = useState({
        paper: paperData,
        styles: { fontFamily: "'Times New Roman', Times, serif", headingColor: '#000000', borderColor: '#000000', borderWidth: 1, borderStyle: 'solid' as const },
        images: [] as ImageState[],
        logo: { src: paperData.schoolLogo, position: 'header-center' as any, size: 150, opacity: 0.1 },
        watermark: { type: 'none' as any, text: 'DRAFT', color: '#cccccc', fontSize: 80, opacity: 0.1, rotation: -45 },
    });

    const [isExporting, setIsExporting] = useState(false);
    const [sidebarView, setSidebarView] = useState<'toolbar' | 'chat' | 'gallery'>('toolbar');
    const [coEditorMessages, setCoEditorMessages] = useState<CoEditorMessage[]>([]);
    const [isCoEditorTyping, setIsCoEditorTyping] = useState(false);
    const [editingChat, setEditingChat] = useState<Chat | null>(null);
    const [pagesHtml, setPagesHtml] = useState<string[]>([]);
    const pagesContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setEditingChat(createEditingChat(paperData));
        setCoEditorMessages([{ id: '1', sender: 'bot', text: "Ready to refine your paper. Use LaTeX like $5 \\times 4$ for math. I've been optimized for Match the Following and crisp PDF exports." }]);
        onReady();
    }, []);

    useEffect(() => {
        const paginate = () => {
            const container = document.createElement('div');
            container.style.width = `${A4_WIDTH_PX - 140}px`;
            container.style.fontFamily = state.styles.fontFamily;
            container.style.position = 'absolute';
            container.style.left = '-9999px';
            container.style.top = '0';
            container.innerHTML = state.paper.htmlContent;
            document.body.appendChild(container);
            
            const contentRoot = container.children[0];
            const children = Array.from(contentRoot?.children || []);
            const pages: string[] = [];
            let current = ""; 
            let h = 0;
            const maxH = A4_HEIGHT_PX - 130; // Slightly more margin for safety

            children.forEach(child => {
                const el = child as HTMLElement;
                const elH = el.getBoundingClientRect().height + 8;
                if (h + elH > maxH && current) { 
                    pages.push(current); 
                    current = ""; h = 0; 
                }
                current += el.outerHTML; 
                h += elH;
            });
            if (current) pages.push(current);
            document.body.removeChild(container);
            setPagesHtml(pages.length ? pages : ['']);
            
            setTimeout(() => triggerMath(pagesContainerRef.current), 100);
        };
        paginate();
    }, [state.paper.htmlContent, state.styles.fontFamily]);

    const handleExportPDF = async () => {
        if (isExporting) return;
        setIsExporting(true);
        try {
            const pdf = new jsPDF('p', 'px', 'a4');
            const pdfW = pdf.internal.pageSize.getWidth();
            const pdfH = pdf.internal.pageSize.getHeight();
            const pageElements = pagesContainerRef.current?.querySelectorAll('.paper-page-content');
            
            if (!pageElements || pageElements.length === 0) {
                alert("Nothing to export.");
                return;
            }
            
            for (let i = 0; i < pageElements.length; i++) {
                const el = pageElements[i] as HTMLElement;
                triggerMath(el);
                
                const canvas = await html2canvas(el, { 
                    scale: 2, // 2 is optimal for performance vs quality
                    useCORS: true, 
                    backgroundColor: '#ffffff',
                    logging: false,
                    allowTaint: true,
                    onclone: (clonedDoc) => {
                        const clonedEl = clonedDoc.querySelector(`.paper-page-content[data-page-index="${i}"]`);
                        if (clonedEl) (clonedEl as HTMLElement).style.visibility = 'visible';
                    }
                });
                
                const imgData = canvas.toDataURL('image/png');
                if (i > 0) pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH, undefined, 'SLOW'); // SLOW for better quality compression
            }
            pdf.save(`${state.paper.subject.replace(/\s+/g, '_')}_Final_Exam.pdf`);
        } catch (error) {
            console.error("PDF Export Error:", error);
            alert("Export failed. Ensure images are from trusted sources.");
        } finally {
            setIsExporting(false);
        }
    };

    const handleCoEditorSend = async (msg: string) => {
        if (!editingChat || isCoEditorTyping) return;
        setCoEditorMessages(prev => [...prev, { id: Date.now().toString(), sender: 'user', text: msg }]);
        setIsCoEditorTyping(true);
        try {
            const res = await getAiEditResponse(editingChat, msg);
            if (res.text) {
                setCoEditorMessages(prev => [...prev, { id: (Date.now()+1).toString(), sender: 'bot', text: res.text || "Update applied." }]);
                setTimeout(() => triggerMath(document.querySelector('.chat-scrollbar')), 100);
            }
        } catch (e) { console.error(e); }
        finally { setIsCoEditorTyping(false); }
    };

    useImperativeHandle(ref, () => ({
        handleSaveAndExitClick: onSaveAndExit,
        openExportModal: handleExportPDF,
        paperSubject: state.paper.subject,
    }));

    return (
        <div className="flex h-full bg-slate-200 dark:bg-gray-900 overflow-hidden relative">
            {isExporting && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-2xl z-[100] flex flex-col items-center justify-center text-white text-center">
                    <SpinnerIcon className="w-20 h-20 mb-6 text-indigo-400" />
                    <h2 className="text-2xl font-black tracking-tight">Generating Professional PDF</h2>
                    <p className="text-slate-400 mt-2 max-w-sm px-4">Processing high-resolution layout and complex mathematical expressions...</p>
                </div>
            )}
            <div className="w-80 bg-white dark:bg-slate-900 border-r dark:border-slate-800 flex flex-col shadow-2xl z-10">
                <div className="flex border-b dark:border-slate-800">
                    <button onClick={() => setSidebarView('toolbar')} className={`flex-1 p-3 text-xs font-black uppercase tracking-tighter ${sidebarView === 'toolbar' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Design</button>
                    <button onClick={() => setSidebarView('chat')} className={`flex-1 p-3 text-xs font-black uppercase tracking-tighter ${sidebarView === 'chat' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><AiIcon className="w-4 h-4 mx-auto"/></button>
                    <button onClick={() => setSidebarView('gallery')} className={`flex-1 p-3 text-xs font-black uppercase tracking-tighter ${sidebarView === 'gallery' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><GalleryIcon className="w-4 h-4 mx-auto"/></button>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {sidebarView === 'toolbar' && <EditorSidebar styles={state.styles} onStyleChange={(k,v) => setState(s=>({...s, styles:{...s.styles, [k]:v}}))} logo={state.logo} watermark={state.watermark} onBrandingUpdate={u=>setState(s=>({...s, ...u}))} onOpenImageModal={()=>{}} onUploadImageClick={()=>{}} paperSize="a4" onPaperSizeChange={()=>{}} />}
                    {sidebarView === 'chat' && <CoEditorChat messages={coEditorMessages} isTyping={isCoEditorTyping} onSendMessage={handleCoEditorSend} />}
                    {sidebarView === 'gallery' && <ImageGallery onEditImage={()=>{}} isCompact />}
                </div>
            </div>
            <main className="flex-1 overflow-auto p-12 bg-slate-300 dark:bg-slate-950/20" ref={pagesContainerRef}>
                {pagesHtml.map((html, i) => (
                    <div key={i} className="paper-page bg-white shadow-2xl mx-auto mb-12 relative overflow-hidden" 
                        style={{ width: A4_WIDTH_PX, height: A4_HEIGHT_PX, border: `${state.styles.borderWidth}px solid ${state.styles.borderColor}` }}>
                        <div className="paper-page-content prose max-w-none p-[75px] select-text" 
                             data-page-index={i}
                             style={{ fontFamily: state.styles.fontFamily, minHeight: '100%', background: 'white' }} 
                             dangerouslySetInnerHTML={{ __html: html }} />
                        {state.images.filter(img => img.pageIndex === i).map(img => (
                            <EditableImage key={img.id} imageState={img} onUpdate={u => setState(s => ({...s, images: s.images.map(x => x.id === u.id ? u : x)}))} onDelete={id => setState(s => ({...s, images: s.images.filter(x => x.id !== id)}))} onAiEdit={async ()=>{}} />
                        ))}
                    </div>
                ))}
            </main>
        </div>
    );
});
export default Editor;
