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

// 一時的（リトライで回復しうる）エラーか判定する。
// 503/UNAVAILABLE/overloaded/high demand・429・500・タイムアウト・接続断など。
const TRANSIENT_PATTERN =
  /\b(429|500|502|503|504)\b|unavailable|overloaded|high demand|rate.?limit|deadline|timeout|timed out|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed/i;

export function isTransientGeminiError(err) {
  if (!err) return false;
  const status = err.status ?? err.statusCode ?? err.code;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  return TRANSIENT_PATTERN.test(`${status ?? ''} ${err.message || String(err)}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function generateAnalysis({ systemPrompt, userPrompt, responseSchema, retries = 2 }) {
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

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
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
    } catch (err) {
      lastErr = err;
      // 一時的エラーだけリトライ（指数バックオフ + ジッター）。それ以外は即座に投げる。
      if (attempt < retries && isTransientGeminiError(err)) {
        const wait = 600 * 2 ** attempt + Math.floor(Math.random() * 300);
        await sleep(wait);
        continue;
      }
      // 呼び出し側（analyzer）が文言を出し分けられるよう一時的フラグを付ける。
      err.transient = isTransientGeminiError(err);
      throw err;
    }
  }
  if (lastErr) {
    lastErr.transient = isTransientGeminiError(lastErr);
    throw lastErr;
  }
  throw new Error('Gemini 応答が得られませんでした。');
}
