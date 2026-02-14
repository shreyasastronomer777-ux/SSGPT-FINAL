import { GoogleGenAI, Type, FunctionDeclaration, Modality, Chat, Part, GenerateContentResponse } from "@google/genai";
import { type FormData, type QuestionPaperData, QuestionType, Question, Difficulty, Taxonomy, AnalysisResult } from '../types';
import { generateHtmlFromPaperData } from "./htmlGenerator";
export { generateHtmlFromPaperData };

const handleApiError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    const message = error?.message || "";
    
    if (message.includes("Safety")) {
        throw new Error("Content flagged by safety filters. This usually happens when topics are sensitive or inappropriate for academic content. Please adjust your prompt.");
    }
    if (message.includes("API key not found") || message.includes("API_KEY")) {
        throw new Error("API Key issue detected. Please check your service configuration.");
    }
    if (message.includes("Quota") || message.includes("429")) {
        throw new Error("API Rate limit exceeded. Please wait a moment before trying again.");
    }
    
    throw new Error(`AI Generation Failed during ${context}: ${message || 'Unknown Error'}`);
};

const parseAiJson = (text: string | undefined) => {
    if (!text) {
        throw new Error("The AI model returned an empty response. This may be due to safety filters or a connection timeout.");
    }

    try {
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/);
        const cleanedText = jsonMatch ? jsonMatch[1] : text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        // Final sanity check for common LaTeX JSON escape errors
        const sanitized = cleanedText
            .replace(/\\times/g, '\\\\times')
            .replace(/\\frac/g, '\\\\frac')
            .replace(/\\sqrt/g, '\\\\sqrt')
            .replace(/\\pm/g, '\\\\pm')
            .replace(/\\div/g, '\\\\div');

        return JSON.parse(sanitized);
    } catch (e) {
        console.error("JSON Parse Error. Raw text:", text);
        try {
            const simpleClean = text.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(simpleClean);
        } catch (innerE) {
            throw new Error("Failed to parse the AI's response into a valid format. Please try refining your request.");
        }
    }
};

export const extractConfigFromTranscript = async (transcript: string): Promise<any> => {
    if (!process.env.API_KEY) throw new Error("API Configuration Missing.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Extract academic configuration from the following transcript: "${transcript}". 
    Return JSON with fields: {schoolName, className, subject, topics, difficulty, timeAllowed, questionDistribution: [{type, count, marks, taxonomy, difficulty}]}. 
    Use LaTeX for all math symbols with double backslashes in the strings.`;
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        return parseAiJson(response.text);
    } catch (error) {
        handleApiError(error, "extraction from transcript");
    }
};

export const generateQuestionPaper = async (formData: FormData): Promise<QuestionPaperData> => {
    if (!process.env.API_KEY) throw new Error("API Configuration Missing.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const { schoolName, className, subject, topics, questionDistribution, totalMarks, language, timeAllowed, sourceFiles, modelQuality } = formData;
    
    const modelToUse = modelQuality === 'pro' ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';

    const finalPrompt = `
You are an expert Academic Examiner. Create a professional assessment in **${language}**.

**MANDATORY INSTRUCTIONS:**
1. **STRUCTURE:** You MUST generate the EXACT quantity of questions for EVERY type specified in the Structure. 
2. **MATHEMATICS (LATEX):** Use professional LaTeX for ALL mathematical symbols, fractions, powers, and roots. Wrap math in $...$. 
   CRITICAL FOR JSON: In the JSON string, always use DOUBLE backslashes for commands. 
   Example: "$\\frac{a}{b}$" must be written as "$\\\\frac{a}{b}$". NEVER use single backslashes like "\\times" as they break JSON parsing.
3. **FORMAT:** 
   - Match the Following: Options MUST be a JSON object {columnA: [], columnB: []}.
   - Fill in Blanks: Use "_______" for blanks.
   - Theoretical: Options must be NULL.

**EXAM SPECIFICATIONS:**
- Subject: ${subject}
- Class: ${className}
- Topics: ${topics}
- Total Marks: ${totalMarks}
- Time Allowed: ${timeAllowed}
- QUESTION STRUCTURE: ${JSON.stringify(questionDistribution)}

Return ONLY a valid JSON array containing question objects.
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
                            options: { description: "Array of options for MCQ, or {columnA:[], columnB:[]} for Match the Following." },
                            answer: { description: "The correct answer or marking scheme." },
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
            id: `paper-${Date.now()}`, 
            schoolName, 
            className, 
            subject, 
            totalMarks: String(totalMarks),
            timeAllowed, 
            questions: processedQuestions, 
            htmlContent: '', 
            createdAt: new Date().toISOString(),
        };
        
        structuredPaperData.htmlContent = generateHtmlFromPaperData(structuredPaperData);
        return structuredPaperData;
    } catch (error) {
        handleApiError(error, "paper generation");
        throw error;
    }
};

export const createEditingChat = (paperData: QuestionPaperData) => {
    if (!process.env.API_KEY) throw new Error("API Configuration Missing.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    return ai.chats.create({
        model: "gemini-3-pro-preview",
        config: {
            systemInstruction: `You are an Academic Editor. Use professional LaTeX formatting ($...$) with double backslashes in all JSON or text responses.`
        }
    });
};

export const getAiEditResponse = async (chat: Chat, instruction: string) => {
    try {
        const response = await chat.sendMessage({ message: instruction });
        return { functionCalls: response.functionCalls || null, text: response.text || null };
    } catch (error) {
        handleApiError(error, "editor chat");
        throw error;
    }
};

export const generateChatResponseStream = async (chat: Chat, messageParts: Part[], useSearch?: boolean, useThinking?: boolean): Promise<AsyncGenerator<GenerateContentResponse>> => {
    try {
        return chat.sendMessageStream({ message: messageParts });
    } catch (error) {
        handleApiError(error, "chatbot stream");
        throw error;
    }
};

export const generateTextToSpeech = async (text: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API Configuration Missing.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
            },
        });
        return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
    } catch (error) {
        handleApiError(error, "text-to-speech");
        throw error;
    }
};

export const analyzePastedText = async (text: string): Promise<AnalysisResult> => {
    if (!process.env.API_KEY) throw new Error("API Configuration Missing.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Analyze the following exam text into structured academic JSON. Use LaTeX with double backslashes. Text: ${text}`,
            config: { responseMimeType: "application/json" }
        });
        return parseAiJson(response.text) as AnalysisResult;
    } catch (error) {
        handleApiError(error, "text analysis");
        throw error;
    }
};

export const analyzeHandwrittenImages = async (imageParts: Part[]): Promise<AnalysisResult> => {
    if (!process.env.API_KEY) throw new Error("API Configuration Missing.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: { parts: [...imageParts, { text: "Perform OCR on these handwritten questions and format them into structured academic JSON. Use LaTeX with double backslashes." }] },
            config: { responseMimeType: "application/json" }
        });
        return parseAiJson(response.text) as AnalysisResult;
    } catch (error) {
        handleApiError(error, "image analysis");
        throw error;
    }
};

export const generateImage = async (prompt: string, aspectRatio: string = "1:1"): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API Configuration Missing.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: [{ parts: [{ text: prompt }] }],
            config: { imageConfig: { aspectRatio: aspectRatio as any } },
        });

        if (response.candidates?.[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
        throw new Error("No image was returned from the model.");
    } catch (error) {
        handleApiError(error, "image generation");
        throw error;
    }
};