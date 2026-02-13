import { GoogleGenAI, Type, FunctionDeclaration, Modality, Chat, Part, GenerateContentResponse } from "@google/genai";
import { type FormData, type QuestionPaperData, QuestionType, Question, Difficulty, Taxonomy, AnalysisResult } from '../types';
import { generateHtmlFromPaperData } from "./htmlGenerator";
export { generateHtmlFromPaperData };

const handleApiError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    if (error?.message?.includes("Safety")) {
        throw new Error("The content was flagged by safety filters. Please try rephrasing your topics or materials.");
    }
    throw new Error(`AI Generation Failed (${context}). Please try again.`);
};

export const extractConfigFromTranscript = async (transcript: string): Promise<any> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Extract exam configuration from: "${transcript}". Return JSON: {schoolName, className, subject, topics, difficulty, timeAllowed, questionDistribution: [{type, count, marks, taxonomy, difficulty}]}. Use LaTeX with double backslashes for any math.`;
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
You are a Senior Academic Examiner. Generate a high-quality examination paper in JSON format.

**LANGUAGE (TOP PRIORITY):**
- You MUST generate ALL text (questions, options, instructions) in **${language}**.
- Use correct academic terminology for the requested language.

**MATHEMATICAL FORMATTING:**
1. **LATEX:** Use LaTeX for ALL math formulas, variables ($x$), and symbols ($5 \\times 4$).
2. **ESCAPING:** You MUST use DOUBLE BACKSLASHES (e.g. \\\\frac, \\\\times) in the JSON strings.

**STRUCTURAL RULES:**
- **NO PREFIXES:** Do NOT include numbering like "1. ", "a)", or labels like "Column A:".
- **MCQ OPTIONS:** Provide exactly 4 options as an array of strings.
- **MATCH THE FOLLOWING:** Options MUST be an object: {"columnA": ["Item 1", "Item 2"...], "columnB": ["Correct Match 2", "Correct Match 1"...]}.
- **VALIDITY:** Ensure every question object is complete and fits the grade level.

**EXAM PARAMETERS:**
Subject: ${subject} | Grade: ${className} | Topics: ${topics} | Marks: ${totalMarks} | Time: ${timeAllowed}
Question Mix: ${JSON.stringify(questionDistribution)}
${sourceMaterials ? `Reference Content: ${sourceMaterials}` : ''}

Return only a valid JSON array of question objects.
`;

    try {
        const response = await ai.models.generateContent({
            model: modelToUse,
            contents: finalPrompt,
            config: { 
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            type: { type: Type.STRING, description: "One of: Multiple Choice, Fill in the Blanks, True / False, Short Answer, Long Answer, Match the Following" },
                            questionText: { type: Type.STRING },
                            options: { 
                                type: Type.NULL, // We let the model handle the dynamic shape in JSON, but prompt it heavily.
                                description: "Array of strings for MCQ, or {columnA:[], columnB:[]} for Matching. Null for others."
                            },
                            answer: { type: Type.STRING, description: "The correct answer or solution." },
                            marks: { type: Type.NUMBER },
                            difficulty: { type: Type.STRING },
                            taxonomy: { type: Type.STRING }
                        },
                        required: ["type", "questionText", "marks"]
                    }
                }
            }
        });

        const text = response.text || "[]";
        // Clean markdown artifacts if they exist
        const jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const generatedQuestionsRaw = JSON.parse(jsonText) as any[];
        
        if (!Array.isArray(generatedQuestionsRaw) || generatedQuestionsRaw.length === 0) {
            throw new Error("AI returned an invalid or empty paper structure.");
        }

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
        
        // Ensure HTML is generated before returning
        structuredPaperData.htmlContent = generateHtmlFromPaperData(structuredPaperData);
        
        return structuredPaperData;
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
    return ai.chats.create({
        model: "gemini-3-pro-preview",
        config: {
            systemInstruction: `You are an expert exam editor. Modify the paper based on user instructions. 
            STRICT MATH: Use LaTeX with double backslashes. 
            MATCH THE FOLLOWING: Ensure options are {columnA: [], columnB: []}. 
            LANGUAGE: Always use the language originally used in the paper.`
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
        contents: `OCR/Analyze this text to JSON. Math MUST be LaTeX with DOUBLE backslashes ($...$). MTF options must be {columnA: [], columnB: []}. Text: ${text}`,
        config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text) as AnalysisResult;
};

export const analyzeHandwrittenImages = async (imageParts: Part[]): Promise<AnalysisResult> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts: [...imageParts, { text: "Analyze handwritten questions to JSON. Math MUST be LaTeX with double backslashes. MTF must use {columnA: [], columnB: []}." }] },
        config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text) as AnalysisResult;
};