
import { GoogleGenAI, Type, FunctionDeclaration, Modality, Chat, Part, GenerateContentParameters, GenerateContentResponse } from "@google/genai";
// Fix: Added QuestionPaperData to the import list from '../types'
import { type FormData, type QuestionPaperData, QuestionType, Question, Difficulty, Taxonomy, AnalysisResult, QuestionDistributionItem } from '../types';
import { generateHtmlFromPaperData } from "./htmlGenerator";

// Custom Error for Rate Limiting
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

const handleApiError = (error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    let msg = error instanceof Error ? error.message : String(error);
    
    // Attempt to parse JSON error message if it looks like one (often from 429 responses)
    if (msg.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(msg);
            if (parsed.error && parsed.error.message) {
                msg = parsed.error.message;
            } else if (parsed.message) {
                msg = parsed.message;
            }
        } catch (e) {
            // Ignore parsing errors
        }
    }

    // Detect 429 or Service Unavailable or Overloaded model
    if (msg.includes("429") || msg.includes("Quota") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("Overloaded") || msg.includes("503")) {
        throw new RateLimitError("High traffic detected. We are processing your request, please wait...");
    }
    
    throw new Error(msg);
};

// --- Resilience Logic: Exponential Backoff ---
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function callWithRetry<T>(operation: () => Promise<T>, retries = 5, initialDelay = 2000): Promise<T> {
    try {
        return await operation();
    } catch (error: any) {
        const msg = error.message || '';
        const isTransient = msg.includes("429") || msg.includes("Quota") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("Overloaded") || msg.includes("503");

        if (retries > 0 && isTransient) {
            // Add jitter to prevent thundering herd
            const jitter = Math.random() * 1000;
            const delayTime = initialDelay + jitter;
            
            console.warn(`Rate limit hit. Retrying in ${Math.round(delayTime)}ms... (${retries} attempts left)`);
            await sleep(delayTime);
            
            // Double the delay for the next attempt (Exponential Backoff)
            return callWithRetry(operation, retries - 1, initialDelay * 2);
        }
        
        // If retries exhausted or error is not transient, re-throw via handler
        if (isTransient) {
             throw new RateLimitError("System is under extreme load. Please try again in a minute.");
        }
        throw error;
    }
}

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
        return await callWithRetry(async () => {
            const response = await ai.models.generateContent({
                model: "gemini-2.0-flash",
                contents: prompt,
                config: { responseMimeType: "application/json" }
            });
            return JSON.parse(response.text);
        });
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
3.  **questionText**: The main body of the question. For "Fill in the Blanks", use underscores (e.g., "The capital of France is ____."). Use LaTeX for math equations wrapped in $...$ (inline) or $$...$$ (display).
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

        const generatedQuestionsRaw = await callWithRetry(async () => {
            const response = await ai.models.generateContent({
                model: "gemini-2.0-flash",
                contents: [{ parts }],
                config: { 
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: questionSchema
                    }
                }
            });
            return JSON.parse(response.text) as any[];
        });

        if (!Array.isArray(generatedQuestionsRaw)) {
            throw new Error("AI did not return a valid array of questions.");
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
        throw error; // Typescript fallback
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
    -   **DO NOT change the wording** of the questions or options. Your job is to structure the existing content.
    -   Infer the 'type' of each question (e.g., 'Multiple Choice', 'Fill in the Blanks').
    -   Extract the 'questionText'.
    -   For 'Multiple Choice', parse the options into a JSON string of an array. **Crucially, extract only the text of the option, removing any existing labels like 'a)', '(b)', '1.', etc.** (e.g., '["Paris", "London"]').
    -   For 'Match the Following', parse the columns into a JSON string of an object with 'columnA' and 'columnB' arrays.
    -   If an 'answer' is provided, extract it. If not, set the 'answer' field to an empty string "".
    -   Infer the 'marks' for each question. If not specified, make a reasonable guess (e.g., 1 for simple questions, 5 for long ones).
    -   Infer the 'difficulty' ('Easy', 'Medium', 'Hard') and 'taxonomy' ('Remembering', 'Understanding', etc.) based on the question's content and complexity.
2.  **Extract Metadata**: Read the entire text to identify the following details: 'schoolName', 'className' (or grade), 'subject', 'timeAllowed', and 'totalMarks'.
    -   If a detail is explicitly mentioned, extract its value.
    -   If a detail is NOT mentioned, its value in the 'extractedData' object must be \`null\`.
    -   **DO NOT extract topics.** The questions themselves define the topics.
3.  **Identify Missing Fields**: Create a list of strings called 'missingFields' that contains the keys of any metadata details you could not find (i.e., any key whose value is \`null\` in 'extractedData').

Your entire output must be ONLY the JSON object conforming to the provided schema, without any surrounding text, explanations, or markdown formatting.
`;

  try {
    return await callWithRetry(async () => {
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [{ parts: [{ text: analysisPrompt }] }],
            config: {
                responseMimeType: "application/json",
                responseSchema: analysisSchema
            }
        });
        return JSON.parse(response.text) as AnalysisResult;
    });

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
You are an expert at analyzing and structuring educational content from images. Your task is to perform Optical Character Recognition (OCR) on the following images, which contain a handwritten or printed exam, and then return a structured JSON object.

**Instructions:**
1.  **OCR & Parse Questions**: Carefully read and parse each question from the images. For each question, create a JSON object and add it to the 'extractedQuestions' array.
    -   **DO NOT change the wording** of the questions or options. Your job is to accurately transcribe and structure the existing content.
    -   Infer the 'type' of each question (e.g., 'Multiple Choice', 'Fill in the Blanks').
    -   Extract the 'questionText'.
    -   For 'Multiple Choice', parse the options into a JSON string of an array. **Crucially, extract only the text of the option, removing any existing labels like 'a)', '(b)', '1.', etc.** (e.g., '["Paris", "London"]').
    -   For 'Match the Following', parse the columns into a JSON string of an object with 'columnA' and 'columnB' arrays.
    -   If an 'answer' is provided, extract it. If not, set the 'answer' field to an empty string "".
    -   Infer the 'marks' for each question. If not specified, make a reasonable guess (e.g., 1 for simple questions, 5 for long ones).
    -   Infer the 'difficulty' ('Easy', 'Medium', 'Hard') and 'taxonomy' ('Remembering', 'Understanding', etc.) based on the question's content and complexity.
2.  **Extract Metadata**: Read the transcribed text from all images to identify the following details: 'schoolName', 'className' (or grade), 'subject', 'timeAllowed', and 'totalMarks'.
    -   If a detail is explicitly mentioned, extract its value.
    -   If a detail is NOT mentioned, its value in the 'extractedData' object must be \`null\`.
    -   **DO NOT extract topics.** The questions themselves define the topics.
3.  **Identify Missing Fields**: Create a list of strings called 'missingFields' that contains the keys of any metadata details you could not find (i.e., any key whose value is \`null\` in 'extractedData').

Your entire output must be ONLY the JSON object conforming to the provided schema, without any surrounding text, explanations, or markdown formatting.
`;

    const contents = [{ parts: [...imageParts, { text: analysisPrompt }] }];

    try {
        return await callWithRetry(async () => {
            const response = await ai.models.generateContent({
                model: "gemini-2.0-flash",
                contents,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: analysisSchema
                }
            });
            return JSON.parse(response.text) as AnalysisResult;
        });
    } catch (error) {
        handleApiError(error, "analyzeHandwrittenImages");
        throw error;
    }
};

export const generateChatResponseStream = async (chat: Chat, messageParts: Part[], useSearch?: boolean, useThinking?: boolean): Promise<AsyncGenerator<GenerateContentResponse>> => {
    try {
        // Retry logic for streaming initialization
        return await callWithRetry(async () => {
            if (useSearch || useThinking) {
                const config: any = {};
                if (useSearch) config.tools = [{ googleSearch: {} }];
                if (useThinking) config.thinkingConfig = { thinkingBudget: 8192 };

                return await chat.sendMessageStream({
                    message: messageParts,
                    config: config,
                });
            }
            return await chat.sendMessageStream({ message: messageParts });
        });
    } catch (error) {
        handleApiError(error, "generateChatResponseStream");
        throw error;
    }
};


export const generateTextToSpeech = async (text: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        return await callWithRetry(async () => {
            const response = await ai.models.generateContent({
                model: "gemini-2.0-flash-exp",
                contents: [{ parts: [{ text }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
                },
            });
            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64Audio) throw new Error("TTS generation returned no audio data.");
            return base64Audio;
        });
    } catch (error) {
        handleApiError(error, "generateTextToSpeech");
        throw error;
    }
};

const editTools: FunctionDeclaration[] = [
  { name: 'addQuestion', description: 'Adds a new question to the question paper. Generate all the details for the question before calling this function.', parameters: { type: Type.OBJECT, properties: { type: { type: Type.STRING, enum: Object.values(QuestionType) }, questionText: { type: Type.STRING }, options: { type: Type.STRING, description: "JSON string for options if applicable. E.g., '[\"A\", \"B\", \"C\"]' or '{\"columnA\": [], \"columnB\": []}'." }, answer: { type: Type.STRING, description: "Correct answer. Must be a JSON string for 'Match the Following' type." }, marks: { type: Type.INTEGER }, difficulty: { type: Type.STRING, enum: ['Easy', 'Medium', 'Hard'] }, taxonomy: { type: Type.STRING, enum: ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'] }, }, required: ['type', 'questionText', 'answer', 'marks', 'difficulty', 'taxonomy'] } },
  { name: 'updateQuestion', description: 'Updates one or more parts of an existing question, such as rephrasing its text, changing its marks, or styling it.', parameters: { type: Type.OBJECT, properties: { questionNumber: { type: Type.INTEGER, description: 'The number of the question to update.' }, updates: { type: Type.OBJECT, properties: { questionText: { type: Type.STRING }, options: { type: Type.STRING }, answer: { type: Type.STRING }, marks: { type: Type.INTEGER }, styles: { type: Type.OBJECT, properties: { color: { type: Type.STRING, description: "A hex color code, e.g., '#FF0000'." } } } }, description: 'An object containing the fields of the question to update.' } }, required: ['questionNumber', 'updates'] } },
  { name: 'deleteQuestion', description: 'Deletes an existing question from the paper.', parameters: { type: Type.OBJECT, properties: { questionNumber: { type: Type.INTEGER, description: 'The number of the question to delete.' } }, required: ['questionNumber'] } },
  { name: 'bulkUpdateQuestions', description: 'Updates multiple questions at once based on a set of filters. For example, "Increase marks for all short answer questions by 2."', parameters: { type: Type.OBJECT, properties: { filters: { type: Type.OBJECT, description: 'Criteria to select which questions to update. E.g., `{"type": "Short Answer"}`.', properties: { type: { type: Type.STRING, enum: Object.values(QuestionType) }, difficulty: { type: Type.STRING, enum: ['Easy', 'Medium', 'Hard'] }, taxonomy: { type: Type.STRING, enum: ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'] }, } }, updates: { type: Type.OBJECT, description: 'The changes to apply to the filtered questions. E.g., `{"marks": 5}` or `{"difficulty": "Hard"}`.', properties: { marks: { type: Type.INTEGER }, difficulty: { type: Type.STRING, enum: ['Easy', 'Medium', 'Hard'] }, taxonomy: { type: Type.STRING, enum: ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'] }, } } }, required: ['filters', 'updates'] } },
  { name: 'findAndReplaceText', description: 'Finds and replaces a specific piece of text throughout the document or within a specific question. Use this for general text corrections, rephrasing, or updates that don\'t fit other tools.', parameters: { type: Type.OBJECT, properties: { findText: { type: Type.STRING, description: 'The exact text to find.' }, replaceText: { type: Type.STRING, description: 'The text to replace it with.' }, questionNumber: { type: Type.INTEGER, description: 'Optional. The number of the question to limit the search to.' } }, required: ['findText', 'replaceText'] } },
  { name: 'updatePaperStyles', description: 'Modifies the visual style of the entire question paper.', parameters: { type: Type.OBJECT, properties: { fontFamily: { type: Type.STRING, description: "e.g., 'serif', 'sans-serif', 'monospace', 'Times New Roman'" }, headingColor: { type: Type.STRING, description: "A hex color code, e.g., '#FF0000'." }, borderColor: { type: Type.STRING, description: "A hex color code, e.g., '#0000FF'." }, borderWidth: { type: Type.INTEGER, description: 'Border width in pixels, e.g., 2.' }, borderStyle: { type: Type.STRING, enum: ['solid', 'dashed', 'dotted', 'double'] }, }, description: 'An object containing the style properties to update.' } },
  { name: 'translatePaper', description: 'Translates the entire question paper content to a specified language.', parameters: { type: Type.OBJECT, properties: { targetLanguage: { type: Type.STRING, description: "The language to translate the paper into, e.g., 'French', 'Spanish'." }, }, required: ['targetLanguage'] } },
  { name: 'translateQuestion', description: 'Translates a single, specific question to a target language. Use this for requests about one question, not the whole paper.', parameters: { type: Type.OBJECT, properties: { questionNumber: { type: Type.INTEGER, description: 'The number of the question to translate.' }, targetLanguage: { type: Type.STRING, description: "The language to translate the question into, e.g., 'French', 'Kannada'." }, }, required: ['questionNumber', 'targetLanguage'] } },
  { name: 'addTextBox', description: 'Adds a new, empty text box to the current page for user input.' },
  { name: 'requestImageGeneration', description: 'Opens the image generation tool for the user. Use this when the user asks to create or generate an image. You can suggest a prompt.', parameters: { type: Type.OBJECT, properties: { prompt: { type: Type.STRING, description: 'An optional prompt to pre-fill in the image generation modal.' } } } }
];

export const createEditingChat = (paperData: QuestionPaperData) => {
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const questionsSummary = paperData.questions.map(q => `${q.questionNumber}. ${q.type} - ${q.questionText.substring(0, 50)}...`).join('\n');
    const systemInstruction = `You are a conversational AI co-editor for a question paper application. Your personality is helpful, concise, and precise.
- **Goal**: Your primary goal is to assist the user in editing their document by calling the provided tools.
- **Interaction**: Engage in a conversation. If a user's request is ambiguous, ask clarifying questions. When you have enough information, call the appropriate tool.
- **Tool Usage**:
  - For adding or changing content, you MUST use function calls.
  - **For general text corrections or rephrasing (e.g., "change 'apple' to 'orange'"), use the \`findAndReplaceText\` tool. This is your primary tool for small, specific text edits.**
  - You can now handle granular requests for specific questions.
  - **You can translate a single question using \`translateQuestion\`.**
  - **You can change the color of a specific question's text using the \`styles\` property in the \`updateQuestion\` tool. For example, to make question 3 red, call \`updateQuestion\` with \`questionNumber: 3\` and \`updates: { styles: { color: '#FF0000' } }\`.**
  - Use 'bulkUpdateQuestions' for changes affecting multiple questions.
  - Use 'updatePaperStyles' for visual changes affecting the whole paper. Convert color names to hex codes.
  - Use 'addTextBox' or 'requestImageGeneration' when asked to insert these elements.
- **Confirmation**: After making a function call, the system will apply the edit. You don't need to confirm it was done, just be ready for the next instruction.
- **Current Paper Context**:
  - Subject: ${paperData.subject}
  - Class: ${paperData.className}
  - Total Marks: ${paperData.totalMarks}
  - Questions Summary:
${questionsSummary}`;

    const chat = ai.chats.create({
        model: "gemini-2.0-flash",
        config: {
            systemInstruction,
            tools: [{ functionDeclarations: editTools }]
        }
    });
    return chat;
};

export const getAiEditResponse = async (chat: Chat, instruction: string) => {
    try {
        return await callWithRetry(async () => {
            const response = await chat.sendMessage({ message: instruction });
            if (response.functionCalls && response.functionCalls.length > 0) {
                return { functionCalls: response.functionCalls, text: null };
            }
            return { functionCalls: null, text: response.text };
        });
    } catch (error) {
        handleApiError(error, "getAiEditResponse");
        throw error;
    }
};

export const translatePaperService = async (paperData: QuestionPaperData, targetLanguage: string): Promise<QuestionPaperData> => {
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const textContent = { schoolName: paperData.schoolName, className: paperData.className, subject: paperData.subject, questions: paperData.questions.map(q => ({ questionNumber: q.questionNumber, questionText: q.questionText, options: (typeof q.options === 'object' && q.options !== null) ? JSON.stringify(q.options) : q.options, answer: (typeof q.answer === 'object' && q.answer !== null) ? JSON.stringify(q.answer) : q.answer })) };
    const prompt = `You are a translation expert. Translate the following JSON object's text content into **${targetLanguage}**. - Translate all string values. - For 'options' and 'answer' fields that contain stringified JSON, you must translate the text inside the JSON, but return the entire field as a valid, escaped JSON string. - Maintain the exact JSON structure of the original object. Your entire output must be a single, valid JSON object. **JSON to Translate:** ${JSON.stringify(textContent, null, 2)}`;
    try {
        const response = await callWithRetry(async () => {
            return await ai.models.generateContent({ model: "gemini-2.0-flash", contents: prompt, config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { schoolName: { type: Type.STRING }, className: { type: Type.STRING }, subject: { type: Type.STRING }, questions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { questionNumber: { type: Type.INTEGER }, questionText: { type: Type.STRING }, options: { type: Type.STRING }, answer: { type: Type.STRING } }, required: ['questionNumber', 'questionText', 'answer'] } } }, required: ['schoolName', 'className', 'subject', 'questions'] } } });
        });
        
        const translatedContent = JSON.parse(response.text);
        const processedTranslatedQuestions = translatedContent.questions.map((q: any) => {
            const newQ = {...q};
            try { if (newQ.options && typeof newQ.options === 'string' && (newQ.options.trim().startsWith('{') || newQ.options.trim().startsWith('['))) newQ.options = JSON.parse(newQ.options); } catch (e) { console.warn("Could not parse translated options string:", newQ.options); }
            try { if (newQ.answer && typeof newQ.answer === 'string' && newQ.answer.trim().startsWith('{')) newQ.answer = JSON.parse(newQ.answer); } catch (e) { console.warn("Could not parse translated answer string:", newQ.answer); }
            return newQ;
        });
        const translatedQuestions = paperData.questions.map(originalQ => { const translatedQData = processedTranslatedQuestions.find((tq: any) => tq.questionNumber === originalQ.questionNumber); return translatedQData ? { ...originalQ, ...translatedQData } : originalQ; });
        const translatedPaper = { ...paperData, schoolName: translatedContent.schoolName, className: translatedContent.className, subject: translatedContent.subject, questions: translatedQuestions, schoolLogo: paperData.schoolLogo };
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
    const textContent = {
        questionText: question.questionText,
        options: (typeof question.options === 'object' && question.options !== null) ? JSON.stringify(question.options) : (question.options || ""),
        answer: (typeof question.answer === 'object' && question.answer !== null) ? JSON.stringify(question.answer) : (question.answer || ""),
    };

    const prompt = `You are a translation expert. Translate the following JSON object's text content into **${targetLanguage}**.
    - Translate all string values.
    - For 'options' and 'answer' fields that contain stringified JSON, you must translate the text inside that JSON, but return the entire field as a valid, escaped JSON string.
    - Maintain the exact JSON structure of the original object.
    - Your entire output must be a single, valid JSON object with the keys "questionText", "options", and "answer".
    
    **JSON to Translate:**
    ${JSON.stringify(textContent, null, 2)}`;
    
    const responseSchema = { type: Type.OBJECT, properties: { questionText: { type: Type.STRING }, options: { type: Type.STRING }, answer: { type: Type.STRING }, }, required: ['questionText', 'options', 'answer'] };

    try {
        const response = await callWithRetry(async () => {
            return await ai.models.generateContent({ model: "gemini-2.0-flash", contents: prompt, config: { responseMimeType: "application/json", responseSchema } });
        });
        
        const translatedContent = JSON.parse(response.text);
        
        let parsedOptions: any = translatedContent.options;
        if ((question.type === QuestionType.MultipleChoice || question.type === QuestionType.MatchTheFollowing) && typeof translatedContent.options === 'string') {
            try { parsedOptions = JSON.parse(translatedContent.options); } catch (e) { console.warn("Could not parse translated options string:", translatedContent.options); }
        }

        let parsedAnswer: any = translatedContent.answer;
        if (question.type === QuestionType.MatchTheFollowing && typeof translatedContent.answer === 'string') {
            try { parsedAnswer = JSON.parse(translatedContent.answer); } catch (e) { console.warn("Could not parse translated answer string:", translatedContent.answer); }
        }
        
        return { ...question, questionText: translatedContent.questionText, options: parsedOptions, answer: parsedAnswer, };
    } catch(error) {
        handleApiError(error, "translateQuestionService");
        throw error;
    }
};

export const generateImage = async (prompt: string, aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        return await callWithRetry(async () => {
            const response = await ai.models.generateImages({ model: 'imagen-4.0-generate-001', prompt: prompt, config: { numberOfImages: 1, outputMimeType: 'image/png', aspectRatio: aspectRatio } });
            if (response.generatedImages && response.generatedImages.length > 0) return `data:image/png;base64,${response.generatedImages[0].image.imageBytes}`;
            else throw new Error("Image generation returned no images.");
        });
    } catch(error) { 
        handleApiError(error, "generateImage");
        throw error;
    }
};

export const editImage = async (prompt: string, imageBase64: string, mimeType: string): Promise<string> => {
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        return await callWithRetry(async () => {
            const response = await ai.models.generateContent({ model: 'gemini-2.0-flash', contents: { parts: [ { inlineData: { data: imageBase64.split(',')[1], mimeType: mimeType } }, { text: prompt } ] }, config: { responseModalities: [Modality.IMAGE] } });
            for (const part of response.candidates[0].content.parts) { if (part.inlineData) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`; }
            throw new Error("Image editing returned no image.");
        });
    } catch (error) { 
        handleApiError(error, "editImage");
        throw error;
    }
};
