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
You are a configuration extraction engine for SSGPT.
Extract structured academic configuration from this transcript: "${transcript}"

Return ONLY a JSON object:
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
  const { schoolName, className, subject, topics, questionDistribution, totalMarks, language, timeAllowed, sourceMaterials, sourceMode, sourceFiles, modelQuality } = formData;

  const modelToUse = modelQuality === 'pro' ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';

  const questionRequests = questionDistribution
    .map(d => `- ${d.count} ${d.type} questions, each worth ${d.marks} marks. Difficulty: '${d.difficulty}', Taxonomy: '${d.taxonomy}'.`)
    .join('\n');
    
  const sourceMaterialInstruction = sourceMaterials || (sourceFiles && sourceFiles.length > 0)
    ? `
- **Source Materials to Use:**
${sourceMaterials}
${sourceMode === 'strict' ? "STRICT MODE: Generate questions ONLY from provided materials." : "REFERENCE MODE: Use materials as primary guide."}`
    : '';

  const finalPrompt = `
You are a professional typesetter and Question Paper Designer. Generate a high-quality exam paper in JSON format.

**STRICT MATHEMATICAL FORMATTING RULES (MANDATORY):**
1. **LATEX FOR ALL MATH:** Use proper LaTeX syntax for ALL mathematical expressions, formulas, fractions, negative numbers, and variables.
2. **DELIMITERS:** Use single dollar signs ($...$) for ALL inline math.
3. **FRACTIONS:** NEVER use plain text fractions like "3/4". ALWAYS use $\\frac{3}{4}$.
4. **SYMBOLS:** Use proper LaTeX: $\\times$ for multiply, $\\div$ for divide, $\\pm$ for plus-minus, $\\sqrt{x}$ for square roots, $\\pi$, $\\theta$, etc.
5. **MCQ OPTIONS:** If options contain numbers or math, wrap them in LaTeX $...$. E.g., options: ["$\\frac{1}{2}$", "$1.5$"].

**Paper Specifications:**
- Subject: ${subject}
- Class/Grade: ${className}
- Topics: ${topics}
- Language: ${language}
${sourceMaterialInstruction}

**Required Question Mix:**
${questionRequests}

Return ONLY a JSON array of objects with fields: type, questionText, options, answer, marks, difficulty, taxonomy.
`;

    const questionSchema = {
        type: Type.OBJECT,
        properties: {
            type: { type: Type.STRING, enum: Object.values(QuestionType) },
            questionText: { type: Type.STRING },
            options: { type: Type.ARRAY, items: { type: Type.STRING } },
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
            model: modelToUse,
            contents: { parts },
            config: { 
                responseMimeType: "application/json",
                responseSchema: { type: Type.ARRAY, items: questionSchema }
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
  const analysisPrompt = `Analyze and structure the following exam text into JSON. CRITICAL: Rewrite all plain math/fractions to professional LaTeX $...$. Text: ${text}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: analysisPrompt,
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
        model: "gemini-3-flash-preview",
        contents: { parts: [...imageParts, { text: "OCR this and structure into JSON. Convert math to LaTeX $...$." }] },
        config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text) as AnalysisResult;
  } catch (error) {
    handleApiError(error, "analyzeHandwrittenImages");
    throw error;
  }
};

export const generateChatResponseStream = async (chat: Chat, messageParts: Part[], useSearch?: boolean, useThinking?: boolean): Promise<AsyncGenerator<GenerateContentResponse>> => {
    const config: any = {};
    if (useSearch) config.tools = [{ googleSearch: {} }];
    if (useThinking) config.thinkingConfig = { thinkingBudget: 4096 };

    return chat.sendMessageStream({
        message: messageParts,
        config: Object.keys(config).length > 0 ? config : undefined,
    });
};

export const generateTextToSpeech = async (text: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: text,
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
        model: "gemini-3-pro-preview",
        config: {
            systemInstruction: "You are an expert academic editor. For any math, ALWAYS use LaTeX $...$. Guided editing only.",
            tools: [{ functionDeclarations: [] }]
        }
    });
    return chat;
};

export const getAiEditResponse = async (chat: Chat, instruction: string) => {
    const response = await chat.sendMessage({ message: instruction });
    return { functionCalls: response.functionCalls || null, text: response.text || null };
};

export const translatePaperService = async (paperData: QuestionPaperData, targetLanguage: string): Promise<QuestionPaperData> => {
    if (!process.env.API_KEY) throw new Error("Internal Error Occurred");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({ 
            model: "gemini-3-pro-preview", 
            contents: `Translate this exam paper into ${targetLanguage}. Maintain all LaTeX strings $...$ exactly. Return JSON.`, 
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
            model: "gemini-3-flash-preview", 
            contents: `Translate this question to ${targetLanguage}. Preserve all LaTeX math. Return JSON.`, 
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
