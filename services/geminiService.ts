import { GoogleGenAI, Type, FunctionDeclaration, Modality, Chat, Part, GenerateContentResponse } from "@google/genai";
import { type FormData, type QuestionPaperData, QuestionType, Question, Difficulty, Taxonomy, AnalysisResult } from '../types';
import { generateHtmlFromPaperData } from "./htmlGenerator";
export { generateHtmlFromPaperData };

const handleApiError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    throw new Error("Internal Error Occurred");
};

export const extractConfigFromTranscript = async (transcript: string): Promise<any> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Extract exam configuration from: "${transcript}". Return JSON: {schoolName, className, subject, topics, difficulty, timeAllowed, questionDistribution: [{type, count, marks, taxonomy}]}. Use LaTeX with double backslashes for any math.`;
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        return JSON.parse(response.text);
    } catch (error) {
        handleApiError(error, "extractConfigFromTranscript");
    }
};

export const generateQuestionPaper = async (formData: FormData): Promise<QuestionPaperData> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const { schoolName, className, subject, topics, questionDistribution, totalMarks, language, timeAllowed, sourceMaterials, modelQuality } = formData;
    const modelToUse = modelQuality === 'pro' ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';

    const finalPrompt = `
You are a Senior Academic Examiner and Question Paper Designer. Your goal is to generate a professional, high-quality, and strictly formatted exam paper.

**CRITICAL FORMATTING RULES:**
1. **NO AUTO-NUMBERING:** Do NOT include numbers like "1. ", "2. ", or "Q1. " inside the "questionText" field. The system handles numbering automatically.
2. **MULTIPLE CHOICE QUESTIONS:** For Multiple Choice types, you MUST provide exactly 4 distinct and plausible options in the "options" field as an array of strings. 
3. **MATHEMATICAL CONTENT:** Use LaTeX for ALL math symbols, formulas, and fractions. Wrap them in single dollar signs, e.g., $\\frac{1}{2}$. 
4. **JSON ESCAPING:** Use DOUBLE BACKSLASHES for LaTeX commands within the JSON strings (e.g., "\\\\times", "\\\\frac").
5. **TONE:** Maintain a formal academic tone suitable for Class ${className} students.

**EXAM PARAMETERS:**
- School: ${schoolName}
- Subject: ${subject}
- Class: ${className}
- Topics: ${topics}
- Language: ${language}
- Total Marks: ${totalMarks}
- Time: ${timeAllowed}
- Question Mix: ${JSON.stringify(questionDistribution)}

Return a JSON array of objects following this strict schema:
[{ "type": "QuestionType", "questionText": "string", "options": ["opt1", "opt2", "opt3", "opt4"] | null, "answer": "string", "marks": number, "difficulty": "string", "taxonomy": "string" }]
`;

    try {
        const response = await ai.models.generateContent({
            model: modelToUse,
            contents: finalPrompt,
            config: { 
                responseMimeType: "application/json",
            }
        });

        const generatedQuestionsRaw = JSON.parse(response.text) as any[];
        const processedQuestions: Question[] = generatedQuestionsRaw.map((q, index) => ({
            ...q,
            options: q.options || null,
            answer: q.answer || '',
            questionNumber: index + 1
        }));

        const paperId = `paper-${Date.now()}`;
        const structuredPaperData: QuestionPaperData = {
            id: paperId, schoolName, className, subject, totalMarks: String(totalMarks),
            timeAllowed, questions: processedQuestions, htmlContent: '', createdAt: new Date().toISOString(),
        };
        
        return { ...structuredPaperData, htmlContent: generateHtmlFromPaperData(structuredPaperData) };
    } catch (error) {
        handleApiError(error, "generateQuestionPaper");
        throw error;
    }
};

export const generateImage = async (prompt: string, aspectRatio: string = '1:1'): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: prompt,
            config: { imageConfig: { aspectRatio: aspectRatio as any } }
        });
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
        throw new Error("Internal Error Occurred");
    } catch (error) {
        handleApiError(error, "generateImage");
        throw error;
    }
};

export const createEditingChat = (paperData: QuestionPaperData) => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const tools: FunctionDeclaration[] = [
        {
            name: 'addQuestion',
            description: 'Insert a new question. Use DOUBLE backslashes for LaTeX commands.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    type: { type: Type.STRING, enum: Object.values(QuestionType) },
                    questionText: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    answer: { type: Type.STRING },
                    marks: { type: Type.NUMBER },
                },
                required: ['type', 'questionText', 'answer', 'marks']
            }
        },
        {
            name: 'updateQuestion',
            description: 'Modify an existing question content.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    questionNumber: { type: Type.NUMBER },
                    updates: {
                        type: Type.OBJECT,
                        properties: {
                            questionText: { type: Type.STRING },
                            answer: { type: Type.STRING },
                            marks: { type: Type.NUMBER },
                        }
                    }
                },
                required: ['questionNumber', 'updates']
            }
        },
        {
            name: 'deleteQuestion',
            description: 'Remove a question.',
            parameters: {
                type: Type.OBJECT,
                properties: { questionNumber: { type: Type.NUMBER } },
                required: ['questionNumber']
            }
        }
    ];
    return ai.chats.create({
        model: "gemini-3-pro-preview",
        config: {
            systemInstruction: `You are an expert exam editor. Use tools to modify the paper based on user requests. STRICT MATH: Use LaTeX commands with DOUBLE backslashes in tool arguments (e.g. "$\\times$").`,
            tools: [{ functionDeclarations: tools }]
        }
    });
};

export const getAiEditResponse = async (chat: Chat, instruction: string) => {
    const response = await chat.sendMessage({ message: instruction });
    return { functionCalls: response.functionCalls || null, text: response.text || null };
};

export const generateChatResponseStream = async (chat: Chat, messageParts: Part[], useSearch?: boolean, useThinking?: boolean): Promise<AsyncGenerator<GenerateContentResponse>> => {
    const config: any = {};
    if (useSearch) config.tools = [{ googleSearch: {} }];
    if (useThinking) config.thinkingConfig = { thinkingBudget: 4096 };
    return chat.sendMessageStream({ message: messageParts, config });
};

export const generateTextToSpeech = async (text: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: text,
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
};

export const analyzePastedText = async (text: string): Promise<AnalysisResult> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `OCR/Analyze this text into JSON. Math must be LaTeX with double backslashes and wrapped in $ delimiters. Text: ${text}`,
        config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text) as AnalysisResult;
};

export const analyzeHandwrittenImages = async (imageParts: Part[]): Promise<AnalysisResult> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts: [...imageParts, { text: "OCR this handwritten exam to JSON. Use LaTeX math with double backslashes and wrap in $ delimiters." }] },
        config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text) as AnalysisResult;
};
