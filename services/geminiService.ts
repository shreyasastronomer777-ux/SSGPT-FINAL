import { GoogleGenAI, Type, FunctionDeclaration, Modality, Chat, Part, GenerateContentResponse } from "@google/genai";
import { type FormData, type QuestionPaperData, QuestionType, Question, Difficulty, Taxonomy, AnalysisResult } from '../types';
import { generateHtmlFromPaperData } from "./htmlGenerator";
export { generateHtmlFromPaperData };

const handleApiError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    throw new Error("Internal Error Occurred");
};

export const generateQuestionPaper = async (formData: FormData): Promise<QuestionPaperData> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const { schoolName, className, subject, topics, questionDistribution, totalMarks, language, timeAllowed, sourceMaterials, modelQuality } = formData;
    const modelToUse = modelQuality === 'pro' ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';

    const finalPrompt = `
You are a Senior Academic Examiner. Generate a professional examination paper in JSON format.

**STRICT FORMATTING RULES:**
1. **NO AUTO-NUMBERING:** Do NOT include "1.", "2.", "(a)", or "Q1." inside the "questionText" or "options". The system handles numbering.
2. **MCQ OPTIONS:** For Multiple Choice, you MUST provide exactly 4 strings in the "options" array.
3. **MATHEMATICAL CONTENT:** Use LaTeX for ALL math content. Wrap in single dollar signs: $...$.
4. **JSON ESCAPING (CRITICAL):** Use DOUBLE BACKSLASHES for all LaTeX commands in the JSON string (e.g., "\\\\times", "\\\\frac", "\\\\div").
5. **TONE:** Formal academic tone for Class ${className}.

Return JSON array:
[{ "type": "string", "questionText": "string", "options": ["opt1", "opt2", "opt3", "opt4"], "answer": "string", "marks": number, "difficulty": "string", "taxonomy": "string" }]

Params: Subject: ${subject}, Topics: ${topics}, Marks: ${totalMarks}, Time: ${timeAllowed}.
`;

    try {
        const response = await ai.models.generateContent({
            model: modelToUse,
            contents: finalPrompt,
            config: { responseMimeType: "application/json" }
        });

        const questions = JSON.parse(response.text) as any[];
        const processedQuestions: Question[] = questions.map((q, index) => ({
            ...q,
            options: q.options || null,
            questionNumber: index + 1
        }));

        const paperData: QuestionPaperData = {
            id: `paper-${Date.now()}`, schoolName, className, subject, 
            totalMarks: String(totalMarks), timeAllowed, 
            questions: processedQuestions, htmlContent: '', createdAt: new Date().toISOString(),
        };
        
        return { ...paperData, htmlContent: generateHtmlFromPaperData(paperData) };
    } catch (error) {
        handleApiError(error, "generateQuestionPaper");
        throw error;
    }
};

export const createEditingChat = (paperData: QuestionPaperData) => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    return ai.chats.create({
        model: "gemini-3-pro-preview",
        config: {
            systemInstruction: `You are an exam editor. Use double backslashes for math like "$\\\\times$". Always include options for MCQs.`,
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

export const extractConfigFromTranscript = async (transcript: string): Promise<any> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Extract exam JSON from: "${transcript}"`,
        config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text);
};

export const generateImage = async (prompt: string, aspectRatio: string = '1:1'): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: prompt,
        config: { imageConfig: { aspectRatio: aspectRatio as any } }
    });
    for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
    throw new Error("Internal Error Occurred");
};

export const generateTextToSpeech = async (text: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: text,
        config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
};

export const analyzePastedText = async (text: string): Promise<AnalysisResult> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `OCR this text to JSON: ${text}`,
        config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text) as AnalysisResult;
};

export const analyzeHandwrittenImages = async (imageParts: Part[]): Promise<AnalysisResult> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts: [...imageParts, { text: "OCR handwritten exam to JSON" }] },
        config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text) as AnalysisResult;
};
