import { GoogleGenAI, Type, FunctionDeclaration, Modality, Chat, Part, GenerateContentResponse } from "@google/genai";
import { type FormData, type QuestionPaperData, QuestionType, Question, Difficulty, Taxonomy, AnalysisResult } from '../types';
import { generateHtmlFromPaperData } from "./htmlGenerator";
export { generateHtmlFromPaperData };

const handleApiError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    if (error?.message?.includes("Safety")) {
        throw new Error("The content was flagged by safety filters. Please try rephrasing your topics or materials.");
    }
    throw new Error(`AI Generation Failed (${context}). Please try again with more specific topics.`);
};

/**
 * Robustly cleans and parses JSON from AI responses.
 */
const parseAiJson = (text: string) => {
    try {
        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanedText);
    } catch (e) {
        console.error("JSON Parse Error. Raw text:", text);
        throw new Error("The AI returned an invalid response format. Please try again.");
    }
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
        return parseAiJson(response.text);
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
You are a Board-Level Senior Examiner. Your objective is to generate a professional, high-standard academic examination paper in JSON format.

**CORE REQUIREMENT - LANGUAGE:**
- Generate the ENTIRE exam (questions, options, matches, instructions) strictly in: **${language}**.
- Use formal academic tone and precise subject-specific terminology appropriate for grade ${className}.

**FORMATTING RULES (CRITICAL):**
1. **LATEX FOR ALL MATH:** Use LaTeX for ALL math formulas, symbols (multiplication $\\times$, division $\\div$, plus/minus $\\pm$, etc.), variables ($x$, $y$), fractions ($\\frac{a}{b}$), and units.
2. **JSON ESCAPING:** In the JSON output, you MUST use DOUBLE BACKSLASHES (e.g. \\\\times, \\\\frac{a}{b}) for all LaTeX commands inside the string values.
3. **NO REDUNDANT NUMBERING:** DO NOT include any numbering prefixes like "1.", "Q1", "a)", "(i)", "Column A:" inside the strings. The application handles layout and numbering automatically.

**QUESTION STRUCTURES:**
- **Multiple Choice:** Provide exactly 4 options as a plain array of strings.
- **Match the Following:** Provide an object: {"columnA": ["Item 1", "Item 2"...], "columnB": ["Correct Match 2", "Correct Match 1"...]}. Column B MUST be shuffled.
- **Answer Field:** The "answer" field must contain the correct choice for MCQs or the complete solution/explanation for other types.

**EXAM PARAMETERS:**
Subject: ${subject} | Grade: ${className} | Topics: ${topics} | Total Marks: ${totalMarks} | Time: ${timeAllowed}
Mix: ${JSON.stringify(questionDistribution)}
${sourceMaterials ? `Context/Source Material: ${sourceMaterials}` : ''}

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
                            type: { type: Type.STRING, description: "Question type string" },
                            questionText: { type: Type.STRING, description: "The core question content" },
                            options: { type: Type.NULL, description: "Dynamic: string array for MCQ, or {columnA, columnB} for Match" },
                            answer: { type: Type.STRING, description: "Model solution or answer key" },
                            marks: { type: Type.NUMBER },
                            difficulty: { type: Type.STRING },
                            taxonomy: { type: Type.STRING }
                        },
                        required: ["type", "questionText", "marks"]
                    }
                }
            }
        });

        const generatedQuestionsRaw = parseAiJson(response.text);
        
        if (!Array.isArray(generatedQuestionsRaw) || generatedQuestionsRaw.length === 0) {
            throw new Error("AI failed to produce content for the paper. Please try again.");
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
            systemInstruction: `You are an expert academic editor.
            STRICT MATH: Use LaTeX with double backslashes ($...$). 
            LANGUAGE: Strictly maintain the requested language of the paper.
            FORMATTING: Do not add redundant numbering to question text strings.`
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
        contents: `Analyze this academic content into JSON for an exam paper. Math MUST be LaTeX with DOUBLE backslashes ($...$). Text: ${text}`,
        config: { responseMimeType: "application/json" }
    });
    return parseAiJson(response.text) as AnalysisResult;
};

export const analyzeHandwrittenImages = async (imageParts: Part[]): Promise<AnalysisResult> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts: [...imageParts, { text: "Analyze handwritten questions to JSON for an exam paper. Math MUST be LaTeX with double backslashes ($...$)." }] },
        config: { responseMimeType: "application/json" }
    });
    return parseAiJson(response.text) as AnalysisResult;
};
