import { GoogleGenAI, Type, FunctionDeclaration, Modality, Chat, Part, GenerateContentResponse } from "@google/genai";
import { type FormData, type QuestionPaperData, QuestionType, Question, Difficulty, Taxonomy, AnalysisResult } from '../types';
import { generateHtmlFromPaperData } from "./htmlGenerator";

const handleApiError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    throw new Error("Internal Error Occurred");
};

export const extractConfigFromTranscript = async (transcript: string): Promise<any> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const prompt = `Extract academic configuration from transcript: "${transcript}". Return JSON with keys: schoolName, className, subject, topics, difficulty (Easy/Medium/Hard), timeAllowed, questionDistribution (array of {type, count, marks, taxonomy}).`;

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
    const { schoolName, className, subject, topics, questionDistribution, totalMarks, language, timeAllowed, sourceMaterials, sourceFiles, modelQuality } = formData;

    const modelToUse = modelQuality === 'pro' ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';

    const finalPrompt = `
You are an expert Question Paper Designer. Generate a high-quality exam paper in JSON format.
STRICT MATH RULES: ALWAYS use LaTeX $...$ for ALL math, including fractions (\\frac{a}{b}), numeric variables, and symbols.

Paper Details:
Subject: ${subject}, Class: ${className}, Topics: ${topics}, Language: ${language}, Total Marks: ${totalMarks}, Time: ${timeAllowed}.
Question mix: ${JSON.stringify(questionDistribution)}
${sourceMaterials ? `Source Material: ${sourceMaterials}` : ''}

Return ONLY a JSON array of objects with fields: type, questionText, options, answer, marks, difficulty, taxonomy.
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
                            options: { type: Type.ARRAY, items: { type: Type.STRING } },
                            answer: { type: Type.STRING },
                            marks: { type: Type.NUMBER },
                            difficulty: { type: Type.STRING },
                            taxonomy: { type: Type.STRING },
                        },
                        required: ['type', 'questionText', 'answer', 'marks', 'difficulty', 'taxonomy']
                    }
                }
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

export const createEditingChat = (paperData: QuestionPaperData) => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const tools: FunctionDeclaration[] = [
        {
            name: 'addQuestion',
            description: 'Add a new question to the paper.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    type: { type: Type.STRING, enum: Object.values(QuestionType) },
                    questionText: { type: Type.STRING },
                    options: { type: Type.STRING, description: 'JSON string of options array for MCQs' },
                    answer: { type: Type.STRING },
                    marks: { type: Type.NUMBER },
                    difficulty: { type: Type.STRING, enum: Object.values(Difficulty) },
                    taxonomy: { type: Type.STRING, enum: Object.values(Taxonomy) },
                },
                required: ['type', 'questionText', 'answer', 'marks']
            }
        },
        {
            name: 'updateQuestion',
            description: 'Update an existing question.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    questionNumber: { type: Type.NUMBER },
                    updates: {
                        type: Type.OBJECT,
                        properties: {
                            questionText: { type: Type.STRING },
                            options: { type: Type.STRING },
                            answer: { type: Type.STRING },
                            marks: { type: Type.NUMBER },
                            difficulty: { type: Type.STRING },
                            taxonomy: { type: Type.STRING },
                        }
                    }
                },
                required: ['questionNumber', 'updates']
            }
        },
        {
            name: 'deleteQuestion',
            description: 'Delete a question by number.',
            parameters: {
                type: Type.OBJECT,
                properties: { questionNumber: { type: Type.NUMBER } },
                required: ['questionNumber']
            }
        },
        {
            name: 'updatePaperStyles',
            description: 'Update the global look of the paper.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    fontFamily: { type: Type.STRING },
                    headingColor: { type: Type.STRING },
                    borderColor: { type: Type.STRING },
                    borderWidth: { type: Type.NUMBER },
                    borderStyle: { type: Type.STRING }
                }
            }
        }
    ];

    return ai.chats.create({
        model: "gemini-3-pro-preview",
        config: {
            systemInstruction: "You are an expert Co-Editor. Use the tools provided to modify the exam paper. ALWAYS use LaTeX $...$ for math content. If the user asks for layout changes, use updatePaperStyles. For content, use question tools.",
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
        contents: `Analyze exam text into JSON. Use LaTeX $...$ for math. Text: ${text}`,
        config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text) as AnalysisResult;
};

export const analyzeHandwrittenImages = async (imageParts: Part[]): Promise<AnalysisResult> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts: [...imageParts, { text: "OCR this handwritten exam and return structured JSON. Use LaTeX $...$ for math." }] },
        config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text) as AnalysisResult;
};

export const editImage = async (prompt: string, imageBase64: string, mimeType: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({ 
        model: 'gemini-2.5-flash-image', 
        contents: { parts: [ { inlineData: { data: imageBase64.split(',')[1], mimeType } }, { text: prompt } ] } 
    });
    for (const part of response.candidates[0].content.parts) { if (part.inlineData) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`; }
    throw new Error("Internal Error Occurred");
};

export const translatePaperService = async (paperData: QuestionPaperData, targetLanguage: string): Promise<QuestionPaperData> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({ 
        model: "gemini-3-pro-preview", 
        contents: `Translate paper to ${targetLanguage}. Maintain all LaTeX $...$. Return JSON.`, 
        config: { responseMimeType: "application/json" } 
    });
    const translated = { ...paperData, ...JSON.parse(response.text) };
    return { ...translated, htmlContent: generateHtmlFromPaperData(translated) };
};

export const translateQuestionService = async (question: Question, targetLanguage: string): Promise<Question> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({ 
        model: "gemini-3-flash-preview", 
        contents: `Translate to ${targetLanguage}. Preserve LaTeX. Return JSON.`, 
        config: { responseMimeType: "application/json" } 
    });
    return { ...question, ...JSON.parse(response.text) };
};

export const generateImage = async (prompt: string, aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({ 
        model: 'gemini-2.5-flash-image', 
        contents: prompt,
        config: { imageConfig: { aspectRatio } }
    });
    for (const part of response.candidates[0].content.parts) { if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`; }
    throw new Error("Internal Error Occurred");
};
