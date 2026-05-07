import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listServices, loadMaster as loadServiceMaster } from './services/regulator.js';
import { extractTextFromUpload } from './services/extractor.js';
import { analyzeOffice } from './services/analyzer.js';
import { isConfigured, getModelName } from './services/gemini.js';
import { run as runJudge } from './services/judge.js';
import {
  evaluateRequirementLogic,
  buildFactsFromEvidence,
  mergeDemoTenantFacts,
  buildFactsFromStaffData,
  buildFactsFromUserSummary,
  mergeRequirementFacts,
  buildStaffSummaryDisplay,
  buildUserSummaryDisplay,
  loadEvidenceLabels,
  buildEvidenceChecklist,
} from './services/dsl.js';
import { renderMarkdown } from './services/markdown-report.js';
import { runExtraction } from './services/receipt-pdf.js';
import { generalLimiter, heavyLimiter, rateLimitConfig } from './middleware/rate-limit.js';
import { recaptchaMiddleware, recaptchaConfig } from './middleware/recaptcha.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 20 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 },
});

const app = express();
app.disable('x-powered-by');

// Cloud Run / LB の前段プロキシで X-Forwarded-For を信頼（rate-limit が req.ip を正しく取れるように）
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 静的ファイルはレート制限の対象外
app.use(express.static(path.join(APP_ROOT, 'public'), { maxAge: '5m' }));

// /api/* に一般レート制限を適用
app.use('/api', generalLimiter);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    gemini_configured: isConfigured(),
    model: isConfigured() ? getModelName() : null,
    node_env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    rate_limit: {
      enabled: rateLimitConfig.enabled,
      general_max: rateLimitConfig.general.max,
      general_window_ms: rateLimitConfig.general.window_ms,
      heavy_max: rateLimitConfig.heavy.max,
      heavy_window_ms: rateLimitConfig.heavy.window_ms,
    },
    recaptcha: {
      enabled: recaptchaConfig.enabled,
      site_key: recaptchaConfig.site_key,
      min_score: recaptchaConfig.min_score,
    },
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

const ANALYZE_FIELDS = [
  { name: 'attachments', maxCount: 5 },
  { name: 'pdf', maxCount: 1 },
  { name: 'tenant_status_json', maxCount: 1 },
  { name: 'staff_json', maxCount: 1 },
  { name: 'user_summary_json', maxCount: 1 },
];

const JUDGE_FIELDS = [
  { name: 'pdf', maxCount: 1 },
  { name: 'tenant_status_json', maxCount: 1 },
  { name: 'staff_json', maxCount: 1 },
  { name: 'user_summary_json', maxCount: 1 },
];

// 高コスト API には heavy リミット + reCAPTCHA を追加
app.post(
  '/api/analyze',
  heavyLimiter,
  upload.fields(ANALYZE_FIELDS),
  recaptchaMiddleware('analyze'),
  async (req, res) => {
    try {
      const service = (req.body.service || '').toString().trim();
      if (!service) return res.status(400).json({ error: 'service（サービスキー）は必須です。' });
      const office = (req.body.office_code || '').toString().trim() || null;

      const officeInfo = parseOfficeInfo(req.body);
      const freeText = (req.body.free_text || req.body.concerns || '').toString();

      const files = req.files || {};
      const attachments = await Promise.all((files.attachments || []).map((f) => extractTextFromUpload(f)));
      const useGemini = String(req.body.use_gemini ?? '1').toLowerCase() !== '0' && isConfigured();

      const result = await analyzeOffice({
        service,
        office,
        officeInfo,
        freeText,
        attachments,
        pdfFile: files.pdf?.[0] || null,
        tenantStatusFile: files.tenant_status_json?.[0] || null,
        staffFile: files.staff_json?.[0] || null,
        userSummaryFile: files.user_summary_json?.[0] || null,
        useGemini,
      });
      res.json(result);
    } catch (err) {
      console.error('[analyze] error:', err);
      res.status(500).json({ error: err.message || '分析中に予期しないエラーが発生しました。' });
    }
  },
);

function parseJsonFile(file) {
  if (!file) return null;
  return JSON.parse(file.buffer.toString('utf-8'));
}

async function applyInlineFiles(judgeResult, service, files) {
  const tenantInline = parseJsonFile(files.tenant_status_json?.[0]);
  const staffInline = parseJsonFile(files.staff_json?.[0]);
  const userInline = parseJsonFile(files.user_summary_json?.[0]);
  if (!tenantInline && !staffInline && !userInline) return judgeResult;

  let facts = buildFactsFromEvidence(judgeResult.evidence, judgeResult.tenant_status);
  if (tenantInline) facts = mergeDemoTenantFacts(facts, tenantInline);
  const staffFacts = staffInline ? buildFactsFromStaffData(staffInline, service) : {};
  const userFacts = userInline ? buildFactsFromUserSummary(userInline, service) : {};
  facts = mergeRequirementFacts(facts, staffFacts, userFacts);

  const master = await loadServiceMaster(service);
  const kasans = master.master?.kasans || {};
  const dslResults = {};
  for (const [kasanKey, kasanDef] of Object.entries(kasans)) {
    let itemMeta;
    if (kasanDef.applicability === 'not_applicable') {
      itemMeta = {
        source_status: kasanDef.source_status,
        applicability: 'not_applicable',
        applicability_reason: kasanDef.applicability_reason,
      };
    } else {
      itemMeta = { source_status: kasanDef.source_status || 'checked' };
    }
    dslResults[kasanKey] = evaluateRequirementLogic(kasanDef.requirement_logic, facts, itemMeta);
  }
  judgeResult.dsl_results = dslResults;
  judgeResult.staff_summary_display = buildStaffSummaryDisplay(staffFacts, service);
  judgeResult.user_summary_display = buildUserSummaryDisplay(userFacts, service);
  judgeResult.staff_data_loaded = Boolean(staffInline);
  judgeResult.user_summary_loaded = Boolean(userInline);
  judgeResult.demo_tenant_status_loaded = Boolean(tenantInline);

  const labelConfig = await loadEvidenceLabels();
  judgeResult.evidence_checklist = buildEvidenceChecklist(dslResults, judgeResult.judgements, labelConfig);
  return judgeResult;
}

// 決定的判定（Gemini 不要だが、判定エンジンも CPU・メモリを使うため heavy リミットを共有）
app.post(
  '/api/judge',
  heavyLimiter,
  upload.fields(JUDGE_FIELDS),
  recaptchaMiddleware('judge'),
  async (req, res) => {
    try {
      const service = (req.body.service || '').toString().trim();
      if (!service) return res.status(400).json({ error: 'service（サービスキー）は必須です。' });
      const office = (req.body.office_code || '').toString().trim() || null;

      const files = req.files || {};
      let inlineEvidence = null;
      if (files.pdf?.[0]) {
        const pdfFile = files.pdf[0];
        const r = await runExtraction({
          office: office || 'unknown',
          service,
          pdfBuffer: pdfFile.buffer,
          sourceName: pdfFile.originalname,
        });
        inlineEvidence = r.evidence;
      }

      let judgeResult = await runJudge({
        service,
        office,
        applyEvidence: Boolean(inlineEvidence),
        inlineEvidence,
      });
      judgeResult = await applyInlineFiles(judgeResult, service, files);
      const markdown = renderMarkdown(judgeResult);
      res.json({ judge: judgeResult, markdown });
    } catch (err) {
      console.error('[judge] error:', err);
      res.status(500).json({ error: err.message || '判定中に予期しないエラーが発生しました。' });
    }
  },
);

// レセプトPDF -> evidence JSON（保存はしない、結果を返すだけ）
app.post(
  '/api/import-receipt',
  heavyLimiter,
  upload.single('pdf'),
  recaptchaMiddleware('import_receipt'),
  async (req, res) => {
    try {
      const service = (req.body.service || '').toString().trim();
      const office = (req.body.office_code || 'unknown').toString().trim();
      if (!service) return res.status(400).json({ error: 'service は必須です。' });
      if (!req.file) return res.status(400).json({ error: 'pdf ファイルが必要です。' });
      const r = await runExtraction({
        office,
        service,
        pdfBuffer: req.file.buffer,
        sourceName: req.file.originalname,
      });
      res.json({ evidence: r.evidence });
    } catch (err) {
      console.error('[import-receipt] error:', err);
      res.status(500).json({ error: err.message });
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
    'office_name', 'office_code', 'region',
    'staff_summary', 'user_summary', 'current_kasans', 'concerns',
  ];
  const out = {};
  for (const k of FIELDS) {
    const v = body[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = String(v);
  }
  return out;
}

app.listen(PORT, HOST, () => {
  console.log(`[kasan-manager] listening on ${HOST}:${PORT} (env=${process.env.NODE_ENV || 'development'})`);
  console.log(`[kasan-manager] gemini_configured=${isConfigured()} model=${isConfigured() ? getModelName() : '-'}`);
  console.log(`[kasan-manager] rate_limit_enabled=${rateLimitConfig.enabled} (general=${rateLimitConfig.general.max}/${rateLimitConfig.general.window_ms}ms, heavy=${rateLimitConfig.heavy.max}/${rateLimitConfig.heavy.window_ms}ms)`);
  console.log(`[kasan-manager] recaptcha_enabled=${recaptchaConfig.enabled} (min_score=${recaptchaConfig.min_score})`);
});
