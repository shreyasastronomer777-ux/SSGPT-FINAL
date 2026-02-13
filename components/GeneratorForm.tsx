import React, { useState, useMemo, useEffect, useRef } from 'react';
import { type FormData, QuestionType, type QuestionDistributionItem, Difficulty, Taxonomy, User } from '../types';
import { LANGUAGES, QUESTION_TYPES, DIFFICULTY_LEVELS, BLOOM_TAXONOMY_LEVELS } from '../constants';
import { VoiceConfigurator } from './VoiceConfigurator';

interface GeneratorFormProps {
  onSubmit: (formData: FormData) => void;
  isLoading: boolean;
  user: User;
}

const PlusIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M5 12h14"/><path d="M12 5v14"/></svg>
);

const TrashIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
);

const DragHandleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" {...props}>
        <circle cx="9" cy="12" r="1.5"></circle><circle cx="9" cy="5" r="1.5"></circle><circle cx="9" cy="19" r="1.5"></circle>
        <circle cx="15" cy="12" r="1.5"></circle><circle cx="15" cy="5" r="1.5"></circle><circle cx="15" cy="19" r="1.5"></circle>
    </svg>
);

const FormField: React.FC<{name: string, label: string, value: string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void, error?: string, as?: 'textarea' | 'input', placeholder?: string}> = ({ name, label, value, onChange, error, as='input', placeholder }) => {
    const commonProps = {
        id: name,
        name: name,
        value: value,
        onChange: onChange,
        placeholder,
        className: `block w-full rounded-lg border-0 py-2.5 px-4 text-gray-900 dark:text-white bg-white dark:bg-slate-900/50 shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-slate-700 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6 transition ${error ? 'ring-red-500' : ''}`
    };
    return (
        <div>
            <label htmlFor={name} className="block text-sm font-medium leading-6 text-gray-900 dark:text-white mb-2">{label}</label>
            { as === 'textarea' ? <textarea {...commonProps} rows={4} /> : <input type="text" {...commonProps} /> }
            {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        </div>
    )
}

const GeneratorForm: React.FC<GeneratorFormProps> = ({ onSubmit, isLoading, user }) => {
  const [formData, setFormData] = useState({
    schoolName: user.defaultSchoolName || '',
    className: '',
    subject: '',
    topics: '',
    language: 'English',
    timeAllowed: '',
    sourceMaterials: '',
    sourceMode: 'reference' as 'strict' | 'reference',
    modelQuality: 'flash' as 'flash' | 'pro',
  });
  
  useEffect(() => {
    setFormData(prev => ({...prev, schoolName: user.defaultSchoolName || ''}));
  }, [user.defaultSchoolName]);

  const [questionDistribution, setQuestionDistribution] = useState<QuestionDistributionItem[]>([
    { id: `dist-${Date.now()}`, type: QuestionType.MultipleChoice, count: 5, marks: 1, difficulty: Difficulty.Medium, taxonomy: Taxonomy.Understanding },
  ]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; data: string; mimeType: string; }[]>([]);

  const dragItemIndex = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const totalMarks = useMemo(() => {
    return questionDistribution.reduce((acc, item) => acc + (item.count * item.marks), 0);
  }, [questionDistribution]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleTrySample = () => {
    setFormData({
        schoolName: "Imperial Heights Global School",
        className: "7th Grade",
        subject: "Physics",
        topics: "Motion, Force, Laws of Motion, Friction",
        language: "English",
        timeAllowed: "2 Hours",
        sourceMaterials: "",
        sourceMode: "reference",
        modelQuality: "flash"
    });
    setQuestionDistribution([
        { id: `sample-1`, type: QuestionType.MultipleChoice, count: 10, marks: 1, difficulty: Difficulty.Easy, taxonomy: Taxonomy.Remembering },
        { id: `sample-2`, type: QuestionType.TrueFalse, count: 5, marks: 1, difficulty: Difficulty.Easy, taxonomy: Taxonomy.Understanding },
        { id: `sample-3`, type: QuestionType.ShortAnswer, count: 5, marks: 2, difficulty: Difficulty.Medium, taxonomy: Taxonomy.Applying },
        { id: `sample-4`, type: QuestionType.LongAnswer, count: 2, marks: 5, difficulty: Difficulty.Hard, taxonomy: Taxonomy.Analyzing }
    ]);
    setErrors({});
  };

  const handleVoiceConfig = (extracted: any) => {
      setFormData(prev => ({
          ...prev,
          schoolName: extracted.schoolName || prev.schoolName,
          className: extracted.className || prev.className,
          subject: extracted.subject || prev.subject,
          topics: extracted.topics || prev.topics,
          timeAllowed: extracted.timeAllowed || prev.timeAllowed,
      }));
      
      if (extracted.questionDistribution && Array.isArray(extracted.questionDistribution)) {
          const newDist: QuestionDistributionItem[] = extracted.questionDistribution.map((d: any, i: number) => ({
              id: `voice-dist-${Date.now()}-${i}`,
              type: d.type as QuestionType,
              count: d.count || 5,
              marks: d.marks || 1,
              difficulty: d.difficulty || extracted.difficulty || Difficulty.Medium,
              taxonomy: d.taxonomy || Taxonomy.Understanding
          }));
          setQuestionDistribution(newDist);
      }
  };

  const handleDistributionChange = (id: string, field: keyof Omit<QuestionDistributionItem, 'id'>, value: string | number) => {
    setQuestionDistribution(prev =>
      prev.map(item =>
        item.id === id ? { ...item, [field]: (field === 'type' || field === 'difficulty' || field === 'taxonomy') ? value : Number(value) || 0 } : item
      )
    );
  };
  
  const addQuestionType = () => {
    const usedTypes = new Set(questionDistribution.map(d => d.type));
    const availableType = QUESTION_TYPES.find(qt => !usedTypes.has(qt.value as QuestionType));
    const newType = availableType ? availableType.value as QuestionType : QuestionType.ShortAnswer;
    setQuestionDistribution(prev => [...prev, { id: `dist-${Date.now()}`, type: newType, count: 5, marks: 1, difficulty: Difficulty.Medium, taxonomy: Taxonomy.Remembering }]);
  };

  const removeQuestionType = (id: string) => {
    if (questionDistribution.length > 1) {
      setQuestionDistribution(prev => prev.filter(item => item.id !== id));
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
      dragItemIndex.current = index;
      setDraggingIndex(index);
      e.dataTransfer.effectAllowed = 'move';
  };
  
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, index: number) => {
      if (dragItemIndex.current !== null) {
          const newDistribution = [...questionDistribution];
          const draggedItemContent = newDistribution[dragItemIndex.current];
          newDistribution.splice(dragItemIndex.current, 1);
          newDistribution.splice(index, 0, draggedItemContent);
          dragItemIndex.current = index;
          setQuestionDistribution(newDistribution);
      }
  };

  const handleDragEnd = () => {
      dragItemIndex.current = null;
      setDraggingIndex(null);
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.schoolName.trim()) newErrors.schoolName = "School name is required.";
    if (!formData.className.trim()) newErrors.className = "Class is required.";
    if (!formData.subject.trim()) newErrors.subject = "Subject is required.";
    if (!formData.topics.trim()) newErrors.topics = "Topics are required.";
    if (!formData.timeAllowed.trim()) newErrors.timeAllowed = "Time allowed is required.";
    if (totalMarks <= 0) newErrors.totalMarks = "Total marks must be greater than zero.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
        onSubmit({
            ...formData,
            questionDistribution,
            totalMarks,
            sourceFiles: attachedFiles,
        });
    }
  };

  return (
    <div className="max-w-5xl mx-auto animate-fade-in-up pb-10">
        <form onSubmit={handleSubmit} noValidate>
            <div className="bg-white dark:bg-slate-800/50 p-6 sm:p-8 rounded-2xl shadow-2xl border dark:border-slate-700/50 space-y-10">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h2 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Generate Exam Paper</h2>
                        <p className="mt-2 text-slate-600 dark:text-slate-400">Specify requirements or use AI power for any language.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button type="button" onClick={handleTrySample} className="px-4 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-bold rounded-full text-sm hover:bg-amber-200 transition-all border border-amber-200 dark:border-amber-800">
                            Try Sample
                        </button>
                        <VoiceConfigurator onConfigExtracted={handleVoiceConfig} />
                    </div>
                </div>

                <div className="space-y-6 border-t dark:border-slate-700 pt-8">
                    <div className="flex justify-between items-center">
                        <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">1. Paper Information</h3>
                        <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg">
                            <button type="button" onClick={() => setFormData(prev => ({...prev, modelQuality: 'flash'}))} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${formData.modelQuality === 'flash' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500'}`}>Flash (Fast)</button>
                            <button type="button" onClick={() => setFormData(prev => ({...prev, modelQuality: 'pro'}))} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${formData.modelQuality === 'pro' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-500'}`}>Pro (Complex)</button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField name="schoolName" label="School Name" value={formData.schoolName} onChange={handleChange} error={errors.schoolName} placeholder="Enter school/college name" />
                        <FormField name="className" label="Class / Grade" value={formData.className} onChange={handleChange} error={errors.className} placeholder="e.g. 10th Grade" />
                        <FormField name="subject" label="Subject" value={formData.subject} onChange={handleChange} error={errors.subject} placeholder="e.g. Mathematics" />
                        <FormField name="timeAllowed" label="Time Allowed" value={formData.timeAllowed} onChange={handleChange} error={errors.timeAllowed} placeholder="e.g., 3 Hours" />
                        <div className="md:col-span-2">
                             <FormField name="topics" label="Topics" as="textarea" value={formData.topics} onChange={handleChange} error={errors.topics} placeholder="List chapters or specific topics..." />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">Language (AI supports 100+ languages)</label>
                            <select name="language" value={formData.language} onChange={handleChange} className="block w-full rounded-lg border-0 py-2.5 px-3 text-gray-900 dark:text-white bg-white dark:bg-slate-900/50 shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-slate-700 sm:text-sm">
                                {LANGUAGES.map(lang => <option key={lang} value={lang}>{lang}</option>)}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="border-t dark:border-slate-700 pt-8 space-y-4">
                    <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">2. Questions Configuration</h3>
                    <div className="space-y-3">
                        {questionDistribution.map((dist, index) => (
                             <div key={dist.id} draggable onDragStart={(e) => handleDragStart(e, index)} onDragEnter={(e) => handleDragEnter(e, index)} onDragEnd={handleDragEnd} onDragOver={e => e.preventDefault()}
                                className={`flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border dark:border-slate-700/50 transition-all ${draggingIndex === index ? 'opacity-30 scale-95' : 'hover:border-indigo-400'}`}
                             >
                                <div className="cursor-move text-slate-400"><DragHandleIcon className="w-5 h-5" /></div>
                                <div className="flex flex-wrap gap-4 items-end flex-grow">
                                    <div className="w-full md:w-auto md:flex-1 min-w-[140px]">
                                        <label className="text-[10px] font-bold uppercase text-slate-400">Type</label>
                                        <select value={dist.type} onChange={(e) => handleDistributionChange(dist.id, 'type', e.target.value)} className="w-full mt-1 p-2 rounded-md bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-sm">
                                            {QUESTION_TYPES.map(qt => <option key={qt.value} value={qt.value}>{qt.label}</option>)}
                                        </select>
                                    </div>
                                    <div className="w-20">
                                        <label className="text-[10px] font-bold uppercase text-slate-400">Qty</label>
                                        <input type="number" min="1" value={dist.count} onChange={(e) => handleDistributionChange(dist.id, 'count', e.target.value)} className="w-full mt-1 p-2 rounded-md bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-sm" />
                                    </div>
                                    <div className="w-20">
                                        <label className="text-[10px] font-bold uppercase text-slate-400">Marks</label>
                                        <input type="number" min="0" step="0.5" value={dist.marks} onChange={(e) => handleDistributionChange(dist.id, 'marks', e.target.value)} className="w-full mt-1 p-2 rounded-md bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-sm" />
                                    </div>
                                    <div className="w-32">
                                        <label className="text-[10px] font-bold uppercase text-slate-400">Difficulty</label>
                                        <select value={dist.difficulty} onChange={(e) => handleDistributionChange(dist.id, 'difficulty', e.target.value)} className="w-full mt-1 p-2 rounded-md bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-sm">
                                            {DIFFICULTY_LEVELS.map(dl => <option key={dl.value} value={dl.value}>{dl.label}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex-1 min-w-[140px]">
                                        <label className="text-[10px] font-bold uppercase text-slate-400">Bloom's</label>
                                        <select value={dist.taxonomy} onChange={(e) => handleDistributionChange(dist.id, 'taxonomy', e.target.value)} className="w-full mt-1 p-2 rounded-md bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-sm">
                                            {BLOOM_TAXONOMY_LEVELS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <button type="button" onClick={() => removeQuestionType(dist.id)} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"><TrashIcon className="w-5 h-5"/></button>
                            </div>
                        ))}
                    </div>
                     <button type="button" onClick={addQuestionType} className="mt-4 flex items-center gap-2 text-sm font-bold text-indigo-600 hover:underline">
                        <PlusIcon className="w-4 h-4"/> Add Section
                    </button>
                </div>
            </div>

             <div className="mt-8 flex flex-col sm:flex-row justify-end items-center gap-6">
                <div className="text-right">
                    <span className="text-slate-500 font-medium">Total Paper Marks:</span>
                    <span className="ml-2 text-3xl font-black text-slate-900 dark:text-white">{totalMarks}</span>
                </div>
                <button type="submit" disabled={isLoading} className="w-full sm:w-auto px-12 py-4 bg-indigo-600 text-white font-black rounded-xl shadow-xl hover:bg-indigo-700 hover:scale-105 active:scale-95 transition-all text-xl disabled:opacity-50 flex items-center justify-center gap-2">
                    {isLoading ? '✨ Generating...' : '✨ Generate Exam'}
                </button>
            </div>
        </form>
    </div>
  );
};

export default GeneratorForm;