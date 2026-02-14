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
        // Find JSON block if AI provided surrounding text
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/);
        let cleanedText = jsonMatch ? jsonMatch[1] : text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        // CRITICAL FIX: The AI often outputs single backslashes in JSON strings for LaTeX commands
        // which makes JSON.parse fail or interpret them as tabs/newlines.
        // We look for common LaTeX commands that often break: \times, \frac, \sqrt, \pm, \div
        // Note: We only replace if they are NOT already escaped.
        const sanitized = cleanedText
            .replace(/(?<!\\)\\times/g, '\\\\times')
            .replace(/(?<!\\)\\frac/g, '\\\\frac')
            .replace(/(?<!\\)\\sqrt/g, '\\\\sqrt')
            .replace(/(?<!\\)\\pm/g, '\\\\pm')
            .replace(/(?<!\\)\\div/g, '\\\\div');

        return JSON.parse(sanitized);
    } catch (e) {
        console.error("JSON Parse Error. Raw text:", text);
        try {
            const simpleClean = text.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(simpleClean);
        } catch (innerE) {
            throw new Error("Invalid response format from AI. The generated math formatting was too complex for the parser.");
        }
    }
};

export const extractConfigFromTranscript = async (transcript: string): Promise<any> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Extract academic configuration from: "${transcript}". 
    Return JSON: {schoolName, className, subject, topics, difficulty, timeAllowed, questionDistribution: [{type, count, marks, taxonomy, difficulty}]}. 
    Use LaTeX for math symbols with double backslashes.`;
    try {
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
    
    const modelToUse = modelQuality === 'pro' ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';

    const finalPrompt = `
You are a Senior Academic Examiner. Create a professional assessment in **${language}**.

**CORE MANDATORY INSTRUCTIONS:**
1. **DIVERSITY:** You MUST generate the EXACT quantity of questions for EVERY type specified in the Structure. Do NOT default to MCQs.
2. **LATEX (CRITICAL):** Use professional LaTeX for ALL mathematical symbols, fractions, powers, and roots. Wrap math in $...$. 
   CRITICAL FOR JSON: In the JSON string, always use DOUBLE backslashes for commands. 
   Example: "$\\frac{a}{b}$" must be written as "$\\\\frac{a}{b}$" in the JSON raw string. NEVER use single backslashes like "\\times" as they break JSON parsing by appearing as tab characters.
3. **TYPE RULES:** 
   - Match the Following: Options MUST be a JSON object {columnA: [], columnB: []}.
   - Fill in Blanks: Use "_______" (exactly 7 underscores) for blanks.
   - Theoretical: Options must be NULL.

**SPECIFICATIONS:**
- Subject: ${subject}
- Class: ${className}
- Topics: ${topics}
- Marks: ${totalMarks}
- Time: ${timeAllowed}
- STRUCTURE: ${JSON.stringify(questionDistribution)}

Return ONLY valid JSON array of question objects.
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
            systemInstruction: `Academic Editor. Use professional LaTeX formatting ($...$) with double backslashes in JSON responses to avoid parsing errors.`
        }
    });
};

export const getAiEditResponse = async (chat: Chat, instruction: string) => {
    const response = await chat.sendMessage({ message: instruction });
    return { functionCalls: response.functionCalls || null, text: response.text || null };
};

export const generateChatResponseStream = async (chat: Chat, messageParts: Part[], useSearch?: boolean, useThinking?: boolean): Promise<AsyncGenerator<GenerateContentResponse>> => {
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
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Analyze text into structured academic JSON. Use LaTeX with double backslashes. Text: ${text}`,
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
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: { parts: [...imageParts, { text: "OCR handwritten questions into structured academic JSON. Use LaTeX with double backslashes." }] },
            config: { responseMimeType: "application/json" }
        });
        return parseAiJson(response.text) as AnalysisResult;
    } catch (error) {
        handleApiError(error, "analyzeHandwrittenImages");
        throw error;
    }
};

export const generateImage = async (prompt: string, aspectRatio: string = "1:1"): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
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
        throw new Error("No image was returned.");
    } catch (error) {
        handleApiError(error, "generateImage");
        throw error;
    }
};