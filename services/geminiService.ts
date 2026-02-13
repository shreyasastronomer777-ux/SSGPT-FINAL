import { GoogleGenAI, Type, FunctionDeclaration, Modality, Chat, Part, GenerateContentResponse } from "@google/genai";
import { type FormData, type QuestionPaperData, QuestionType, Question, Difficulty, Taxonomy, AnalysisResult } from '../types';
import { generateHtmlFromPaperData } from "./htmlGenerator";
export { generateHtmlFromPaperData };

const handleApiError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    if (error?.message?.includes("Safety")) {
        throw new Error("Content flagged by safety filters. Adjust topics for academic standards.");
    }
    throw new Error(`AI Generation Failed (${context}). Check API stability.`);
};

const parseAiJson = (text: string) => {
    try {
        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanedText);
    } catch (e) {
        console.error("JSON Parse Error. Raw text:", text);
        throw new Error("Invalid response format from AI.");
    }
};

export const extractConfigFromTranscript = async (transcript: string): Promise<any> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Extract academic configuration from: "${transcript}". 
    Return JSON: {schoolName, className, subject, topics, difficulty, timeAllowed, questionDistribution: [{type, count, marks, taxonomy, difficulty}]}. 
    Use LaTeX for math symbols.`;
    try {
        // Fix: Use 'gemini-3-flash-preview' for basic text extraction tasks.
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        return parseAiJson(response.text);
    } catch (error) {
        handleApiError(error, "extractConfigFromTranscript");
    }
};

export const generateQuestionPaper = async (formData: FormData): Promise<QuestionPaperData> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const { schoolName, className, subject, topics, questionDistribution, totalMarks, language, timeAllowed, sourceMaterials, sourceFiles, modelQuality } = formData;
    
    // Fix: Updated model names based on guidelines.
    const modelToUse = modelQuality === 'pro' ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';

    const finalPrompt = `
You are a Senior Academic Examiner. Generate a board-standard exam paper in **${language}**.

**CORE FORMATTING RULES:**
1. **LATEX:** Use professional LaTeX for ALL math symbols, fractions, and formulas ($x$, $\\frac{a}{b}$). Use DOUBLE BACKSLASHES (\\\\) for commands.
2. **MULTIPLE CHOICE:** MUST provide EXACTLY 4 options in the 'options' array.
3. **MATCH THE FOLLOWING:** 
   - 'options' must be a JSON object: {"columnA": ["Item 1", "Item 2"...], "columnB": ["Shuffled Item 2 Match", "Shuffled Item 1 Match"...]}.
   - 'answer' must be a key-value mapping of correct matches.
4. **NO PREFIXES:** Do not include "Question 1", "Ans:", or "(a)" inside text strings.
5. **SPACING:** Keep text concise to fit content efficiently.

**PAPER PARAMETERS:**
Subject: ${subject} | Class: ${className} | Topics: ${topics} | Marks: ${totalMarks}
Structure: ${JSON.stringify(questionDistribution)}
${sourceMaterials ? `Context: ${sourceMaterials}` : ''}

Return only valid JSON.
`;

    try {
        const parts: Part[] = [{ text: finalPrompt }];
        if (sourceFiles) {
            for (const file of sourceFiles) {
                parts.push({ inlineData: { data: file.data, mimeType: file.mimeType } });
            }
        }

        const response = await ai.models.generateContent({
            model: modelToUse,
            contents: { parts },
            config: { 
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            type: { type: Type.STRING },
                            questionText: { type: Type.STRING },
                            options: { description: "Array for MCQ, or {columnA:[], columnB:[]} for Match." },
                            answer: { description: "Correct answer string or mapping object." },
                            marks: { type: Type.NUMBER },
                            difficulty: { type: Type.STRING },
                            taxonomy: { type: Type.STRING }
                        },
                        required: ["type", "questionText", "marks", "answer"]
                    }
                }
            }
        });

        const generatedQuestionsRaw = parseAiJson(response.text);
        const processedQuestions: Question[] = generatedQuestionsRaw.map((q: any, index: number) => ({
            ...q,
            options: q.options || null,
            answer: q.answer || '',
            questionNumber: index + 1
        }));

        const structuredPaperData: QuestionPaperData = {
            id: `paper-${Date.now()}`, schoolName, className, subject, totalMarks: String(totalMarks),
            timeAllowed, questions: processedQuestions, htmlContent: '', createdAt: new Date().toISOString(),
        };
        
        structuredPaperData.htmlContent = generateHtmlFromPaperData(structuredPaperData);
        return structuredPaperData;
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
            systemInstruction: `Academic Editor. STRICT LaTeX ($...$). No redundant numbering. Preserve language: ${paperData.subject}.`
        }
    });
};

export const getAiEditResponse = async (chat: Chat, instruction: string) => {
    // Fix: chat.sendMessage only accepts the message parameter.
    const response = await chat.sendMessage({ message: instruction });
    return { functionCalls: response.functionCalls || null, text: response.text || null };
};

export const generateChatResponseStream = async (chat: Chat, messageParts: Part[], useSearch?: boolean, useThinking?: boolean): Promise<AsyncGenerator<GenerateContentResponse>> => {
    // Fix: chat.sendMessageStream only accepts the message parameter. Per-turn config (search/thinking) should be avoided or configured in chats.create.
    return chat.sendMessageStream({ message: messageParts });
};

export const generateTextToSpeech = async (text: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
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
    try {
        // Fix: Use 'gemini-3-flash-preview' for text analysis.
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Analyze into exam JSON. LaTeX math only. Text: ${text}`,
            config: { responseMimeType: "application/json" }
        });
        return parseAiJson(response.text) as AnalysisResult;
    } catch (error) {
        handleApiError(error, "analyzePastedText");
        throw error;
    }
};

export const analyzeHandwrittenImages = async (imageParts: Part[]): Promise<AnalysisResult> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        // Fix: Use 'gemini-3-flash-preview' for complex image OCR and reasoning tasks.
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: { parts: [...imageParts, { text: "OCR to exam JSON. LaTeX math formulas." }] },
            config: { responseMimeType: "application/json" }
        });
        return parseAiJson(response.text) as AnalysisResult;
    } catch (error) {
        handleApiError(error, "analyzeHandwrittenImages");
        throw error;
    }
};

// Fix: Added missing generateImage export to resolve error in ImageGenerationModal.tsx.
// Adheres to guidelines: uses 'gemini-2.5-flash-image' and iterates through candidates/parts to find inlineData.
export const generateImage = async (prompt: string, aspectRatio: string = "1:1"): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [
                    {
                        text: prompt,
                    },
                ],
            },
            config: {
                imageConfig: {
                    aspectRatio: aspectRatio as any,
                },
            },
        });

        // Find the image part, do not assume it is the first part.
        if (response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    const base64EncodeString: string = part.inlineData.data;
                    return `data:image/png;base64,${base64EncodeString}`;
                }
            }
        }
        throw new Error("No image was returned by the AI model.");
    } catch (error) {
        handleApiError(error, "generateImage");
        throw error;
    }
};