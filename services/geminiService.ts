
import { GoogleGenAI, Type, FunctionDeclaration, Modality, Chat, Part, GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { type FormData, type QuestionPaperData, QuestionType, Question, Difficulty, Taxonomy, AnalysisResult, QuestionDistributionItem } from '../types';
import { generateHtmlFromPaperData } from "./htmlGenerator";

// Custom Error for Rate Limiting
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

// Resilience: Models to try in order of preference.
// 1.5 Flash 8B is added as a high-speed, high-quota backup.
const FALLBACK_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-1.5-pro"];

const handleApiError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    let msg = error instanceof Error ? error.message : String(error);
    
    if (msg.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(msg);
            if (parsed.error && parsed.error.message) {
                msg = parsed.error.message;
            } else if (parsed.message) {
                msg = parsed.message;
            }
        } catch (e) {}
    }

    if (msg.includes("429") || msg.includes("Quota") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("Overloaded") || msg.includes("503")) {
        throw new RateLimitError("High traffic. We are automatically switching to backup servers...");
    }
    
    // Explicitly handle 400/404 which usually mean "Model Not Found"
    if (msg.includes("404") || msg.includes("not found") || msg.includes("400")) {
         throw new Error(`Service Error: The AI model is currently unavailable or the API key has insufficient permissions. (${msg})`);
    }
    
    throw new Error(msg);
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Retry logic for a SINGLE operation
async function callWithRetry<T>(operation: () => Promise<T>, retries = 3, initialDelay = 1000): Promise<T> {
    try {
        return await operation();
    } catch (error: any) {
        const msg = error.message || '';
        const isTransient = msg.includes("429") || msg.includes("Quota") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("Overloaded") || msg.includes("503");

        if (retries > 0 && isTransient) {
            const jitter = Math.random() * 500;
            const delayTime = initialDelay + jitter;
            console.warn(`Transient error. Retrying in ${Math.round(delayTime)}ms... (${retries} left)`);
            await sleep(delayTime);
            return callWithRetry(operation, retries - 1, initialDelay * 2);
        }
        throw error;
    }
}

// NEW: Wrapper that attempts the operation across multiple models if the first one fails
async function withModelFallback<T>(
    ai: GoogleGenAI, 
    operationBuilder: (modelName: string) => Promise<T>
): Promise<T> {
    let lastError: any;

    for (const model of FALLBACK_MODELS) {
        try {
            // Try specific model with retries
            return await callWithRetry(async () => {
                return await operationBuilder(model);
            });
        } catch (error: any) {
            console.warn(`Model ${model} failed. Switching to fallback...`, error);
            lastError = error;
            // If it's a 404/400 (Invalid Argument/Not Found), we SHOULD also fallback because it might be a model availability issue in that region
            // But if it's a permission denied (API key issue), fallback won't help.
            const msg = error.message || '';
            const isAuthError = msg.includes("API_KEY") || msg.includes("PERMISSION_DENIED");
            
            if (isAuthError) throw error; 
            // Otherwise loop to next model
        }
    }
    
    // If all models fail
    if (lastError) {
        handleApiError(lastError, "All models exhausted");
    }
    throw new Error("Service temporarily unavailable after multiple attempts.");
}

export const extractConfigFromTranscript = async (transcript: string): Promise<any> => {
    if (!process.env.API_KEY) throw new Error("API_KEY not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const prompt = `
You are a configuration extraction engine. Extract structured configuration from: "${transcript}".
Mapping: MCQ->"Multiple Choice", Short->"Short Answer", Long->"Long Answer", Blanks->"Fill in the Blanks", Match->"Match the Following", TF->"True / False".
Return JSON ONLY:
{ "schoolName": "", "className": "", "subject": "", "topics": "", "difficulty": "Medium", "timeAllowed": "", "questionDistribution": [ { "type": "Multiple Choice", "count": 5, "marks": 1, "taxonomy": "Understanding" } ] }
`;

    return withModelFallback(ai, async (model) => {
        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        return JSON.parse(response.text);
    });
};

export const generateQuestionPaper = async (formData: FormData): Promise<QuestionPaperData> => {
  if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const { schoolName, className, subject, topics, questionDistribution, totalMarks, language, timeAllowed, sourceMaterials, sourceMode, sourceFiles } = formData;

  const questionRequests = questionDistribution
    .map(d => `- ${d.count} ${d.type} questions, each worth ${d.marks} marks. Difficulty: '${d.difficulty}', Taxonomy: '${d.taxonomy}'.`)
    .join('\n');
    
  const sourceMaterialInstruction = sourceMaterials || (sourceFiles && sourceFiles.length > 0)
    ? `\n- **Source Materials:**\n${sourceMaterials}\n${sourceMode === 'strict' ? "**STRICT MODE: Use ONLY provided source materials.**" : "**REFERENCE MODE: Prioritize source materials but allow general knowledge.**"}`
    : '';

  const finalPrompt = `
Generate a structured exam paper JSON.
**Subject:** ${subject}, **Class:** ${className}, **Topics:** ${topics}, **Language:** ${language}
${sourceMaterialInstruction}
**Requests:**
${questionRequests}

**Output Rules:**
1. JSON Array of objects.
2. Fields: "type", "questionText", "options" (JSON string), "answer" (string), "marks", "difficulty", "taxonomy".
3. "options": For MCQ, JSON string '["A","B","C","D"]'. For Match, JSON string '{"columnA":["1","2"], "columnB":["A","B"]}'. Else empty string.
4. "answer": Simple string. For Match, JSON string mapping '{"1":"A"}'.
5. **questionText**: Use LaTeX ($...$) for math.
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

    const parts: Part[] = [{ text: finalPrompt }];
    if (sourceFiles) {
        for (const file of sourceFiles) {
            parts.push({ inlineData: { data: file.data, mimeType: file.mimeType } });
        }
    }

    const generatedQuestionsRaw = await withModelFallback(ai, async (model) => {
        const response = await ai.models.generateContent({
            model: model,
            contents: [{ parts }],
            config: { 
                responseMimeType: "application/json",
                responseSchema: { type: Type.ARRAY, items: questionSchema }
            }
        });
        return JSON.parse(response.text) as any[];
    });

    if (!Array.isArray(generatedQuestionsRaw)) throw new Error("Invalid AI response");

    const processedQuestions: Omit<Question, 'questionNumber'>[] = generatedQuestionsRaw.map(q => {
        let parsedOptions: any = null;
        try { parsedOptions = q.options ? JSON.parse(q.options) : null; } catch (e) {}
        let parsedAnswer: any = q.answer;
        if (q.type === QuestionType.MatchTheFollowing) { try { parsedAnswer = JSON.parse(q.answer); } catch (e) {} }

        return { ...q, options: parsedOptions, answer: parsedAnswer };
    });

    const structuredPaperData: QuestionPaperData = {
        id: `paper-${Date.now()}`,
        schoolName, className, subject, totalMarks: String(totalMarks), timeAllowed,
        questions: processedQuestions.map((q, i) => ({ ...q, questionNumber: i + 1 })),
        htmlContent: '', createdAt: new Date().toISOString(),
    };
    
    return { ...structuredPaperData, htmlContent: generateHtmlFromPaperData(structuredPaperData) };
};

const analysisSchema = {
    type: Type.OBJECT,
    properties: {
      extractedData: { type: Type.OBJECT, properties: { schoolName: { type: Type.STRING, nullable: true }, className: { type: Type.STRING, nullable: true }, subject: { type: Type.STRING, nullable: true }, timeAllowed: { type: Type.STRING, nullable: true }, totalMarks: { type: Type.NUMBER, nullable: true } }, required: ['schoolName', 'className', 'subject', 'timeAllowed', 'totalMarks'] },
      missingFields: { type: Type.ARRAY, items: { type: Type.STRING } },
      extractedQuestions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { type: { type: Type.STRING, enum: Object.values(QuestionType) }, questionText: { type: Type.STRING }, options: { type: Type.STRING }, answer: { type: Type.STRING }, marks: { type: Type.NUMBER }, difficulty: { type: Type.STRING, enum: Object.values(Difficulty) }, taxonomy: { type: Type.STRING, enum: Object.values(Taxonomy) } }, required: ['type', 'questionText', 'options', 'answer', 'marks', 'difficulty', 'taxonomy'] } },
    },
    required: ['extractedData', 'missingFields', 'extractedQuestions']
};

export const analyzePastedText = async (text: string): Promise<AnalysisResult> => {
  if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `Analyze this text and extract exam structure:\n${text}`;

  return withModelFallback(ai, async (model) => {
      const response = await ai.models.generateContent({
          model: model,
          contents: [{ parts: [{ text: prompt }] }],
          config: { responseMimeType: "application/json", responseSchema: analysisSchema }
      });
      return JSON.parse(response.text) as AnalysisResult;
  });
};

export const analyzeHandwrittenImages = async (imageParts: Part[]): Promise<AnalysisResult> => {
  if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `OCR these exam images and extract structure.`;

  return withModelFallback(ai, async (model) => {
      const response = await ai.models.generateContent({
          model: model,
          contents: [{ parts: [...imageParts, { text: prompt }] }],
          config: { responseMimeType: "application/json", responseSchema: analysisSchema }
      });
      return JSON.parse(response.text) as AnalysisResult;
  });
};

export const generateChatResponseStream = async (chat: Chat, messageParts: Part[], useSearch?: boolean, useThinking?: boolean): Promise<AsyncGenerator<GenerateContentResponse>> => {
    // Chat doesn't easily support model fallback because the session is tied to a model.
    // We rely on standard retries here.
    return await callWithRetry(async () => {
        const config: any = {};
        if (useSearch) config.tools = [{ googleSearch: {} }];
        if (useThinking) config.thinkingConfig = { thinkingBudget: 8192 };
        return await chat.sendMessageStream({ message: messageParts, config });
    }, 5); 
};

export const generateTextToSpeech = async (text: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API_KEY not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    return await callWithRetry(async () => {
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash-exp", // Specific TTS model needed usually, but using Exp for now or specific speech model if available
            contents: [{ parts: [{ text }] }],
            config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
        });
        const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!data) throw new Error("No audio data");
        return data;
    });
};

const editTools: FunctionDeclaration[] = [
  { name: 'addQuestion', description: 'Adds a new question.', parameters: { type: Type.OBJECT, properties: { type: { type: Type.STRING, enum: Object.values(QuestionType) }, questionText: { type: Type.STRING }, options: { type: Type.STRING }, answer: { type: Type.STRING }, marks: { type: Type.INTEGER }, difficulty: { type: Type.STRING, enum: ['Easy', 'Medium', 'Hard'] }, taxonomy: { type: Type.STRING, enum: ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'] }, }, required: ['type', 'questionText', 'answer', 'marks', 'difficulty', 'taxonomy'] } },
  { name: 'updateQuestion', description: 'Updates a question.', parameters: { type: Type.OBJECT, properties: { questionNumber: { type: Type.INTEGER }, updates: { type: Type.OBJECT, properties: { questionText: { type: Type.STRING }, options: { type: Type.STRING }, answer: { type: Type.STRING }, marks: { type: Type.INTEGER }, styles: { type: Type.OBJECT, properties: { color: { type: Type.STRING } } } } } }, required: ['questionNumber', 'updates'] } },
  { name: 'deleteQuestion', description: 'Deletes a question.', parameters: { type: Type.OBJECT, properties: { questionNumber: { type: Type.INTEGER } }, required: ['questionNumber'] } },
  { name: 'bulkUpdateQuestions', description: 'Updates multiple questions.', parameters: { type: Type.OBJECT, properties: { filters: { type: Type.OBJECT, properties: { type: { type: Type.STRING }, difficulty: { type: Type.STRING } } }, updates: { type: Type.OBJECT, properties: { marks: { type: Type.INTEGER }, difficulty: { type: Type.STRING } } } }, required: ['filters', 'updates'] } },
  { name: 'findAndReplaceText', description: 'Finds and replaces text.', parameters: { type: Type.OBJECT, properties: { findText: { type: Type.STRING }, replaceText: { type: Type.STRING }, questionNumber: { type: Type.INTEGER } }, required: ['findText', 'replaceText'] } },
  { name: 'updatePaperStyles', description: 'Modifies style.', parameters: { type: Type.OBJECT, properties: { fontFamily: { type: Type.STRING }, headingColor: { type: Type.STRING }, borderColor: { type: Type.STRING }, borderWidth: { type: Type.INTEGER }, borderStyle: { type: Type.STRING } } } },
  { name: 'translatePaper', description: 'Translates paper.', parameters: { type: Type.OBJECT, properties: { targetLanguage: { type: Type.STRING } }, required: ['targetLanguage'] } },
  { name: 'translateQuestion', description: 'Translates question.', parameters: { type: Type.OBJECT, properties: { questionNumber: { type: Type.INTEGER }, targetLanguage: { type: Type.STRING } }, required: ['questionNumber', 'targetLanguage'] } },
  { name: 'addTextBox', description: 'Adds text box.' },
  { name: 'requestImageGeneration', description: 'Requests image generation.', parameters: { type: Type.OBJECT, properties: { prompt: { type: Type.STRING } } } }
];

export const createEditingChat = (paperData: QuestionPaperData) => {
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const questionsSummary = paperData.questions.map(q => `${q.questionNumber}. ${q.type} - ${q.questionText.substring(0, 50)}...`).join('\n');
    const systemInstruction = `You are a conversational AI co-editor. Context:\nSubject: ${paperData.subject}\nQuestions:\n${questionsSummary}`;
    return ai.chats.create({ model: "gemini-2.0-flash", config: { systemInstruction, tools: [{ functionDeclarations: editTools }] } });
};

export const getAiEditResponse = async (chat: Chat, instruction: string) => {
    return await callWithRetry(async () => {
        const response = await chat.sendMessage({ message: instruction });
        if (response.functionCalls && response.functionCalls.length > 0) return { functionCalls: response.functionCalls, text: null };
        return { functionCalls: null, text: response.text };
    });
};

export const translatePaperService = async (paperData: QuestionPaperData, targetLanguage: string): Promise<QuestionPaperData> => {
    if (!process.env.API_KEY) throw new Error("API_KEY not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const textContent = { schoolName: paperData.schoolName, className: paperData.className, subject: paperData.subject, questions: paperData.questions.map(q => ({ questionNumber: q.questionNumber, questionText: q.questionText, options: q.options, answer: q.answer })) };
    const prompt = `Translate this JSON to ${targetLanguage}. Return valid JSON structure. Data: ${JSON.stringify(textContent)}`;
    
    return withModelFallback(ai, async (model) => {
        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        const translatedContent = JSON.parse(response.text);
        // ... (merging logic same as before, simplified for brevity in this robust block)
        const translatedQuestions = paperData.questions.map(originalQ => {
             const tq = translatedContent.questions.find((t:any) => t.questionNumber === originalQ.questionNumber);
             return tq ? { ...originalQ, ...tq } : originalQ;
        });
        const translatedPaper = { ...paperData, ...translatedContent, questions: translatedQuestions };
        return { ...translatedPaper, htmlContent: generateHtmlFromPaperData(translatedPaper) };
    });
};

export const translateQuestionService = async (question: Question, targetLanguage: string): Promise<Question> => {
    if (!process.env.API_KEY) throw new Error("API_KEY not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Translate to ${targetLanguage}. Return JSON {questionText, options, answer}. Input: ${JSON.stringify(question)}`;
    
    return withModelFallback(ai, async (model) => {
        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        const translated = JSON.parse(response.text);
        return { ...question, ...translated };
    });
};

export const generateImage = async (prompt: string, aspectRatio: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API_KEY not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    return await callWithRetry(async () => {
        const response = await ai.models.generateImages({
            model: 'imagen-4.0-generate-001', // Explicit imagen model
            prompt: prompt,
            config: { numberOfImages: 1, outputMimeType: 'image/png', aspectRatio: aspectRatio as any }
        });
        if (response.generatedImages?.[0]) return `data:image/png;base64,${response.generatedImages[0].image.imageBytes}`;
        throw new Error("Image gen failed");
    });
};

export const editImage = async (prompt: string, imageBase64: string, mimeType: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API_KEY not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    return withModelFallback(ai, async (model) => {
        const response = await ai.models.generateContent({
            model: model,
            contents: { parts: [ { inlineData: { data: imageBase64.split(',')[1], mimeType } }, { text: prompt } ] },
            config: { responseModalities: [Modality.IMAGE] }
        });
        const part = response.candidates?.[0]?.content?.parts?.[0];
        if (part?.inlineData) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        throw new Error("Image edit failed");
    });
};
