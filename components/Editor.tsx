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
import { SpinnerIcon } from './icons/SpinnerIcon';

const A4_WIDTH_PX = 794; 
const A4_HEIGHT_PX = 1123;
// Professional margins for Board Exams
const CONTENT_WIDTH_PX = 794 - (100 * 2); 
const MAX_PAGE_HEIGHT_PX = 1123 - (80 * 2);

const triggerMathRendering = (element: HTMLElement | null) => {
    if (!element || !(window as any).renderMathInElement) return;
    
    // Explicitly check for standard mode before rendering to avoid KaTeX abortion
    if (document.compatMode !== "CSS1Compat") {
        console.error("SSGPT: Document is in quirks mode. Math rendering cannot proceed safely.");
        return;
    }

    try {
        (window as any).renderMathInElement(element, { 
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false},
                {left: '\\(', right: '\\)', display: false},
                {left: '\\[', right: '\\]', display: true}
            ], 
            throwOnError: false,
            strict: false
        });
        // Force reflow for accurate geometry after math renders
        void element.offsetHeight;
    } catch (err) {
        console.warn("KaTeX render attempt encountered issues:", err);
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

    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);
    const [isAnswerKeyMode, setIsAnswerKeyMode] = useState(false);
    const [sidebarView, setSidebarView] = useState<'toolbar' | 'chat' | 'gallery'>('toolbar');
    const [coEditorMessages, setCoEditorMessages] = useState<CoEditorMessage[]>([]);
    const [isCoEditorTyping, setIsCoEditorTyping] = useState(false);
    const [editingChat, setEditingChat] = useState<Chat | null>(null);
    const [pagesHtml, setPagesHtml] = useState<string[]>([]);
    const pagesContainerRef = useRef<HTMLDivElement>(null);
    const [debouncedPaper, setDebouncedPaper] = useState(state.paper);

    useEffect(() => {
        setEditingChat(createEditingChat(paperData));
        setCoEditorMessages([{ id: '1', sender: 'bot', text: "Academic board standards active. Math rendering is stabilized with extra clearance for complex LaTeX expressions like fractions and powers." }]);
        setTimeout(() => onReady(), 200);
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedPaper(state.paper);
        }, 1200); 
        return () => clearTimeout(timer);
    }, [state.paper]);

    const paginate = useCallback(() => {
        const container = document.createElement('div');
        container.style.width = `${CONTENT_WIDTH_PX}px`;
        container.style.fontFamily = state.styles.fontFamily;
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.top = '0';
        container.style.visibility = 'hidden';
        
        const htmlContent = generateHtmlFromPaperData(debouncedPaper, { 
            logoConfig: state.logo.src ? { src: state.logo.src, alignment: 'center' } : undefined,
            isAnswerKey: isAnswerKeyMode
        });
        
        container.innerHTML = htmlContent;
        document.body.appendChild(container);
        
        // Critical: Math must be rendered before we measure heights for pagination
        triggerMathRendering(container);

        const contentRoot = container.querySelector('#paper-root') || container.children[0];
        const children = Array.from(contentRoot?.children || []);
        
        const pages: string[] = [];
        let currentPageHtml = ""; 
        let currentHeight = 0;
        const maxPageHeight = MAX_PAGE_HEIGHT_PX; 

        children.forEach(child => {
            const el = child as HTMLElement;
            const style = window.getComputedStyle(el);
            const marginTop = parseFloat(style.marginTop || '0');
            const marginBottom = parseFloat(style.marginBottom || '0');
            const elHeight = el.offsetHeight + marginTop + marginBottom;
            
            if (currentHeight + elHeight > maxPageHeight && currentPageHtml) { 
                pages.push(currentPageHtml); 
                currentPageHtml = ""; 
                currentHeight = 0; 
            }
            
            currentPageHtml += el.outerHTML; 
            currentHeight += elHeight;
        });

        if (currentPageHtml) pages.push(currentPageHtml);
        document.body.removeChild(container);
        setPagesHtml(pages.length ? pages : ['<div style="text-align:center; padding: 100px; font-weight:bold;">Preparing Academic Paper...</div>']);
        
        // Render math on actual visible pages
        setTimeout(() => triggerMathRendering(pagesContainerRef.current), 300);
    }, [debouncedPaper, state.styles.fontFamily, state.logo, isAnswerKeyMode]);

    useEffect(() => { paginate(); }, [paginate]);

    const handleExportPDF = async () => {
        if (isExporting) return;
        setIsExporting(true);
        setExportProgress(0);
        try {
            const pdf = new jsPDF('p', 'px', 'a4');
            const pdfW = pdf.internal.pageSize.getWidth();
            const pdfH = pdf.internal.pageSize.getHeight();
            const pageElements = pagesContainerRef.current?.querySelectorAll('.paper-page');
            
            if (!pageElements || pageElements.length === 0) { 
                alert("Rendering paper..."); 
                setIsExporting(false);
                return; 
            }
            
            const totalPages = pageElements.length;

            for (let i = 0; i < totalPages; i++) {
                setExportProgress(Math.round(((i) / totalPages) * 100));
                
                const el = pageElements[i] as HTMLElement;
                triggerMathRendering(el);
                
                // Optimized delay: 800ms is sufficient for math to settle, reduced from 2000ms
                await new Promise(resolve => setTimeout(resolve, 800));

                const canvas = await html2canvas(el, { 
                    scale: 3, // Optimized scale: 3.0 (approx 300 DPI) is fast & high quality. 4.5 was overkill.
                    useCORS: true, 
                    backgroundColor: '#ffffff',
                    logging: false,
                    allowTaint: true
                });
                
                const imgData = canvas.toDataURL('image/jpeg', 0.95);
                if (i > 0) pdf.addPage();
                pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH, undefined, 'FAST');
                
                setExportProgress(Math.round(((i + 1) / totalPages) * 100));
            }
            pdf.save(`${state.paper.subject.replace(/\s+/g, '_')}_Academic_Paper.pdf`);
        } catch (error) {
            console.error("PDF Export Error:", error);
            alert("Export error occurred.");
        } finally { 
            // Small delay to let user see 100%
            setTimeout(() => {
                setIsExporting(false);
                setExportProgress(0);
            }, 500);
        }
    };

    const handleCoEditorSend = async (msg: string) => {
        if (!editingChat || isCoEditorTyping) return;
        setCoEditorMessages(prev => [...prev, { id: Date.now().toString(), sender: 'user', text: msg }]);
        setIsCoEditorTyping(true);
        try {
            const res = await getAiEditResponse(editingChat, msg);
            if (res.text) {
                setCoEditorMessages(prev => [...prev, { id: (Date.now()+1).toString(), sender: 'bot', text: res.text || "Applied changes." }]);
                setTimeout(() => triggerMathRendering(document.querySelector('.chat-scrollbar')), 150);
            }
        } catch (e) { console.error(e); }
        finally { setIsCoEditorTyping(false); }
    };

    useImperativeHandle(ref, () => ({
        handleSaveAndExitClick: onSaveAndExit,
        openExportModal: handleExportPDF,
        openAnswerKeyModal: () => setIsAnswerKeyMode(prev => !prev),
        paperSubject: state.paper.subject,
        isAnswerKeyMode
    }));

    return (
        <div className="flex h-full bg-slate-200 dark:bg-gray-900 overflow-hidden relative">
            {isExporting && (
                <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-[100] flex flex-col items-center justify-center text-white animate-fade-in">
                    <div className="w-full max-w-md p-8 relative flex flex-col items-center">
                        {/* Decorative background glow */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-indigo-500/20 rounded-full blur-[100px] animate-pulse"></div>
                        
                        <div className="relative z-10 flex flex-col items-center w-full">
                            {/* Circular Progress */}
                            <div className="relative w-24 h-24 mb-8">
                                <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
                                    <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="6" className="text-slate-800" />
                                    <circle 
                                        cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" 
                                        className="text-indigo-500 transition-all duration-300 ease-out"
                                        strokeDasharray="283"
                                        strokeDashoffset={283 - (283 * exportProgress) / 100}
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-xl font-bold font-mono">{exportProgress}%</span>
                                </div>
                            </div>

                            <h2 className="text-3xl font-black tracking-tight text-center mb-2 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">Exporting Paper</h2>
                            <p className="text-slate-400 text-center mb-8 font-medium">Rendered {Math.floor((exportProgress / 100) * pagesHtml.length)} of {pagesHtml.length} pages</p>

                            {/* Linear Progress Bar with Shimmer */}
                            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50 relative shadow-inner">
                                <div 
                                    className="h-full bg-gradient-to-r from-indigo-600 via-purple-500 to-indigo-600 bg-[length:200%_100%] animate-[shimmer_2s_infinite] transition-all duration-300 ease-out relative"
                                    style={{ width: `${exportProgress}%` }}
                                >
                                    <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                                </div>
                            </div>
                            <p className="mt-4 text-xs text-slate-500 uppercase tracking-widest font-semibold">High-Res Vector Capture Active</p>
                        </div>
                    </div>
                </div>
            )}
            <div className="w-80 bg-white dark:bg-slate-900 border-r dark:border-slate-800 flex flex-col shadow-2xl z-10">
                <div className="flex border-b dark:border-slate-800">
                    <button onClick={() => setSidebarView('toolbar')} className={`flex-1 p-3 text-xs font-black tracking-tighter uppercase ${sidebarView === 'toolbar' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Design</button>
                    <button onClick={() => setSidebarView('chat')} className={`flex-1 p-3 text-xs font-black tracking-tighter uppercase ${sidebarView === 'chat' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><AiIcon className="w-4 h-4 mx-auto"/></button>
                    <button onClick={() => setSidebarView('gallery')} className={`flex-1 p-3 text-xs font-black tracking-tighter uppercase ${sidebarView === 'gallery' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><GalleryIcon className="w-4 h-4 mx-auto"/></button>
                </div>
                <div className="flex-1 overflow-y-auto chat-scrollbar">
                    {sidebarView === 'toolbar' && (
                        <EditorSidebar 
                            styles={state.styles} 
                            onStyleChange={(k, v) => setState(s => ({...s, styles: {...s.styles, [k]: v}}))} 
                            paperSize="a4" 
                            onPaperSizeChange={()=>{}} 
                            logo={state.logo} 
                            watermark={state.watermark} 
                            onBrandingUpdate={u => setState(s => ({...s, ...u}))} 
                            onOpenImageModal={() => {}} 
                            onUploadImageClick={() => {}} 
                            isAnswerKeyMode={isAnswerKeyMode}
                            onToggleShowQuestions={() => setIsAnswerKeyMode(p => !p)}
                        />
                    )}
                    {sidebarView === 'chat' && <CoEditorChat messages={coEditorMessages} isTyping={isCoEditorTyping} onSendMessage={handleCoEditorSend} />}
                    {sidebarView === 'gallery' && <ImageGallery isCompact onEditImage={() => {}} />}
                </div>
            </div>
            <main className="flex-1 overflow-auto p-12 bg-slate-300 dark:bg-slate-950/20" ref={pagesContainerRef}>
                {pagesHtml.map((html, i) => (
                    <div key={i} className="paper-page bg-white shadow-2xl mx-auto mb-16 relative overflow-hidden" 
                        style={{ width: A4_WIDTH_PX, height: A4_HEIGHT_PX, border: `${state.styles.borderWidth}px solid ${state.styles.borderColor}` }}>
                        <div className="paper-page-content prose max-w-none p-[80px_100px] select-text" 
                             style={{ fontFamily: state.styles.fontFamily, minHeight: '100%', background: 'white' }} 
                             dangerouslySetInnerHTML={{ __html: html }} />
                    </div>
                ))}
            </main>
        </div>
    );
});
export default Editor;