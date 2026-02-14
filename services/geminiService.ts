import { GoogleGenAI, Type, Chat, Part, GenerateContentResponse } from "@google/genai";
import { type FormData, type QuestionPaperData, QuestionType, Question, AnalysisResult } from '../types';
import { generateHtmlFromPaperData } from "./htmlGenerator";
export { generateHtmlFromPaperData };

/**
 * BACKEND VALIDATION LAYER:
 * Sanitizes AI output before parsing to ensure LaTeX syntax is preserved
 * through the JSON string boundary.
 */
const validateAndFixLatex = (jsonStr: string): string => {
    return jsonStr
        .replace(/\\(?!\\|n|r|t|b|f|u|")/g, '\\\\') // Escape single backslashes not used in standard JSON escapes
        .replace(/\\times/g, '\\\\times')
        .replace(/\\frac/g, '\\\\frac')
        .replace(/\\sqrt/g, '\\\\sqrt')
        .replace(/\\pm/g, '\\\\pm')
        .replace(/\\div/g, '\\\\div')
        .replace(/\\le/g, '\\\\le')
        .replace(/\\ge/g, '\\\\ge')
        .replace(/\^/g, '\\\\char`\\\\^'); // Protect raw carets
};

const handleApiError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    const msg = error?.message || "";
    if (msg.includes("Safety")) throw new Error("Content flagged by safety. Please refine your academic topics.");
    if (msg.includes("Quota") || msg.includes("429")) throw new Error("API Rate limit exceeded. Please wait a moment.");
    throw new Error(`AI Generation Failed (${context}). Check connection.`);
};

const parseAiJson = (text: string | undefined) => {
    if (!text) throw new Error("Empty response from AI.");
    try {
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/);
        const rawContent = jsonMatch ? jsonMatch[1] : text.replace(/```json/g, '').replace(/```/g, '').trim();
        const sanitized = validateAndFixLatex(rawContent);
        return JSON.parse(sanitized);
    } catch (e) {
        console.error("Parse error. Sanity check failed:", text);
        throw new Error("Format Mismatch: AI returned invalid JSON structure.");
    }
};

/**
 * MASTER LLM GENERATION PROMPT (Production Grade)
 * Enforces strict Markdown logic and LaTeX integrity.
 */
const getMasterPrompt = (formData: FormData) => `
You are SSGPT-AI, a Senior Academic Examiner and Prompt Architect. 
Your task is to generate a professional exam paper in **${formData.language}**.

=========================================
CORE INTEGRITY RULES (STRICT)
=========================================
1. NO PLAIN TEXT MATH: Never use "/", "^", or "*" for math. 
   - BAD: 3/4, x^2, 5 * 10
   - GOOD: $\\frac{3}{4}$, $x^2$, $5 \\times 10$
2. LATEX DELIMITERS: 
   - Use $...$ for all inline math symbols and expressions.
   - Use $$...$$ for complex display equations or tall math (fractions, roots).
3. JSON ESCAPING: Since you are returning JSON, all LaTeX backslashes MUST be doubled (\\\\).
   - Example: "$\\frac{a}{b}$" must be "$\\\\frac{a}{b}$" in the JSON string.
4. SPACING: Ensure a clean separation between text and math symbols.

=========================================
STRUCTURE SPECIFICATIONS
=========================================
- Subject: ${formData.subject}
- Grade: ${formData.className}
- Topics: ${formData.topics}
- Paper Structure: ${JSON.stringify(formData.questionDistribution)}

=========================================
QUESTION TYPE GUARDS
=========================================
- Fill in Blanks: Use EXACTLY 7 underscores "_______".
- Match The Following: Return options as { "columnA": ["Item1", "Item2"], "columnB": ["Match1", "Match2"] }.
- Theoretical: Set options to null.

OUTPUT ONLY VALID JSON ARRAY. NO COMMENTARY.
`;

export const generateQuestionPaper = async (formData: FormData): Promise<QuestionPaperData> => {
    if (!process.env.API_KEY) throw new Error("API Configuration Missing.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Fix: Updated models to use Gemini 3 series for generation based on guidelines.
    const modelToUse = formData.modelQuality === 'pro' ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';

    try {
        const response = await ai.models.generateContent({
            model: modelToUse,
            contents: { parts: [{ text: getMasterPrompt(formData) }] },
            config: { 
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            type: { type: Type.STRING },
                            questionText: { type: Type.STRING },
                            options: { description: "MCQ array or Matching object." },
                            answer: { type: Type.STRING },
                            marks: { type: Type.NUMBER },
                            difficulty: { type: Type.STRING },
                            taxonomy: { type: Type.STRING }
                        },
                        required: ["type", "questionText", "marks", "answer"]
                    }
                }
            }
        });

        const rawQuestions = parseAiJson(response.text);
        const processed: Question[] = rawQuestions.map((q: any, i: number) => ({
            ...q,
            questionNumber: i + 1,
            options: q.options || null
        }));

        const paperData: QuestionPaperData = {
            id: `paper-${Date.now()}`,
            schoolName: formData.schoolName,
            className: formData.className,
            subject: formData.subject,
            totalMarks: String(formData.totalMarks),
            timeAllowed: formData.timeAllowed,
            questions: processed,
            htmlContent: '',
            createdAt: new Date().toISOString()
        };
        
        paperData.htmlContent = generateHtmlFromPaperData(paperData);
        return paperData;
    } catch (error) {
        handleApiError(error, "Generation");
        throw error;
    }
};

export const createEditingChat = (paperData: QuestionPaperData) => {
    if (!process.env.API_KEY) throw new Error("API Key Missing.");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    // Fix: Updated to Gemini 3 Pro for complex academic editing tasks.
    return ai.chats.create({
        model: "gemini-3-pro-preview",
        config: {
            systemInstruction: "Academic Editor. Enforce $...$ delimiters and double backslashes (\\\\) for all math commands."
        }
    });
};

export const getAiEditResponse = async (chat: Chat, instruction: string) => {
    const response = await chat.sendMessage({ message: instruction });
    return { functionCalls: response.functionCalls || null, text: response.text || null };
};

// Fix: Updated signature to accept 4 arguments as called by UI components to resolve compilation errors.
export const generateChatResponseStream = async (chat: Chat, messageParts: Part[], useSearch?: boolean, useThinking?: boolean) => {
    // sendMessageStream only accepts the 'message' parameter.
    // Configuration for search grounding or thinking budget must be set during initial chat creation.
    return chat.sendMessageStream({ message: messageParts });
};

export const analyzePastedText = async (text: string): Promise<AnalysisResult> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    // Fix: Updated to Gemini 3 Flash for efficient text analysis.
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze exam text into JSON. Enforce $...$ delimiters. Text: ${text}`,
        config: { responseMimeType: "application/json" }
    });
    return parseAiJson(response.text) as AnalysisResult;
};

export const analyzeHandwrittenImages = async (imageParts: Part[]): Promise<AnalysisResult> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    // Fix: Updated to Gemini 3 Flash for efficient image analysis.
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts: [...imageParts, { text: "OCR text to academic JSON. Enforce $...$ math delimiters." }] },
        config: { responseMimeType: "application/json" }
    });
    return parseAiJson(response.text) as AnalysisResult;
};

export const generateTextToSpeech = async (text: string) => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: { responseModalities: [Modality.AUDIO] }
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
};

export const generateImage = async (prompt: string, aspectRatio: string = "1:1") => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [{ parts: [{ text: prompt }] }],
        config: { imageConfig: { aspectRatio: aspectRatio as any } },
    });
    for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    throw new Error("No image generated.");
};

export const extractConfigFromTranscript = async (transcript: string) => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    // Fix: Updated model to Gemini 3 Flash.
    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Extract exam config JSON from: ${transcript}. Enforce LaTeX standards.`,
        config: { responseMimeType: "application/json" }
    });
    return parseAiJson(response.text);
};