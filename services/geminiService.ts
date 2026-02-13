import { GoogleGenAI, Type, FunctionDeclaration, Modality, Chat, Part, GenerateContentResponse } from "@google/genai";
import { type FormData, type QuestionPaperData, QuestionType, Question, Difficulty, Taxonomy, AnalysisResult } from '../types';
import { generateHtmlFromPaperData } from "./htmlGenerator";
export { generateHtmlFromPaperData };

const handleApiError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    throw new Error("Internal AI Error: Failed to generate paper content. Please try again with a different model or adjusted parameters.");
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
You are a Senior Academic Examiner. Your task is to generate a professional examination paper in JSON format.

**LANGUAGE SUPPORT (CRITICAL):**
- Generate the ENTIRE content (questions, options, and answers) in the requested language: **${language}**.
- If the language is not English, ensure all characters are properly UTF-8 encoded.

**STRICT MATHEMATICAL FORMATTING (CRITICAL):**
1. **LATEX FOR ALL MATH:** Use LaTeX for ALL math formulas, symbols ($\times$, $\div$, etc.), variables ($x$), and units ($m/s$).
2. **REGIONAL TEXT IN MATH:** If using regional language text inside a math formula, use \text{...}, e.g., $\rho = \frac{\text{ದ್ರವ್ಯರಾಶಿ}}{\text{ಗಾತ್ರ}}$.
3. **JSON ESCAPING:** You MUST use DOUBLE BACKSLASHES (e.g. \\\\times, \\\\frac{a}{b}) for all LaTeX commands in the JSON strings.

**STRUCTURAL RULES:**
- **NO NUMBERING:** DO NOT include ANY numbering prefixes like "1. ", "Q1. ", "(i)", "a)", "Column A:" in the strings.
- **NON-EMPTY TEXT:** "questionText" must NEVER be empty. If the question is purely a formula, put the formula in "questionText".
- **MATCH THE FOLLOWING:** Options MUST be {"columnA": [...], "columnB": [...]}. Shuffle Column B.

**EXAM PARAMETERS:**
Subject: ${subject}
Grade: ${className}
Topics: ${topics}
Marks: ${totalMarks}
Time: ${timeAllowed}
Mix: ${JSON.stringify(questionDistribution)}
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
                            type: { type: Type.STRING },
                            questionText: { type: Type.STRING },
                            options: { 
                                type: Type.OBJECT,
                                properties: {
                                    columnA: { type: Type.ARRAY, items: { type: Type.STRING } },
                                    columnB: { type: Type.ARRAY, items: { type: Type.STRING } }
                                }
                            },
                            answer: { type: Type.STRING },
                            marks: { type: Type.INTEGER },
                            difficulty: { type: Type.STRING },
                            taxonomy: { type: Type.STRING }
                        },
                        required: ["type", "questionText", "marks"]
                    }
                }
            }
        });

        const jsonText = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
        const generatedQuestionsRaw = JSON.parse(jsonText) as any[];
        
        if (!generatedQuestionsRaw || generatedQuestionsRaw.length === 0) {
            throw new Error("AI returned an empty question list.");
        }

        const processedQuestions: Question[] = generatedQuestionsRaw.map((q, index) => {
            let options = q.options;
            // Handle Multiple Choice coming as array or object
            if (q.type === QuestionType.MultipleChoice && q.options && !Array.isArray(q.options)) {
                // If the model incorrectly used {columnA: [...]} for MCQ
                options = q.options.columnA || q.options.items || Object.values(q.options);
            }
            
            return {
                ...q,
                options: options || null,
                answer: q.answer || '',
                questionNumber: index + 1
            };
        });

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
    return ai.chats.create({
        model: "gemini-3-pro-preview",
        config: {
            systemInstruction: `You are an expert exam editor. Modify the JSON structure. 
            STRICT MATH: Always use LaTeX with double backslashes like "$\\\\times$". 
            MTF: options must be {columnA: [], columnB: []}. 
            ALWAYS preserve the requested language.`
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