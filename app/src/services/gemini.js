import { GoogleGenerativeAI } from '@google/generative-ai';

const DEFAULT_MODEL = 'gemini-2.5-flash';

let cachedClient = null;

function getClient() {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY が設定されていません。.env を作成し API キーを設定してください（.env.example 参照）。'
    );
  }
  cachedClient = new GoogleGenerativeAI(apiKey);
  return cachedClient;
}

export function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function getModelName() {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

export async function generateAnalysis({ systemPrompt, userPrompt, responseSchema }) {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: getModelName(),
    systemInstruction: systemPrompt,
    generationConfig: responseSchema
      ? {
          responseMimeType: 'application/json',
          responseSchema,
          temperature: 0.2,
        }
      : { temperature: 0.3 },
  });

  const result = await model.generateContent(userPrompt);
  const text = result.response.text();
  if (responseSchema) {
    try {
      return { json: JSON.parse(text), text };
    } catch (err) {
      return { json: null, text, parseError: err.message };
    }
  }
  return { text };
}
