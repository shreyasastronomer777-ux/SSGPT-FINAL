
import React from 'react';
import { type PaperStyles, type WatermarkState, type LogoState } from '../types';
import { UploadIcon } from './icons/UploadIcon';
import { ImageIcon } from './icons/ImageIcon';
import { PenIcon } from './icons/PenIcon';


type PaperSize = 'a4' | 'letter';

const ChevronRightIcon = (props: React.SVGProps<SVGSVGElement>) => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="m9 18 6-6-6-6"/></svg>;
const AlignLeftIcon = (props: React.SVGProps<SVGSVGElement>) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M3 4h18v2H3V4zm0 15h12v2H3v-2zm0-5h18v2H3v-2zm0-5h12v2H3V9z"></path></svg>;
const AlignCenterIcon = (props: React.SVGProps<SVGSVGElement>) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M3 4h18v2H3V4zm3 15h12v2H6v-2zm-3-5h18v2H3v-2zm3-5h12v2H6V9z"></path></svg>;
const AlignRightIcon = (props: React.SVGProps<SVGSVGElement>) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M3 4h18v2H3V4zm6 15h12v2H9v-2zm-6-5h18v2H3v-2zm6-5h12v2H9V9z"></path></svg>;
const BackgroundIcon = (props: React.SVGProps<SVGSVGElement>) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM4 4h16v11l-3.5-4.5-2.5 3.01L11.5 9l-4.5 6H4V4z"></path></svg>;
const NoneIcon = (props: React.SVGProps<SVGSVGElement>) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M19.78 4.22a.75.75 0 00-1.06-1.06L4.22 18.72a.75.75 0 001.06 1.06L19.78 4.22z"></path><path d="M18.72 4.22a.75.75 0 00-1.06 1.06L2.22 19.78a.75.75 0 001.06-1.06L18.72 4.22z"></path></svg>;

interface EditorSidebarProps {
    styles: PaperStyles;
    onStyleChange: (style: keyof PaperStyles, value: string | number) => void;
    paperSize: PaperSize;
    onPaperSizeChange: (size: PaperSize) => void;
    logo: LogoState;
    watermark: WatermarkState;
    onBrandingUpdate: (updates: Partial<{ logo: LogoState; watermark: WatermarkState }>) => void;
    onOpenImageModal: () => void;
    onUploadImageClick: () => void;
    isAnswerKeyMode?: boolean;
    showQuestionsInKey?: boolean;
    onToggleShowQuestions?: () => void;
}

const fonts = [ { value: "'Times New Roman', Times, serif", label: 'Times New Roman' }, { value: 'Arial, Helvetica, sans-serif', label: 'Arial' }, { value: 'serif', label: 'Serif' }, { value: 'sans-serif', label: 'Sans-Serif' }, { value: "'Courier New', Courier, monospace", label: 'Courier New' }, { value: 'monospace', label: 'Monospace' }, ];
const borderStyles = [ { value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }, { value: 'double', label: 'Double' }, ];

const watermarkPresets = [
    { name: 'Diagonal Draft', style: { text: 'DRAFT', rotation: -45, fontSize: 120, opacity: 0.08, color: '#888888'} },
    { name: 'Confidential', style: { text: 'CONFIDENTIAL', rotation: 0, fontSize: 80, opacity: 0.1, color: '#c44536' } },
    { name: 'Centered Sample', style: { text: 'SAMPLE', rotation: 0, fontSize: 130, opacity: 0.07, color: '#366bc4' } },
    { name: 'Angled Urgent', style: { text: 'URGENT', rotation: -25, fontSize: 100, opacity: 0.1, color: '#c436a2' } },
    { name: 'Copyright Notice', style: { text: `© ${new Date().getFullYear()}`, rotation: 0, fontSize: 20, opacity: 0.5, color: '#000000' } },
    { name: 'Repeated Copy', style: { text: 'COPY', rotation: -30, fontSize: 40, opacity: 0.06, color: '#555555' } },
];
const logoPositions: { value: LogoState['position']; label: string; icon: React.FC<any> }[] = [
    { value: 'header-left', label: 'Header Left', icon: AlignLeftIcon },
    { value: 'header-center', label: 'Header Center', icon: AlignCenterIcon },
    { value: 'header-right', label: 'Header Right', icon: AlignRightIcon },
    { value: 'none', label: 'None', icon: NoneIcon },
    { value: 'background', label: 'Background', icon: BackgroundIcon },
];

const TextControl: React.FC<{label: string, value: string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void}> = ({ label, value, onChange }) => (
    <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>
        <input type="text" value={value} onChange={onChange} className="w-full p-2 text-sm rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 shadow-sm focus:ring-indigo-500 focus:border-indigo-500" />
    </div>
);
const ColorControl: React.FC<{label: string, value: string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void}> = ({ label, value, onChange }) => (
    <div className="flex justify-between items-center">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
        <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-mono">{value}</span>
            <div className="relative w-8 h-8 rounded-full overflow-hidden shadow-sm border border-gray-200 dark:border-gray-600">
                <input type="color" value={value} onChange={onChange} className="absolute -top-2 -left-2 w-12 h-12 p-0 border-none cursor-pointer" />
            </div>
        </div>
    </div>
);
const RangeControl: React.FC<{label: string, value: number, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void, min: number, max: number, step: number, unit?: string}> = ({ label, value, onChange, min, max, step, unit }) => (
    <div>
        <div className="flex justify-between items-center mb-1">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">{value}{unit}</span>
        </div>
        <input type="range" value={value} onChange={onChange} min={min} max={max} step={step} className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
    </div>
);

const SelectControl: React.FC<{label: string, value: string, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void, options: {value: string; label: string}[]}> = ({ label, value, onChange, options }) => (
    <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>
        <select value={value} onChange={onChange} className="w-full p-2 text-sm rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 shadow-sm focus:ring-indigo-500 focus:border-indigo-500">
            {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
    </div>
);

const EditorSidebar: React.FC<EditorSidebarProps> = ({ styles, onStyleChange, paperSize, onPaperSizeChange, logo, watermark, onBrandingUpdate, onOpenImageModal, onUploadImageClick, isAnswerKeyMode, showQuestionsInKey, onToggleShowQuestions }) => {
    
    const handleWatermarkUpdate = (updates: Partial<WatermarkState>) => onBrandingUpdate({ watermark: { ...watermark, ...updates } });
    const handleLogoUpdate = (updates: Partial<LogoState>) => onBrandingUpdate({ logo: { ...logo, ...updates } });

    const handleWatermarkImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => { handleWatermarkUpdate({ src: event.target?.result as string }); };
            reader.readAsDataURL(file);
        }
        e.target.value = '';
    };

    return (
        <div className="p-4 space-y-4 pb-20">
            {!isAnswerKeyMode && (
                <div className="grid grid-cols-3 gap-2 bg-slate-100 dark:bg-slate-900/50 p-2 rounded-xl">
                    <RibbonButton icon={<AlignLeftIcon className="w-5 h-5"/>} label="Left" disabled />
                    <RibbonButton icon={<AlignCenterIcon className="w-5 h-5"/>} label="Center" disabled />
                    <RibbonButton icon={<AlignRightIcon className="w-5 h-5"/>} label="Right" disabled />
                    <RibbonButton icon={<UploadIcon className="w-5 h-5"/>} label="Upload" onClick={onUploadImageClick} />
                    <RibbonButton icon={<ImageIcon className="w-5 h-5"/>} label="AI Art" onClick={onOpenImageModal} />
                    <RibbonButton icon={<PenIcon className="w-5 h-5"/>} label="Draw" disabled />
                </div>
            )}

            {isAnswerKeyMode && (
                <ControlGroup title="Answer Key Settings" isOpenDefault>
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Show Questions</label>
                        <button 
                            onClick={onToggleShowQuestions}
                            className={`w-11 h-6 rounded-full transition-colors relative ${showQuestionsInKey ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                        >
                            <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${showQuestionsInKey ? 'translate-x-5' : ''}`} />
                        </button>
                    </div>
                </ControlGroup>
            )}

            <ControlGroup title="Watermark" isOpenDefault={isAnswerKeyMode}>
                <SelectControl label="Type" value={watermark.type} onChange={e => handleWatermarkUpdate({ type: e.target.value as WatermarkState['type'] })} options={[{value: 'none', label: 'None'}, {value: 'text', label: 'Text'}, {value: 'image', label: 'Image'}]} />
                
                {watermark.type === 'text' && (
                    <div className="space-y-4 animate-fade-in-fast">
                         <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Presets</label>
                            <div className="grid grid-cols-2 gap-2">
                                {watermarkPresets.map(p => <WatermarkPreset key={p.name} name={p.name} style={p.style} onClick={() => handleWatermarkUpdate(p.style)} />)}
                            </div>
                        </div>
                        <div className="pl-2 border-l-2 dark:border-slate-600 space-y-4 pt-2">
                            <TextControl label="Text" value={watermark.text || ''} onChange={e => handleWatermarkUpdate({ text: e.target.value })} />
                            <ColorControl label="Color" value={watermark.color} onChange={e => handleWatermarkUpdate({ color: e.target.value })} />
                            <RangeControl label="Font Size" value={watermark.fontSize} onChange={e => handleWatermarkUpdate({ fontSize: parseInt(e.target.value, 10)})} min={20} max={200} step={2} unit="px" />
                            <RangeControl label="Opacity" value={watermark.opacity} onChange={e => handleWatermarkUpdate({ opacity: parseFloat(e.target.value)})} min={0.05} max={1} step={0.05} />
                            <RangeControl label="Rotation" value={watermark.rotation} onChange={e => handleWatermarkUpdate({ rotation: parseInt(e.target.value, 10)})} min={-90} max={90} step={5} unit="°" />
                        </div>
                    </div>
                )}

                {watermark.type === 'image' && (
                     <div className="pl-2 border-l-2 dark:border-slate-600 space-y-4 animate-fade-in-fast">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Upload Image</label>
                        <input type="file" id="watermark-upload" accept="image/png, image/jpeg" onChange={handleWatermarkImageUpload} className="hidden" />
                        <label htmlFor="watermark-upload" className="cursor-pointer w-full flex items-center justify-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400 p-3 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                            <UploadIcon className="w-5 h-5"/> {watermark.src ? 'Change Image' : 'Choose an Image'}
                        </label>
                        {watermark.src && <img src={watermark.src} alt="Watermark preview" className="max-w-full h-auto rounded-md border dark:border-slate-600 bg-slate-100 dark:bg-slate-700 p-2 object-contain max-h-24 mx-auto" />}
                        <RangeControl label="Opacity" value={watermark.opacity} onChange={e => handleWatermarkUpdate({ opacity: parseFloat(e.target.value)})} min={0.05} max={1} step={0.05} />
                        <RangeControl label="Rotation" value={watermark.rotation} onChange={e => handleWatermarkUpdate({ rotation: parseInt(e.target.value, 10)})} min={-90} max={90} step={5} unit="°" />
                    </div>
                )}
            </ControlGroup>
            
            <ControlGroup title="Typography">
                <SelectControl label="Font Family" value={styles.fontFamily} onChange={e => onStyleChange('fontFamily', e.target.value)} options={fonts} />
                <ColorControl label="Heading Color" value={styles.headingColor} onChange={e => onStyleChange('headingColor', e.target.value)} />
            </ControlGroup>
            
            <ControlGroup title="Border">
                <ColorControl label="Border Color" value={styles.borderColor} onChange={e => onStyleChange('borderColor', e.target.value)} />
                <SelectControl label="Border Style" value={styles.borderStyle} onChange={e => onStyleChange('borderStyle', e.target.value)} options={borderStyles} />
                <RangeControl label="Border Width" value={styles.borderWidth} onChange={e => onStyleChange('borderWidth', parseInt(e.target.value, 10))} min={0} max={10} step={1} unit="px" />
            </ControlGroup>

            <ControlGroup title="Page & Logo Layout">
                <SelectControl label="Paper Size" value={paperSize} onChange={e => onPaperSizeChange(e.target.value as PaperSize)} options={[{value: 'a4', label: 'A4 (210 x 297mm)'}, {value: 'letter', label: 'Letter (8.5 x 11in)'}]} />
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Logo Position</label>
                    <div className="flex items-center justify-between p-1 bg-slate-100 dark:bg-slate-700 rounded-lg mt-1">
                        {logoPositions.map(({value, label, icon: Icon}) => (
                            <button key={value} onClick={() => handleLogoUpdate({ position: value })} disabled={!logo.src} title={label}
                                className={`flex-1 p-2 rounded-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${logo.position === value ? 'bg-white dark:bg-slate-800 shadow-md text-indigo-600 scale-105 ring-1 ring-black/5' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                                <Icon className="w-5 h-5 mx-auto"/>
                            </button>
                        ))}
                    </div>
                </div>
                 {logo.position === 'background' && logo.src && (
                    <div className="pl-2 border-l-2 dark:border-slate-600 space-y-4 animate-fade-in-fast">
                         <RangeControl label="Size" value={logo.size} onChange={e => handleLogoUpdate({ size: parseInt(e.target.value, 10)})} min={50} max={500} step={10} unit="px" />
                         <RangeControl label="Opacity" value={logo.opacity} onChange={e => handleLogoUpdate({ opacity: parseFloat(e.target.value)})} min={0.05} max={1} step={0.05} />
                    </div>
                )}
             </ControlGroup>
        </div>
    );
};

const RibbonButton: React.FC<{ icon: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean; }> = ({ icon, label, onClick, disabled }) => (
    <button 
        onClick={onClick} 
        disabled={disabled} 
        className="group relative flex flex-col items-center justify-center p-3 rounded-lg transition-all duration-300 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-800 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none border border-transparent hover:border-indigo-100 dark:hover:border-indigo-900/50"
    >
        <div className="transition-transform group-hover:scale-110 duration-300">{icon}</div>
        <span className="text-[10px] font-semibold mt-1 opacity-70 group-hover:opacity-100">{label}</span>
    </button>
);

const WatermarkPreset: React.FC<{name: string, style: Partial<WatermarkState>, onClick: () => void}> = ({ name, style, onClick }) => (
    <button onClick={onClick} className="p-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors text-left space-y-1 hover:shadow-sm">
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{name}</p>
        <div className="w-full h-12 bg-slate-200 dark:bg-slate-800 rounded-sm flex items-center justify-center overflow-hidden relative">
            <div className="absolute inset-0 bg-grid-slate-300/50 [mask-image:linear-gradient(0deg,white,transparent)]"></div>
            <p className="font-black whitespace-nowrap relative z-10" style={{ transform: `rotate(${style.rotation || 0}deg) scale(0.4)`, color: style.color, opacity: (style.opacity || 0.1) * 5 }}>
                {style.text}
            </p>
        </div>
    </button>
);
const ControlGroup: React.FC<{ title: string; children: React.ReactNode, isOpenDefault?: boolean }> = ({ title, children, isOpenDefault = false }) => ( <details className="control-group border-b border-slate-200 dark:border-slate-700 last:border-b-0" open={isOpenDefault}><summary className="py-3 cursor-pointer flex justify-between items-center w-full hover:text-indigo-600 transition-colors"><h4 className="font-semibold text-slate-800 dark:text-slate-200">{title}</h4><ChevronRightIcon className="chevron w-4 h-4 text-slate-500 transition-transform"/></summary><div className="pb-4 space-y-4 animate-fade-in-fast">{children}</div></details> );

export default EditorSidebar;
