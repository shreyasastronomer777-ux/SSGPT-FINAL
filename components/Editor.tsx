
import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Chat, FunctionCall } from '@google/genai';

import { type QuestionPaperData, type PaperStyles, type ImageState, type TextBoxState, Question, WatermarkState, LogoState, QuestionType, UploadedImage } from '../types';
import { createEditingChat, getAiEditResponse, translatePaperService, editImage, translateQuestionService } from '../services/geminiService';
import { generateHtmlFromPaperData, generateAnswerKeyHtml } from '../services/htmlGenerator';

import EditorSidebar from './EditorToolbar';
import RichTextToolbar from './RichTextToolbar';
import ImageGenerationModal from './ImageGenerationModal';
import EditableImage from './EditableImage';
import EditableTextBox from './EditableTextBox';
import CoEditorChat, { type CoEditorMessage } from './CoEditorChat';
import { AiIcon } from './icons/AiIcon';
import { SpinnerIcon } from './icons/SpinnerIcon';
import { GalleryIcon } from './icons/GalleryIcon';
import { ImageGallery } from './ImageGallery';
import { ProImageEditor } from './ProImageEditor';

interface EditorProps { paperData: QuestionPaperData; onSave: (paperData: QuestionPaperData) => void; onSaveAndExit: () => void; onReady: () => void; }

const A4_WIDTH_PX = 794; const A4_HEIGHT_PX = 1123; const LETTER_WIDTH_PX = 816; const LETTER_HEIGHT_PX = 1056;

const useDebouncedCallback = (callback: (...args: any[]) => void, delay: number) => {
    const timeoutRef = useRef<number | null>(null);
    return useCallback((...args: any[]) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = window.setTimeout(() => { callback(...args); }, delay);
    }, [callback, delay]);
};

type EditorState = {
    paper: QuestionPaperData;
    styles: PaperStyles;
    images: ImageState[];
    textBoxes: TextBoxState[];
    logo: LogoState;
    watermark: WatermarkState;
};

const useUndoableState = <T extends unknown>(initialState: T) => {
    const [state, setState] = useState({ past: [] as T[], present: initialState, future: [] as T[], });
    const canUndo = state.past.length > 0; const canRedo = state.future.length > 0;
    const set = useCallback((newState: T | ((prevState: T) => T), fromContentEditable?: boolean) => {
        setState(current => {
            const newPresent = typeof newState === 'function' ? (newState as (prevState: T) => T)(current.present) : newState;
            if (JSON.stringify(newPresent) === JSON.stringify(current.present)) return current;
            const newPast = [...current.past, current.present];
            if (fromContentEditable && newPast.length > 2) {
                const lastState = newPast[newPast.length-2] as any;
                const currentState = current.present as any;
                if(lastState.paper && currentState.paper && lastState.paper.htmlContent === currentState.paper.htmlContent) {
                } else if (newPast.length % 5 !== 0) {
                   newPast.pop();
                }
            }

            return { past: newPast, present: newPresent, future: [], };
        });
    }, []);
    const undo = useCallback(() => { setState(current => { const { past, present, future } = current; if (past.length === 0) return current; const previous = past[past.length - 1]; const newPast = past.slice(0, past.length - 1); return { past: newPast, present: previous, future: [present, ...future], }; }); }, []);
    const redo = useCallback(() => { setState(current => { const { past, present, future } = current; if (future.length === 0) return current; const next = future[0]; const newFuture = future.slice(1); return { past: [...past, present], present: next, future: newFuture, }; }); }, []);
    const setInitialState = useCallback((initState: T) => { setState({ past: [], present: initState, future: [] }); }, []);
    return { state: state.present, setState: set, undo, redo, canUndo, canRedo, setInitialState };
};

const WatermarkOverlay: React.FC<{ watermark: WatermarkState }> = ({ watermark }) => {
    if (watermark.type === 'none') return null;
    const isRepeating = watermark.text === 'COPY' && watermark.fontSize === 40;
    const commonStyle: React.CSSProperties = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', pointerEvents: 'none', zIndex: 0, };
    if (watermark.type === 'text' && watermark.text) {
        if (isRepeating) {
            const repeatedText = Array(30).fill(watermark.text).join('\u00A0\u00A0\u00A0\u00A0');
            return ( <div style={commonStyle}> <div style={{ fontSize: `${watermark.fontSize}px`, color: watermark.color, fontWeight: 900, opacity: watermark.opacity, transform: `rotate(${watermark.rotation}deg)`, lineHeight: '2.5em', whiteSpace: 'nowrap', width: '200%', height: '200%', textAlign: 'center' }}> {Array(15).fill(repeatedText).map((line, i) => <div key={i}>{line}</div>)} </div> </div> );
        }
        return ( <div style={commonStyle}> <p style={{ fontSize: `${watermark.fontSize}px`, color: watermark.color, fontWeight: 900, whiteSpace: 'nowrap', opacity: watermark.opacity, transform: `rotate(${watermark.rotation}deg)`, }}> {watermark.text} </p> </div> );
    }
    if (watermark.type === 'image' && watermark.src) { return ( <div style={commonStyle}> <img src={watermark.src} alt="Watermark" style={{ width: '50%', height: 'auto', opacity: watermark.opacity, transform: `rotate(${watermark.rotation}deg)`, }} /> </div> ); }
    return null;
};

const Editor = forwardRef<any, EditorProps>((props, ref) => {
    const { paperData, onSave, onSaveAndExit, onReady } = props;
    const getInitialState = useCallback((): EditorState => ({
        paper: paperData,
        styles: { fontFamily: "'Times New Roman', Times, serif", headingColor: '#000000', borderColor: '#000000', borderWidth: 1, borderStyle: 'solid' as const },
        images: [] as ImageState[],
        textBoxes: [] as TextBoxState[],
        logo: { src: paperData.schoolLogo, position: paperData.schoolLogo ? 'header-center' : 'none', size: 150, opacity: 0.1 },
        watermark: { type: 'none', text: 'CONFIDENTIAL', src: undefined, color: '#cccccc', fontSize: 80, opacity: 0.1, rotation: -45, },
    }), [paperData]);

    const { state: editorState, setState: setEditorState, undo, redo, canUndo, canRedo, setInitialState } = useUndoableState<EditorState>(getInitialState());
    const { paper, styles, images, textBoxes, logo, watermark } = editorState;
    
    const [paperSize, setPaperSize] = useState<'a4' | 'letter'>('a4'); const [isSaving, setIsSaving] = useState(false); const [isImageModalVisible, setImageModalVisible] = useState(false); const [imageGenPrompt, setImageGenPrompt] = useState(''); const [isExporting, setIsExporting] = useState(false);
    
    const [editingChat, setEditingChat] = useState<Chat | null>(null); 
    const [sidebarView, setSidebarView] = useState<'toolbar' | 'chat' | 'gallery'>('toolbar');
    const [coEditorMessages, setCoEditorMessages] = useState<CoEditorMessage[]>([]); 
    const [isCoEditorTyping, setIsCoEditorTyping] = useState(false);
    const [pagesHtml, setPagesHtml] = useState<string[]>([]); const editorContentRef = useRef<HTMLDivElement>(null); const pagesContainerRef = useRef<HTMLDivElement>(null); const currentPaperIdRef = useRef<string | null>(null);
    const imageUploadInputRef = useRef<HTMLInputElement>(null);
    const [imageToEditInPro, setImageToEditInPro] = useState<UploadedImage | null>(null);

    // Answer Key Mode State
    const [viewMode, setViewMode] = useState<'questionPaper' | 'answerKey'>('questionPaper');
    const [showQuestionsInKey, setShowQuestionsInKey] = useState(true);
    
    useEffect(() => {
        if (paperData.id !== currentPaperIdRef.current) {
            setInitialState(getInitialState());
            currentPaperIdRef.current = paperData.id;
            try {
                const chatInstance = createEditingChat(paperData);
                setEditingChat(chatInstance);
                setCoEditorMessages([{ id: 'start', sender: 'bot', text: "Hello! I'm your AI co-editor. How can I help you refine this paper?" }]);
            } catch (error) {
                setCoEditorMessages([{ id: 'error', sender: 'bot', text: `Could not start AI editor: ${(error as Error).message}` }]);
            }
        }
        onReady();
    }, [paperData, onReady, getInitialState, setInitialState]);
    
    const debouncedSave = useDebouncedCallback((newState) => {
        setIsSaving(true);
        onSave(newState.paper);
        setTimeout(() => setIsSaving(false), 500);
    }, 2000);

    const handleStateUpdate = useCallback((updater: (s: EditorState) => EditorState, fromEditable = false) => {
        const newState = typeof updater === 'function' ? updater(editorState) : updater;
        setEditorState(newState, fromEditable);
        debouncedSave(newState);
    }, [editorState, setEditorState, debouncedSave]);
    
    const handleContentChange = useDebouncedCallback((pageIndex: number, newHtml: string) => {
        // Only allow content edit in Question Paper mode
        if (viewMode === 'answerKey') return;

        const allPages = pagesContainerRef.current?.querySelectorAll('.paper-content-host'); if (!allPages || allPages.length === 0) return;
        let fullHtml = ''; allPages.forEach(page => { fullHtml += (page as HTMLElement).innerHTML; });
        const wrappedHtml = `<div>${fullHtml}</div>`;
        const newPaper = { ...paper, htmlContent: wrappedHtml };
        handleStateUpdate(s => ({ ...s, paper: newPaper }), true);
    }, 1000);
    
    const handleBrandingUpdate = (updates: Partial<{ logo: LogoState; watermark: WatermarkState }>) => {
        handleStateUpdate(s => {
            let newLogoState = updates.logo ? { ...s.logo, ...updates.logo } : s.logo;
            const newWatermarkState = updates.watermark ? { ...s.watermark, ...updates.watermark } : s.watermark;
            
            let newPaper = s.paper;
            if (updates.logo && 'src' in updates.logo) {
                newPaper = { ...newPaper, schoolLogo: updates.logo.src };
                if (updates.logo.src && newLogoState.position === 'none') {
                    newLogoState.position = 'header-center';
                }
                if (updates.logo.src === undefined) {
                    newLogoState.position = 'none';
                }
            }
            
            const logoConfig = (newLogoState.position.startsWith('header'))
                ? { src: newLogoState.src, alignment: newLogoState.position.replace('header-', '') as 'left' | 'center' | 'right' }
                : undefined;
            
            // Regenerate HTML for both modes to ensure logo propagates
            newPaper = { ...newPaper, htmlContent: generateHtmlFromPaperData(newPaper, { logoConfig }) };
            
            return { ...s, paper: newPaper, logo: newLogoState, watermark: newWatermarkState };
        });
    };
    
    const renumberQuestions = (questions: Question[]): Question[] => {
        return questions.map((q, index) => ({...q, questionNumber: index + 1}));
    };

    const handleUpdateImage = (state: ImageState) => handleStateUpdate(s => ({ ...s, images: s.images.map(i => i.id === state.id ? state : i) }));
    const handleDeleteImage = (id: string) => handleStateUpdate(s => ({ ...s, images: s.images.filter(i => i.id !== id) }));
    const handleAiImageEdit = async (id: string, prompt: string) => {
        const imageToEdit = editorState.images.find(i => i.id === id);
        if(!imageToEdit) return;
        const [header, base64Data] = imageToEdit.src.split(',');
        const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
        const newSrc = await editImage(prompt, imageToEdit.src, mimeType);
        handleUpdateImage({ ...imageToEdit, src: newSrc });
    };

    const handleUpdateTextBox = (state: TextBoxState) => handleStateUpdate(s => ({ ...s, textBoxes: s.textBoxes.map(t => t.id === state.id ? state : t) }));
    const handleDeleteTextBox = (id: string) => handleStateUpdate(s => ({ ...s, textBoxes: s.textBoxes.filter(t => t.id !== id) }));
    
    const handleInsertGeneratedImage = (base64Data: string, width: number, height: number, x: number = 50, y: number = 50, pageIndex: number = 0) => {
        const newImage: ImageState = { id: `img-${Date.now()}`, src: base64Data, x, y, width, height, pageIndex, rotation: 0 };
        handleStateUpdate(s => ({ ...s, images: [...s.images, newImage]}));
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const data = e.dataTransfer.getData('application/json');
        if (data) {
            try {
                const uploadedImage = JSON.parse(data) as UploadedImage;
                
                // Find which page the drop happened on
                const pageContainers = pagesContainerRef.current?.querySelectorAll('.paper-page-container');
                if (!pageContainers) return;

                let targetPageIndex = 0;
                let dropX = 50;
                let dropY = 50;

                for (let i = 0; i < pageContainers.length; i++) {
                    const rect = pageContainers[i].getBoundingClientRect();
                    if (
                        e.clientX >= rect.left &&
                        e.clientX <= rect.right &&
                        e.clientY >= rect.top &&
                        e.clientY <= rect.bottom
                    ) {
                        targetPageIndex = i;
                        dropX = e.clientX - rect.left;
                        dropY = e.clientY - rect.top;
                        break;
                    }
                }

                // Default width/height if not present
                const w = uploadedImage.width && uploadedImage.width > 0 ? Math.min(uploadedImage.width, 300) : 300;
                const h = uploadedImage.height && uploadedImage.height > 0 ? (w / uploadedImage.width) * uploadedImage.height : 300;
                
                handleInsertGeneratedImage(uploadedImage.url, w, h, dropX, dropY, targetPageIndex);
                
            } catch (err) {
                console.error("Failed to parse drop data", err);
            }
        }
    };
    
    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    // Identify active page based on scroll position (rough estimate)
                    const container = editorContentRef.current;
                    const scrollY = container ? container.scrollTop : 0;
                    const pageHeight = (paperSize === 'a4' ? A4_HEIGHT_PX : LETTER_HEIGHT_PX) + 32; // height + margin
                    const currentPageIndex = Math.floor(scrollY / pageHeight);
                    
                    handleInsertGeneratedImage(
                        event.target?.result as string, 
                        img.width > 300 ? 300 : img.width, 
                        img.width > 300 ? (300 / img.width) * img.height : img.height,
                        100, 100, // Default Position
                        Math.max(0, Math.min(currentPageIndex, pagesHtml.length - 1))
                    );
                };
                img.src = event.target?.result as string;
            };
            reader.readAsDataURL(file);
        }
        e.target.value = ''; // Reset input so same file can be selected again
    };

    // Pagination Logic
    useEffect(() => {
        const paginateContent = () => {
            const stagingContainer = document.createElement('div');
            stagingContainer.style.position = 'absolute';
            stagingContainer.style.left = '-9999px';
            stagingContainer.style.width = `${(paperSize === 'a4' ? A4_WIDTH_PX : LETTER_WIDTH_PX) - 140 - (styles.borderWidth * 2)}px`;
            stagingContainer.style.visibility = 'hidden';
            stagingContainer.style.fontFamily = styles.fontFamily;
            stagingContainer.className = "paper-content-host prose dark:prose-invert max-w-none";
            
            // Determine content source based on mode
            let contentToRender = '';
            if (viewMode === 'answerKey') {
                const logoConfig = (logo.position.startsWith('header')) ? { src: logo.src, alignment: logo.position.replace('header-', '') as 'left' | 'center' | 'right' } : undefined;
                contentToRender = generateAnswerKeyHtml(paper, showQuestionsInKey, { logoConfig });
            } else {
                contentToRender = paper.htmlContent;
            }

            stagingContainer.innerHTML = contentToRender;
            document.body.appendChild(stagingContainer);

            const pageHeight = (paperSize === 'a4' ? A4_HEIGHT_PX : LETTER_HEIGHT_PX) - 120 - (styles.borderWidth * 2);
            const children = Array.from(stagingContainer.querySelector('div')?.children || []);
            const pages: string[] = [];
            let currentPageContent = '';
            let currentHeight = 0;

            children.forEach(child => {
                const element = child as HTMLElement;
                const computedStyle = window.getComputedStyle(element);
                const elementHeight = element.offsetHeight + parseInt(computedStyle.marginTop, 10) + parseInt(computedStyle.marginBottom, 10);
                
                if (currentHeight + elementHeight > pageHeight && currentPageContent) {
                    pages.push(currentPageContent);
                    currentPageContent = '';
                    currentHeight = 0;
                }
                currentPageContent += element.outerHTML;
                currentHeight += elementHeight;
            });
            if (currentPageContent) {
                pages.push(currentPageContent);
            }
            document.body.removeChild(stagingContainer);
            setPagesHtml(pages.length ? pages : ['']);
        };

        paginateContent();
        const resizeObserver = new ResizeObserver(paginateContent);
        if (pagesContainerRef.current) {
            resizeObserver.observe(pagesContainerRef.current);
        }
        
        return () => {
            if (pagesContainerRef.current) {
                resizeObserver.unobserve(pagesContainerRef.current);
            }
        };
    }, [paper.htmlContent, styles, paperSize, viewMode, showQuestionsInKey, logo]); // Re-run on mode change

    const handleSaveAndExitClick = () => {
        onSave(editorState.paper);
        onSaveAndExit();
    };
    
    const handleExport = async (format: 'pdf') => {
        setIsExporting(true);
        const pages = pagesContainerRef.current?.querySelectorAll('.paper-page');
        if (!pages || pages.length === 0) {
            alert("Nothing to export.");
            setIsExporting(false);
            return;
        }

        if (format === 'pdf') {
            const pdf = new jsPDF(paperSize === 'a4' ? 'p' : 'p', 'px', paperSize);
            for (let i = 0; i < pages.length; i++) {
                const page = pages[i] as HTMLElement;
                const canvas = await html2canvas(page, { scale: 2, useCORS: true });
                const imgData = canvas.toDataURL('image/png');
                const pdfWidth = pdf.internal.pageSize.getWidth();
                const pdfHeight = pdf.internal.pageSize.getHeight();
                if (i > 0) pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            }
            const suffix = viewMode === 'answerKey' ? '_AnswerKey' : '';
            pdf.save(`${paper.subject.replace(/\s+/g, '_')}${suffix}.pdf`);
        }
        setIsExporting(false);
    };

    const handleCoEditorSend = async (messageText: string) => {
        if (!messageText.trim() || !editingChat) return;

        const userMessage: CoEditorMessage = { id: `user-${Date.now()}`, sender: 'user', text: messageText };
        setCoEditorMessages(prev => [...prev, userMessage]);
        setIsCoEditorTyping(true);

        try {
            const response = await getAiEditResponse(editingChat, messageText);
            
            if (response.functionCalls && response.functionCalls.length > 0) {
                let actionDescription = "Updates applied.";
                for (const call of response.functionCalls) {
                    const args = call.args as any;
                    // Handle special async tools
                    if (call.name === 'translatePaper') {
                         const currentPaper = editorState.paper;
                         const translatedPaper = await translatePaperService(currentPaper, args.targetLanguage);
                         handleStateUpdate(s => ({ ...s, paper: translatedPaper }), true);
                         actionDescription = `Translated paper to ${args.targetLanguage}.`;
                    } else if (call.name === 'translateQuestion') {
                        const currentQuestions = [...editorState.paper.questions];
                        const qIndex = currentQuestions.findIndex(q => q.questionNumber === args.questionNumber);
                        if (qIndex !== -1) {
                             const translatedQ = await translateQuestionService(currentQuestions[qIndex], args.targetLanguage);
                             currentQuestions[qIndex] = translatedQ;
                             handleStateUpdate(s => {
                                 const newP = { ...s.paper, questions: currentQuestions };
                                 const logoConfig = (s.logo.position.startsWith('header')) ? { src: s.logo.src, alignment: s.logo.position.replace('header-', '') as any } : undefined;
                                 newP.htmlContent = generateHtmlFromPaperData(newP, { logoConfig });
                                 return { ...s, paper: newP };
                             }, true);
                             actionDescription = `Translated question ${args.questionNumber} to ${args.targetLanguage}.`;
                        }
                    } else if (call.name === 'requestImageGeneration') {
                         setImageGenPrompt(args.prompt || '');
                         setImageModalVisible(true);
                         actionDescription = "Opened image generator.";
                    } else {
                        // Handle standard sync tools
                        handleStateUpdate(s => {
                            const newState = { ...s };
                            const p = { ...newState.paper };
                            const qs = [...p.questions];
                            
                            if (call.name === 'addQuestion') {
                                const newQ: Question = {
                                    questionNumber: qs.length + 1,
                                    type: args.type,
                                    questionText: args.questionText,
                                    options: args.options ? (typeof args.options === 'string' ? JSON.parse(args.options) : args.options) : null,
                                    answer: args.answer,
                                    marks: args.marks,
                                    difficulty: args.difficulty,
                                    taxonomy: args.taxonomy,
                                    styles: {}
                                };
                                qs.push(newQ);
                            } else if (call.name === 'updateQuestion') {
                                const qIdx = qs.findIndex(q => q.questionNumber === args.questionNumber);
                                if (qIdx !== -1) {
                                    const updates = args.updates;
                                    if (updates.options && typeof updates.options === 'string') {
                                         try { updates.options = JSON.parse(updates.options); } catch(e) {}
                                    }
                                    if (updates.styles) {
                                         qs[qIdx] = { ...qs[qIdx], ...updates, styles: { ...qs[qIdx].styles, ...updates.styles } };
                                    } else {
                                         qs[qIdx] = { ...qs[qIdx], ...updates };
                                    }
                                }
                            } else if (call.name === 'deleteQuestion') {
                                 const qIdx = qs.findIndex(q => q.questionNumber === args.questionNumber);
                                 if (qIdx !== -1) qs.splice(qIdx, 1);
                                 // renumber
                                 for(let i=0; i<qs.length; i++) qs[i].questionNumber = i+1;
                            } else if (call.name === 'updatePaperStyles') {
                                if (args.fontFamily) newState.styles.fontFamily = args.fontFamily;
                                if (args.headingColor) newState.styles.headingColor = args.headingColor;
                                if (args.borderColor) newState.styles.borderColor = args.borderColor;
                                if (args.borderWidth !== undefined) newState.styles.borderWidth = args.borderWidth;
                                if (args.borderStyle) newState.styles.borderStyle = args.borderStyle;
                            } else if (call.name === 'bulkUpdateQuestions') {
                                for (let i = 0; i < qs.length; i++) {
                                    let match = true;
                                    if (args.filters) {
                                        if (args.filters.type && qs[i].type !== args.filters.type) match = false;
                                        if (args.filters.difficulty && qs[i].difficulty !== args.filters.difficulty) match = false;
                                    }
                                    if (match) {
                                        qs[i] = { ...qs[i], ...args.updates };
                                    }
                                }
                            } else if (call.name === 'findAndReplaceText') {
                                const findRegex = new RegExp(args.findText, 'gi');
                                qs.forEach((q, i) => {
                                    if (args.questionNumber && q.questionNumber !== args.questionNumber) return;
                                    q.questionText = q.questionText.replace(findRegex, args.replaceText);
                                });
                            } else if (call.name === 'addTextBox') {
                                const newTb: TextBoxState = {
                                    id: `tb-${Date.now()}`,
                                    x: 100, y: 100, width: 200, height: 100,
                                    htmlContent: 'New Text Box',
                                    rotation: 0,
                                    pageIndex: 0
                                };
                                newState.textBoxes = [...newState.textBoxes, newTb];
                            }

                            p.questions = qs;
                            const logoConfig = (newState.logo.position.startsWith('header')) ? { src: newState.logo.src, alignment: newState.logo.position.replace('header-', '') as any } : undefined;
                            p.htmlContent = generateHtmlFromPaperData(p, { logoConfig });
                            newState.paper = p;
                            return newState;
                        }, true);
                    }
                }
                setCoEditorMessages(prev => [...prev, { id: `bot-${Date.now()}`, sender: 'bot', text: actionDescription }]);
            } 
            
            if (response.text) {
                setCoEditorMessages(prev => [...prev, { id: `bot-txt-${Date.now()}`, sender: 'bot', text: response.text || "" }]);
            }
            
        } catch (error) {
             console.error("AI Edit Error", error);
             setCoEditorMessages(prev => [...prev, { id: `bot-err-${Date.now()}`, sender: 'bot', text: "Sorry, I couldn't process that request." }]);
        } finally {
            setIsCoEditorTyping(false);
        }
    };

    useImperativeHandle(ref, () => ({
        handleSaveAndExitClick,
        openExportModal: () => handleExport('pdf'),
        openAnswerKeyModal: () => {
            // Toggle between view modes
            setViewMode(prev => prev === 'questionPaper' ? 'answerKey' : 'questionPaper');
        },
        isSaving,
        paperSubject: paper.subject,
        undo,
        redo,
        canUndo,
        canRedo,
        isAnswerKeyMode: viewMode === 'answerKey'
    }));
    
    return (
      <div className="flex flex-col h-full bg-slate-200 dark:bg-gray-900">
        <input type="file" ref={imageUploadInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
        <div className="flex flex-row flex-1 overflow-hidden">
            {/* Left Sidebar */}
            <div className="w-[320px] bg-white dark:bg-slate-900 border-r dark:border-slate-700/80 flex flex-col shadow-lg z-10">
                <div className="p-2 border-b dark:border-slate-700/80">
                    <div className="flex bg-slate-100 dark:bg-slate-800/50 p-1 rounded-lg">
                        <button onClick={() => setSidebarView('toolbar')} className={`flex-1 py-1.5 rounded-md text-sm font-semibold transition-colors ${sidebarView === 'toolbar' ? 'bg-white dark:bg-slate-700 shadow text-slate-800 dark:text-slate-200' : 'text-slate-500 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'}`}>Toolbar</button>
                        <button onClick={() => setSidebarView('chat')} className={`flex-1 py-1.5 rounded-md text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${sidebarView === 'chat' ? 'bg-white dark:bg-slate-700 shadow text-slate-800 dark:text-slate-200' : 'text-slate-500 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'}`}><AiIcon className="w-4 h-4 text-indigo-500" /></button>
                        <button onClick={() => setSidebarView('gallery')} className={`flex-1 py-1.5 rounded-md text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${sidebarView === 'gallery' ? 'bg-white dark:bg-slate-700 shadow text-slate-800 dark:text-slate-200' : 'text-slate-500 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'}`}><GalleryIcon className="w-4 h-4" /></button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {sidebarView === 'toolbar' && (
                        <EditorSidebar 
                            styles={styles} 
                            onStyleChange={(key, value) => handleStateUpdate(s => { const newS = {...s, styles: {...s.styles, [key]: value}}; newS.paper.htmlContent = generateHtmlFromPaperData(newS.paper, { logoConfig: (newS.logo.position.startsWith('header')) ? { src: newS.logo.src, alignment: newS.logo.position.replace('header-', '') as 'left' | 'center' | 'right' } : undefined }); return newS; })} 
                            paperSize={paperSize} 
                            onPaperSizeChange={setPaperSize}
                            logo={logo}
                            watermark={watermark}
                            onBrandingUpdate={handleBrandingUpdate}
                            onOpenImageModal={() => setImageModalVisible(true)}
                            onUploadImageClick={() => imageUploadInputRef.current?.click()}
                            isAnswerKeyMode={viewMode === 'answerKey'}
                            showQuestionsInKey={showQuestionsInKey}
                            onToggleShowQuestions={() => setShowQuestionsInKey(prev => !prev)}
                        />
                    )}
                    {sidebarView === 'chat' && (
                        <CoEditorChat messages={coEditorMessages} isTyping={isCoEditorTyping} onSendMessage={handleCoEditorSend} />
                    )}
                    {sidebarView === 'gallery' && (
                        <ImageGallery 
                            isCompact 
                            onEditImage={(img) => setImageToEditInPro(img)} 
                        />
                    )}
                </div>
            </div>

            {/* Main Canvas */}
            <main 
                ref={editorContentRef} 
                className="flex-1 overflow-auto p-8 relative"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
            >
                {viewMode === 'questionPaper' && <RichTextToolbar editorRef={pagesContainerRef} isExporting={isExporting} />}
                
                {viewMode === 'answerKey' && (
                    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 px-4 py-2 rounded-full shadow-sm z-20 font-bold text-sm flex items-center gap-2">
                         <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> Answer Key Editor
                    </div>
                )}

                <div ref={pagesContainerRef} style={{ fontFamily: styles.fontFamily }}>
                    {pagesHtml.map((html, pageIndex) => (
                        <div key={pageIndex} className="paper-page-container mx-auto mb-8 relative" style={{ width: `${paperSize === 'a4' ? A4_WIDTH_PX : LETTER_WIDTH_PX}px`, height: `${paperSize === 'a4' ? A4_HEIGHT_PX : LETTER_HEIGHT_PX}px` }}>
                            <div className="paper-page bg-white dark:bg-slate-900 shadow-2xl w-full h-full relative" style={{border: `${styles.borderWidth}px ${styles.borderStyle} ${styles.borderColor}`}}>
                                <WatermarkOverlay watermark={watermark} />
                                <div className="paper-content-host prose dark:prose-invert max-w-none p-[70px] overflow-hidden"
                                    dangerouslySetInnerHTML={{ __html: html }}
                                    onInput={(e) => handleContentChange(pageIndex, (e.target as HTMLDivElement).innerHTML)}
                                    contentEditable={viewMode === 'questionPaper'}
                                    suppressContentEditableWarning
                                />
                                {images.filter(img => img.pageIndex === pageIndex).map(img => <EditableImage key={img.id} imageState={img} onUpdate={handleUpdateImage} onDelete={handleDeleteImage} onAiEdit={handleAiImageEdit} />)}
                                {textBoxes.filter(tb => tb.pageIndex === pageIndex).map(tb => <EditableTextBox key={tb.id} textBoxState={tb} onUpdate={handleUpdateTextBox} onDelete={handleDeleteTextBox} />)}
                            </div>
                        </div>
                    ))}
                </div>
            </main>
        </div>
        {isImageModalVisible && <ImageGenerationModal onClose={() => setImageModalVisible(false)} onInsertImage={(data, w, h) => handleInsertGeneratedImage(data, w, h)} initialPrompt={imageGenPrompt} />}
        {imageToEditInPro && <ProImageEditor image={imageToEditInPro} onClose={() => setImageToEditInPro(null)} />}
      </div>
    );
});

export default Editor;
