import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listServices } from './services/regulator.js';
import { extractTextFromUpload } from './services/extractor.js';
import { analyzeOffice } from './services/analyzer.js';
import { isConfigured, getModelName } from './services/gemini.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT) || 8080;
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 20 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 5,
  },
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(express.static(path.join(APP_ROOT, 'public'), { maxAge: '5m' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    gemini_configured: isConfigured(),
    model: isConfigured() ? getModelName() : null,
    node_env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/services', async (_req, res) => {
  try {
    const services = await listServices();
    res.json({ services });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(
  '/api/analyze',
  upload.array('attachments', 5),
  async (req, res) => {
    try {
      if (!isConfigured()) {
        return res.status(503).json({
          error:
            'Gemini API キーが未設定です。.env に GEMINI_API_KEY を設定してから再起動してください。',
        });
      }

      const service = (req.body.service || '').toString().trim();
      if (!service) {
        return res.status(400).json({ error: 'service（サービスキー）は必須です。' });
      }

      const officeInfo = parseOfficeInfo(req.body);
      const freeText = (req.body.free_text || '').toString();

      const files = Array.isArray(req.files) ? req.files : [];
      const attachments = await Promise.all(files.map((f) => extractTextFromUpload(f)));

      const result = await analyzeOffice({
        service,
        officeInfo,
        freeText,
        attachments,
      });
      res.json(result);
    } catch (err) {
      console.error('[analyze] error:', err);
      res.status(500).json({
        error: err.message || '分析中に予期しないエラーが発生しました。',
      });
    }
  },
);

app.use((err, _req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `アップロードサイズが上限（${MAX_UPLOAD_BYTES} バイト）を超えています。`,
    });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: err?.message || 'サーバ内部エラー' });
});

function parseOfficeInfo(body) {
  const FIELDS = [
    'office_name',
    'office_code',
    'region',
    'staff_summary',
    'user_summary',
    'current_kasans',
    'concerns',
  ];
  const result = {};
  for (const key of FIELDS) {
    const v = body[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      result[key] = String(v);
    }
  }
  return result;
}

app.listen(PORT, () => {
  console.log(`[kasan-manager] listening on :${PORT} (env=${process.env.NODE_ENV || 'development'})`);
  console.log(`[kasan-manager] gemini_configured=${isConfigured()} model=${isConfigured() ? getModelName() : '-'}`);
});
