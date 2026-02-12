import { GoogleGenAI, Type, FunctionDeclaration, Modality, Chat, Part, GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { type FormData, type QuestionPaperData, QuestionType, Question, Difficulty, Taxonomy, AnalysisResult, QuestionDistributionItem } from '../types';
import { generateHtmlFromPaperData } from "./htmlGenerator";

const handleApiError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    throw new Error("Internal Error Occurred");
};

export const extractConfigFromTranscript = async (transcript: string): Promise<any> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const prompt = `
You are a configuration extraction engine for SSGPT, an AI exam paper generator.
Your job is to extract structured academic configuration from a user's spoken instruction.

**Transcript:** "${transcript}"

Return ONLY a JSON object.
Format:
{
  "schoolName": "",
  "className": "",
  "subject": "",
  "topics": "",
  "difficulty": "Easy" | "Medium" | "Hard",
  "timeAllowed": "",
  "questionDistribution": [
    {
      "type": "Multiple Choice" | "Short Answer" | "Long Answer" | "Fill in the Blanks" | "Match the Following" | "True / False",
      "count": number,
      "marks": number,
      "taxonomy": "Remembering" | "Understanding" | "Applying" | "Analyzing" | "Evaluating" | "Creating"
    }
  ]
}
`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        return JSON.parse(response.text);
    } catch (error) {
        handleApiError(error, "extractConfigFromTranscript");
    }
};

export const generateQuestionPaper = async (formData: FormData): Promise<QuestionPaperData> => {
  if (!process.env.API_KEY) {
    throw new Error("Internal Error Occurred");
  }
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const { schoolName, className, subject, topics, questionDistribution, totalMarks, language, timeAllowed, sourceMaterials, sourceMode, sourceFiles } = formData;

  const questionRequests = questionDistribution
    .map(d => `- ${d.count} ${d.type} questions, each worth ${d.marks} marks. Difficulty: '${d.difficulty}', Taxonomy: '${d.taxonomy}'.`)
    .join('\n');
    
  const sourceMaterialInstruction = sourceMaterials || (sourceFiles && sourceFiles.length > 0)
    ? `
- **Source Materials to Use:**
${sourceMaterials}
${sourceMode === 'strict' ? "Generate questions ONLY from provided materials." : "Prioritize materials, supplement if needed."}`
    : '';

  const finalPrompt = `
You are a professional typesetter and Question Paper Designer for the Indian K-12 system.
Generate a high-quality exam paper in JSON format.

**STRICT LATEX FORMATTING RULES:**
1. **FRACTIONS:** NEVER use plain text fractions like "3/5", "1/2", "x/y". You MUST use $\\frac{a}{b}$ syntax for every single fraction in the question text and every single option.
2. **DELIMITERS:** Wrap ALL math, numbers, variables, and expressions in single dollar signs: $...$.
3. **SYMBOLS:** Use proper LaTeX: $\\times$ (multiplication), $\\div$ (division), $\\sqrt{x}$ (square root), $\\pi$, $\\approx$, etc.
4. **OPTIONS:** If an option is a number or fraction, it MUST be wrapped in $...$. E.g., "(a) $\\frac{3}{10}$".
5. **EXPONENTS:** Use $x^2$ instead of x2 or x^2.

**Example Format:**
Question: "Calculate the sum of $\\frac{1}{2}$ and $\\frac{1}{4}$."
Options: ["$\\frac{3}{4}$", "$\\frac{1}{2}$", "$\\frac{3}{8}$", "$\\frac{1}{4}$"]

**Paper Specifications:**
- Subject: ${subject}, Class: ${className}, Topics: ${topics}
- Language: ${language}
${sourceMaterialInstruction}

- Required Mix:
${questionRequests}

Return ONLY a JSON array of objects with fields: type, questionText, options, answer, marks, difficulty, taxonomy.
`;

    const questionSchema = {
        type: Type.OBJECT,
        properties: {
            type: { type: Type.STRING, enum: Object.values(QuestionType) },
            questionText: { type: Type.STRING },
            options: { type: Type.STRING },
            answer: { type: Type.STRING },
            marks: { type: Type.NUMBER },
            difficulty: { type: Type.STRING, enum: Object.values(Difficulty) },
            taxonomy: { type: Type.STRING, enum: Object.values(Taxonomy) },
        },
        required: ['type', 'questionText', 'options', 'answer', 'marks', 'difficulty', 'taxonomy']
    };

    try {
        const parts: Part[] = [{ text: finalPrompt }];
        if (sourceFiles) {
            for (const file of sourceFiles) {
                parts.push({ inlineData: { data: file.data, mimeType: file.mimeType } });
            }
        }

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ parts }],
            config: { 
                responseMimeType: "application/json",
                responseSchema: { type: Type.ARRAY, items: questionSchema }
            }
        });

        const generatedQuestionsRaw = JSON.parse(response.text) as any[];
        if (!Array.isArray(generatedQuestionsRaw)) throw new Error("Internal Error Occurred");
        
        const processedQuestions: Question[] = generatedQuestionsRaw.map((q, index) => {
            let parsedOptions: any = null;
            if (q.options && typeof q.options === 'string' && (q.options.startsWith('[') || q.options.startsWith('{'))) {
                try { parsedOptions = JSON.parse(q.options); } catch (e) { parsedOptions = null; }
            } else {
                parsedOptions = q.options || null;
            }
            let parsedAnswer: any = q.answer;
            if (q.type === QuestionType.MatchTheFollowing && typeof q.answer === 'string' && q.answer.startsWith('{')) {
                 try { parsedAnswer = JSON.parse(q.answer); } catch (e) {}
            }
            return { ...q, options: parsedOptions, answer: parsedAnswer, questionNumber: index + 1 };
        });

        const paperId = `paper-${Date.now()}`;
        const structuredPaperData: QuestionPaperData = {
            id: paperId,
            schoolName,
            className,
            subject,
            totalMarks: String(totalMarks),
            timeAllowed,
            questions: processedQuestions,
            htmlContent: '',
            createdAt: new Date().toISOString(),
        };
        
        return { ...structuredPaperData, htmlContent: generateHtmlFromPaperData(structuredPaperData) };

    } catch (error) {
        handleApiError(error, "generateQuestionPaper");
        throw error;
    }
};

export const analyzePastedText = async (text: string): Promise<AnalysisResult> => {
  if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const analysisPrompt = `Analyze and structure the following exam text into JSON. CRITICAL: Rewrite all plain text fractions (e.g. 1/2) into LaTeX $\\frac{1}{2}$ format. Text: ${text}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ parts: [{ text: analysisPrompt }] }],
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text) as AnalysisResult;
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
        model: "gemini-2.5-flash",
        contents: [{ parts: [...imageParts, { text: "Perform OCR and structure this content into JSON. CRITICAL: Convert all math and fractions into LaTeX $...$ using \\frac{num}{den}." }] }],
        config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text) as AnalysisResult;
  } catch (error) {
    handleApiError(error, "analyzeHandwrittenImages");
    throw error;
  }
};

export const generateChatResponseStream = async (chat: Chat, messageParts: Part[], useSearch?: boolean, useThinking?: boolean): Promise<AsyncGenerator<GenerateContentResponse>> => {
    try {
        const config: any = {};
        if (useSearch) config.tools = [{ googleSearch: {} }];
        if (useThinking) config.thinkingConfig = { thinkingBudget: 4096 };

        return chat.sendMessageStream({
            message: messageParts,
            config: Object.keys(config).length > 0 ? config : undefined,
        });
    } catch (error) {
        handleApiError(error, "generateChatResponseStream");
        throw error;
    }
};

export const generateTextToSpeech = async (text: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
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
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) throw new Error("Internal Error Occurred");
        return base64Audio;
    } catch (error) {
        handleApiError(error, "generateTextToSpeech");
        throw error;
    }
};

export const createEditingChat = (paperData: QuestionPaperData) => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const chat = ai.chats.create({
        model: "gemini-2.5-flash",
        config: {
            systemInstruction: "You are an expert editor. For ANY math or fractions, ALWAYS use professional LaTeX $...$. Guide the user in refining the exam paper.",
            tools: [{ functionDeclarations: [] }]
        }
    });
    return chat;
};

export const getAiEditResponse = async (chat: Chat, instruction: string) => {
    try {
        const response = await chat.sendMessage({ message: instruction });
        return { functionCalls: response.functionCalls || null, text: response.text || null };
    } catch (error) {
        handleApiError(error, "getAiEditResponse");
        throw error;
    }
};

export const translatePaperService = async (paperData: QuestionPaperData, targetLanguage: string): Promise<QuestionPaperData> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({ 
            model: "gemini-2.5-flash", 
            contents: `Translate this exam paper into ${targetLanguage}. Keep LaTeX strings $...$ exactly the same. Return JSON.`, 
            config: { responseMimeType: "application/json" } 
        });
        const translatedContent = JSON.parse(response.text);
        const translatedPaper = { ...paperData, ...translatedContent };
        return { ...translatedPaper, htmlContent: generateHtmlFromPaperData(translatedPaper) };
    } catch (error) { 
        handleApiError(error, "translatePaperService");
        throw error;
    }
};

export const translateQuestionService = async (question: Question, targetLanguage: string): Promise<Question> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({ 
            model: "gemini-2.5-flash", 
            contents: `Translate this question to ${targetLanguage}. Preserve LaTeX math. Return JSON.`, 
            config: { responseMimeType: "application/json" } 
        });
        return { ...question, ...JSON.parse(response.text) };
    } catch(error) {
        handleApiError(error, "translateQuestionService");
        throw error;
    }
};

export const generateImage = async (prompt: string, aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({ 
            model: 'gemini-2.5-flash-image', 
            contents: prompt,
            config: { imageConfig: { aspectRatio } }
        });
        for (const part of response.candidates[0].content.parts) { if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`; }
        throw new Error("Internal Error Occurred");
    } catch(error) { 
        handleApiError(error, "generateImage");
        throw error;
    }
};

export const editImage = async (prompt: string, imageBase64: string, mimeType: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({ 
            model: 'gemini-2.5-flash-image', 
            contents: { parts: [ { inlineData: { data: imageBase64.split(',')[1], mimeType: mimeType } }, { text: prompt } ] } 
        });
        for (const part of response.candidates[0].content.parts) { if (part.inlineData) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`; }
        throw new Error("Internal Error Occurred");
    } catch (error) { 
        handleApiError(error, "editImage");
        throw error;
    }
};
