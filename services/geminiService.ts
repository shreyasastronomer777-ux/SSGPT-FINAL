import { GoogleGenAI, Type, FunctionDeclaration, Modality, Chat, Part, GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { type FormData, type QuestionPaperData, QuestionType, Question, Difficulty, Taxonomy, AnalysisResult, QuestionDistributionItem } from '../types';
import { generateHtmlFromPaperData } from "./htmlGenerator";

const handleApiError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    // Always throw a friendly message as requested by the user
    throw new Error("Internal Error Occurred");
};

export const extractConfigFromTranscript = async (transcript: string): Promise<any> => {
    if (!process.env.API_KEY) throw new Error("API_KEY not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const prompt = `
You are a configuration extraction engine for SSGPT, an AI exam paper generator.
Your job is to extract structured academic configuration from a user's spoken instruction.

**Transcript:** "${transcript}"

**Mapping Rules:**
- MCQ -> "Multiple Choice"
- Short Answer -> "Short Answer"
- Long Answer -> "Long Answer"
- Fill in the blanks -> "Fill in the Blanks"
- Match the following -> "Match the Following"
- True/False -> "True / False"

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
      "type": "Multiple Choice" | "Short Answer" | etc.,
      "count": number,
      "marks": number,
      "taxonomy": "Remembering" | "Understanding" | "Applying" | "Analyzing" | "Evaluating" | "Creating"
    }
  ]
}

If a field is missing, leave it as an empty string or use defaults (Medium difficulty, Understanding taxonomy, 1 mark for simple types, 5 for long).
Do not explain anything. Output ONLY the JSON.
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
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
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
${sourceMode === 'strict'
        ? "**CRITICAL INSTRUCTION: You MUST generate questions exclusively from the provided 'Source Materials' and attached files. Do not use any external knowledge or information beyond what is given.**"
        : "**GUIDELINE: Prioritize generating questions from the provided 'Source Materials' and attached files. You may also generate supplementary questions based on the general topics if needed to meet the required question count.**"}`
    : '';

  const finalPrompt = `
You are an expert question paper creator for educational content. Your task is to generate a structured JSON array of question objects based on the provided specifications.

**Specifications:**
- **Subject:** ${subject}
- **Class:** ${className}
- **Topics:** ${topics}
- **Language:** ${language}
${sourceMaterialInstruction}

- **Required Question Mix:**
${questionRequests}

**Instructions:**
1.  Generate the precise number of questions for each type as specified in the "Required Question Mix".
2.  For each question, create a JSON object with the following fields: "type", "questionText", "options", "answer", "marks", "difficulty", "taxonomy".
3.  **questionText**: The main body of the question. For "Fill in the Blanks", use underscores (e.g., "The capital of France is ____.").
4.  **options**: This field MUST be a string.
    - For 'Multiple Choice', provide a JSON string representation of an array of 4 options (e.g., '["Paris", "London", "Berlin", "Madrid"]').
    - For 'Match the Following', provide a JSON string of an object with 'columnA' and 'columnB' keys, which are string arrays (e.g., '{"columnA": ["France", "Germany"], "columnB": ["Berlin", "Paris"]}'). Ensure Column B is shuffled.
    - For all other question types, provide an empty string "".
5.  **answer**: This field MUST be a string.
    - For 'Multiple Choice', 'Fill in the Blanks', 'True-False', 'Short Answer', 'Long Answer', provide the correct answer as a simple string. For Fill in the Blanks with multiple blanks, separate answers with a comma.
    - For 'Match the Following', provide a JSON string of an object mapping items from Column A to their correct match in Column B (e.g., '{"France": "Paris", "Germany": "Berlin"}').
6.  Ensure all generated text content (questionText, options, answer) is in the specified language: **${language}**.
7.  Adhere strictly to the difficulty and taxonomy levels for each question request.
8.  If 'Source Materials' or attached files are provided, you must follow the specific instruction related to them.

Your entire output must be ONLY the JSON array of question objects, without any surrounding text, explanations, or markdown formatting.
`;

    const questionSchema = {
        type: Type.OBJECT,
        properties: {
            type: { type: Type.STRING, enum: Object.values(QuestionType) },
            questionText: { type: Type.STRING },
            options: { 
                type: Type.STRING,
                description: "A JSON string for options. E.g., '[\"A\", \"B\"]' for MCQs, or '{\"columnA\": [], \"columnB\": []}' for Matching. Empty string for others."
            },
            answer: { 
                type: Type.STRING,
                description: "The answer. A simple string, or a JSON string for Matching type (e.g., '{\"A\": \"B\"}')."
            },
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
                parts.push({
                    inlineData: {
                        data: file.data,
                        mimeType: file.mimeType,
                    },
                });
            }
        }

        const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: [{ parts }],
        config: { 
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: questionSchema
            }
        }
        });

        const generatedQuestionsRaw = JSON.parse(response.text) as any[];

        if (!Array.isArray(generatedQuestionsRaw)) {
            throw new Error("Internal Error Occurred");
        }
        
        const processedQuestions: Omit<Question, 'questionNumber'>[] = generatedQuestionsRaw.map(q => {
            let parsedOptions: any = null;
            if (q.options && typeof q.options === 'string') {
                try {
                    parsedOptions = JSON.parse(q.options);
                } catch (e) {
                    console.warn(`Could not parse options JSON string: "${q.options}"`, e);
                    parsedOptions = null;
                }
            }

            let parsedAnswer: any = q.answer;
            if (q.type === QuestionType.MatchTheFollowing && typeof q.answer === 'string') {
                 try {
                    parsedAnswer = JSON.parse(q.answer);
                } catch (e) {
                    console.warn(`Could not parse answer JSON string for Matching question: "${q.answer}"`, e);
                }
            }

            return {
                ...q,
                options: parsedOptions,
                answer: parsedAnswer,
            };
        });


        const questionsWithPlaceholders: Question[] = processedQuestions.map((q, index) => ({
            ...q,
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
            questions: questionsWithPlaceholders,
            htmlContent: '',
            createdAt: new Date().toISOString(),
        };
        
        const htmlContent = generateHtmlFromPaperData(structuredPaperData);

        return { ...structuredPaperData, htmlContent };

    } catch (error) {
        handleApiError(error, "generateQuestionPaper");
        throw error;
    }
};

const analysisSchema = {
    type: Type.OBJECT,
    properties: {
      extractedData: {
        type: Type.OBJECT,
        properties: {
          schoolName: { type: Type.STRING, nullable: true },
          className: { type: Type.STRING, nullable: true },
          subject: { type: Type.STRING, nullable: true },
          timeAllowed: { type: Type.STRING, nullable: true },
          totalMarks: { type: Type.NUMBER, nullable: true },
        },
        required: ['schoolName', 'className', 'subject', 'timeAllowed', 'totalMarks']
      },
      missingFields: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      },
      extractedQuestions: {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                type: { type: Type.STRING, enum: Object.values(QuestionType) },
                questionText: { type: Type.STRING },
                options: { type: Type.STRING, description: "A JSON string for options. E.g., '[\"A\", \"B\"]' for MCQs, or '{\"columnA\": [], \"columnB\": []}' for Matching. Empty string for others." },
                answer: { type: Type.STRING, description: "The answer. A simple string, or a JSON string for Matching type. Empty string if not provided in source." },
                marks: { type: Type.NUMBER },
                difficulty: { type: Type.STRING, enum: Object.values(Difficulty) },
                taxonomy: { type: Type.STRING, enum: Object.values(Taxonomy) },
            },
            required: ['type', 'questionText', 'options', 'answer', 'marks', 'difficulty', 'taxonomy']
        }
      },
    },
    required: ['extractedData', 'missingFields', 'extractedQuestions']
  };

export const analyzePastedText = async (text: string): Promise<AnalysisResult> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
  }
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const analysisPrompt = `
You are an expert at analyzing and structuring educational content. Your task is to process the following text, which contains a list of questions for an exam, and return a structured JSON object.

**Text to Analyze:**
---
${text}
---

**Instructions:**
1.  **Parse Questions**: Carefully parse each question from the text. For each question, create a JSON object and add it to the 'extractedQuestions' array.
2.  **Extract Metadata**: Read the entire text to identify the following details: 'schoolName', 'className' (or grade), 'subject', 'timeAllowed', and 'totalMarks'.
3.  **Identify Missing Fields**: Create a list of strings called 'missingFields' that contains the keys of any metadata details you could not find.

Your entire output must be ONLY the JSON object conforming to the provided schema.
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts: [{ text: analysisPrompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: analysisSchema
      }
    });

    return JSON.parse(response.text) as AnalysisResult;

  } catch (error) {
    handleApiError(error, "analyzePastedText");
    throw error;
  }
};

export const analyzeHandwrittenImages = async (imageParts: Part[]): Promise<AnalysisResult> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
  }
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const analysisPrompt = `
You are an expert at analyzing and structuring educational content from images. Your task is to perform Optical Character Recognition (OCR) on the following images, which contain a handwritten or printed exam, and then return a structured JSON object conforming to the specified schema.
`;

    const contents = [{ parts: [...imageParts, { text: analysisPrompt }] }];

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents,
            config: {
                responseMimeType: "application/json",
                responseSchema: analysisSchema
            }
        });
        return JSON.parse(response.text) as AnalysisResult;
    } catch (error) {
        handleApiError(error, "analyzeHandwrittenImages");
        throw error;
    }
};

export const generateChatResponseStream = async (chat: Chat, messageParts: Part[], useSearch?: boolean, useThinking?: boolean): Promise<AsyncGenerator<GenerateContentResponse>> => {
    try {
        if (useSearch || useThinking) {
            const config: any = {};
            if (useSearch) config.tools = [{ googleSearch: {} }];
            if (useThinking) config.thinkingConfig = { thinkingBudget: 8192 };

            return chat.sendMessageStream({
                contents: { parts: messageParts },
                config: config,
            });
        }
        return chat.sendMessageStream({ message: messageParts });
    } catch (error) {
        handleApiError(error, "generateChatResponseStream");
        throw error;
    }
};


export const generateTextToSpeech = async (text: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
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

const editTools: FunctionDeclaration[] = [
  { name: 'addQuestion', description: 'Adds a new question to the question paper. Generate all the details for the question before calling this function.', parameters: { type: Type.OBJECT, properties: { type: { type: Type.STRING, enum: Object.values(QuestionType) }, questionText: { type: Type.STRING }, options: { type: Type.STRING, description: "JSON string for options if applicable. E.g., '[\"A\", \"B\", \"C\"]' or '{\"columnA\": [], \"columnB\": []}'." }, answer: { type: Type.STRING, description: "Correct answer. Must be a JSON string for 'Match the Following' type." }, marks: { type: Type.INTEGER }, difficulty: { type: Type.STRING, enum: ['Easy', 'Medium', 'Hard'] }, taxonomy: { type: Type.STRING, enum: ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'] }, }, required: ['type', 'questionText', 'answer', 'marks', 'difficulty', 'taxonomy'] } },
  { name: 'updateQuestion', description: 'Updates one or more parts of an existing question, such as rephrasing its text, changing its marks, or styling it.', parameters: { type: Type.OBJECT, properties: { questionNumber: { type: Type.INTEGER, description: 'The number of the question to update.' }, updates: { type: Type.OBJECT, properties: { questionText: { type: Type.STRING }, options: { type: Type.STRING }, answer: { type: Type.STRING }, marks: { type: Type.INTEGER }, styles: { type: Type.OBJECT, properties: { color: { type: Type.STRING, description: "A hex color code, e.g., '#FF0000'." } } } }, description: 'An object containing the fields of the question to update.' } }, required: ['questionNumber', 'updates'] } },
  { name: 'deleteQuestion', description: 'Deletes an existing question from the paper.', parameters: { type: Type.OBJECT, properties: { questionNumber: { type: Type.INTEGER, description: 'The number of the question to delete.' } }, required: ['questionNumber'] } },
  { name: 'bulkUpdateQuestions', description: 'Updates multiple questions at once based on a set of filters.', parameters: { type: Type.OBJECT, properties: { filters: { type: Type.OBJECT, properties: { type: { type: Type.STRING, enum: Object.values(QuestionType) }, difficulty: { type: Type.STRING, enum: ['Easy', 'Medium', 'Hard'] }, taxonomy: { type: Type.STRING, enum: ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'] }, } }, updates: { type: Type.OBJECT, properties: { marks: { type: Type.INTEGER }, difficulty: { type: Type.STRING, enum: ['Easy', 'Medium', 'Hard'] }, taxonomy: { type: Type.STRING, enum: ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'] }, } } }, required: ['filters', 'updates'] } },
  { name: 'findAndReplaceText', description: 'Finds and replaces a specific piece of text.', parameters: { type: Type.OBJECT, properties: { findText: { type: Type.STRING }, replaceText: { type: Type.STRING }, questionNumber: { type: Type.INTEGER } }, required: ['findText', 'replaceText'] } },
  { name: 'updatePaperStyles', description: 'Modifies the visual style of the entire question paper.', parameters: { type: Type.OBJECT, properties: { fontFamily: { type: Type.STRING }, headingColor: { type: Type.STRING }, borderColor: { type: Type.STRING }, borderWidth: { type: Type.INTEGER }, borderStyle: { type: Type.STRING, enum: ['solid', 'dashed', 'dotted', 'double'] }, } } },
  { name: 'translatePaper', description: 'Translates the entire question paper content to a specified language.', parameters: { type: Type.OBJECT, properties: { targetLanguage: { type: Type.STRING } }, required: ['targetLanguage'] } },
  { name: 'translateQuestion', description: 'Translates a single, specific question to a target language.', parameters: { type: Type.OBJECT, properties: { questionNumber: { type: Type.INTEGER }, targetLanguage: { type: Type.STRING } }, required: ['questionNumber', 'targetLanguage'] } },
  { name: 'addTextBox', description: 'Adds a new, empty text box to the current page for user input.' },
  { name: 'requestImageGeneration', description: 'Opens the image generation tool for the user.', parameters: { type: Type.OBJECT, properties: { prompt: { type: Type.STRING } } } }
];

export const createEditingChat = (paperData: QuestionPaperData) => {
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const questionsSummary = paperData.questions.map(q => `${q.questionNumber}. ${q.type} - ${q.questionText.substring(0, 50)}...`).join('\n');
    const systemInstruction = `You are a conversational AI co-editor for a question paper application. Your personality is helpful, concise, and precise.
- **Goal**: Your primary goal is to assist the user in editing their document by calling the provided tools.
- ** Interaction**: Call the appropriate tool based on user instructions.
- **Current Paper Context**:
  - Subject: ${paperData.subject}
  - Class: ${paperData.className}
  - Questions Summary:
${questionsSummary}`;

    const chat = ai.chats.create({
        model: "gemini-3-flash-preview",
        config: {
            systemInstruction,
            tools: [{ functionDeclarations: editTools }]
        }
    });
    return chat;
};

export const getAiEditResponse = async (chat: Chat, instruction: string) => {
    try {
        const response = await chat.sendMessage({ message: instruction });
        if (response.functionCalls && response.functionCalls.length > 0) {
            return { functionCalls: response.functionCalls, text: null };
        }
        return { functionCalls: null, text: response.text };
    } catch (error) {
        handleApiError(error, "getAiEditResponse");
        throw error;
    }
};

export const translatePaperService = async (paperData: QuestionPaperData, targetLanguage: string): Promise<QuestionPaperData> => {
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `You are a translation expert. Translate the provided paper into **${targetLanguage}**. Maintain JSON structure.`;
    try {
        const response = await ai.models.generateContent({ model: "gemini-3-flash-preview", contents: prompt, config: { responseMimeType: "application/json" } });
        const translatedContent = JSON.parse(response.text);
        const translatedPaper = { ...paperData, ...translatedContent };
        const newHtmlContent = generateHtmlFromPaperData(translatedPaper);
        return { ...translatedPaper, htmlContent: newHtmlContent };
    } catch (error) { 
        handleApiError(error, "translatePaperService");
        throw error;
    }
};

export const translateQuestionService = async (question: Question, targetLanguage: string): Promise<Question> => {
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `Translate the following question into **${targetLanguage}**.`;
    try {
        const response = await ai.models.generateContent({ model: "gemini-3-flash-preview", contents: prompt, config: { responseMimeType: "application/json" } });
        const translatedContent = JSON.parse(response.text);
        return { ...question, ...translatedContent };
    } catch(error) {
        handleApiError(error, "translateQuestionService");
        throw error;
    }
};

export const generateImage = async (prompt: string, aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
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
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash-image', contents: { parts: [ { inlineData: { data: imageBase64.split(',')[1], mimeType: mimeType } }, { text: prompt } ] } });
        for (const part of response.candidates[0].content.parts) { if (part.inlineData) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`; }
        throw new Error("Internal Error Occurred");
    } catch (error) { 
        handleApiError(error, "editImage");
        throw error;
    }
};