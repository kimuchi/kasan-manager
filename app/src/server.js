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
import {
  csrfIssueMiddleware,
  csrfVerifyMiddleware,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from './middleware/csrf.js';
import {
  CposClient,
  defaultBaseUrl,
  isAllowedBaseUrl,
  normalizeBaseUrl,
} from './services/cpos/client.js';
import { validateAnalysisSource } from './services/cpos/schemas.js';
import { CposApiError, CposNotConfiguredError } from './services/cpos/errors.js';
import { toEngineInputs as toCposEngineInputs } from './services/cpos/transform.js';
import {
  readCposSession,
  buildSessionPayload,
  setCposSessionCookie,
  clearCposSessionCookie,
  toPublicSessionView,
} from './services/cpos/auth.js';
import { isSessionSecretConfigured, redactSecret } from './utils/cookie-seal.js';
import { docsRouter, isDocsAvailable } from './routes/docs.js';

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

// Cloud Run / LB の前段プロキシで X-Forwarded-For を信頼
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 静的ファイル（CSS/JS/画像）
app.use(express.static(path.join(APP_ROOT, 'public'), { maxAge: '5m' }));

// /schemas/*.json を読み取り専用で配信（ドキュメントから参照可能にする）
const PROJECT_ROOT_FOR_SCHEMA = path.resolve(APP_ROOT, '..');
app.use(
  '/schemas',
  express.static(path.join(PROJECT_ROOT_FOR_SCHEMA, 'schemas'), {
    maxAge: '5m',
    extensions: ['json'],
  }),
);

// /docs/* で Markdown ドキュメントを HTML 配信
app.use('/docs', docsRouter);

// CSRF: GET 時に kasan_csrf cookie を発行（HTML / JSON 共通でセット）
app.use(csrfIssueMiddleware);

// /api/* に一般レート制限を適用
app.use('/api', generalLimiter);

// /api/* の変更系には CSRF 検証を適用
app.use('/api', csrfVerifyMiddleware);

// ============================================================
// ヘルス・ステータス
// ============================================================
app.get('/api/health', (req, res) => {
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
    cpos: {
      // panel_visible: 連携機能の存在をユーザに知らせるため、常に true。実際にログインできるかは ready で判断
      panel_visible: true,
      // ready: PAT 入力 → 接続まで完了できるサーバ設定が整っているか
      ready: isSessionSecretConfigured(),
      session_secret_configured: isSessionSecretConfigured(),
      default_base_url: defaultBaseUrl(),
      not_ready_message: isSessionSecretConfigured()
        ? null
        : 'CPOS 連携にはサーバ管理者が KASAN_SESSION_SECRET を設定する必要があります。',
    },
    csrf: {
      cookie_name: CSRF_COOKIE_NAME,
      header_name: CSRF_HEADER_NAME,
      token: req.csrfToken, // フロントが localStorage 不使用で読める。SameSite で守られる
    },
    docs: { available: isDocsAvailable() },
  });
});

// ============================================================
// CPOS PAT セッション管理（指示書 §4.1〜4.4）
// ============================================================

function handleCposError(err, res) {
  if (err instanceof CposApiError) {
    return res.status(err.statusCode || 500).json({
      ok: false,
      error: 'cpos_api_error',
      status_code: err.statusCode,
      message: err.message,
      hint: err.hint,
    });
  }
  if (err instanceof CposNotConfiguredError) {
    return res.status(503).json({ ok: false, error: 'cpos_not_configured', message: err.message });
  }
  console.error('[cpos] unexpected:', err?.message || err);
  return res.status(500).json({ ok: false, error: 'cpos_unexpected_error', message: err?.message || String(err) });
}

function logRedacted(prefix, info) {
  const safe = { ...info };
  if (safe.token) safe.token = redactSecret(safe.token);
  if (safe.cookie) safe.cookie = '[redacted]';
  console.log(`[cpos] ${prefix}`, safe);
}

// PAT を受け取って検証 → sealed cookie を発行
app.post('/api/cpos-token', async (req, res) => {
  if (!isSessionSecretConfigured()) {
    return res.status(503).json({
      ok: false,
      error: 'session_not_configured',
      message: 'KASAN_SESSION_SECRET が未設定です。サーバ管理者に連絡してください。',
    });
  }
  const cposBaseUrl = normalizeBaseUrl(req.body?.cposBaseUrl || defaultBaseUrl());
  const token = (req.body?.token || '').toString().trim();
  if (!cposBaseUrl) {
    return res.status(400).json({ ok: false, error: 'bad_request', message: 'CPOS URL が指定されていません' });
  }
  if (!isAllowedBaseUrl(cposBaseUrl)) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_base_url',
      message: 'CPOS URL が許可されていません（本番では https のみ）。',
    });
  }
  if (!token) {
    return res.status(400).json({ ok: false, error: 'bad_request', message: 'CPOS PAT が指定されていません' });
  }
  if (!/^cpos_pat_/.test(token) || token.length < 20) {
    return res.status(400).json({
      ok: false,
      error: 'bad_token_format',
      message: 'CPOS PAT の形式が不正です（cpos_pat_ で始まる必要があります）。',
    });
  }

  try {
    const client = new CposClient({ baseUrl: cposBaseUrl, token });
    const me = await client.getMe();
    const authMethod = me?.token?.authMethod || me?.authMethod;
    const allowAppToken = process.env.KASAN_ALLOW_APP_TOKEN === 'true';
    if (!allowAppToken && authMethod !== 'personal_access_token') {
      return res.status(400).json({
        ok: false,
        error: 'not_pat',
        message: `このトークンは PAT ではありません（authMethod=${authMethod}）。CPOS で発行した cpos_pat_ を使ってください。`,
      });
    }
    const expiresAt = me?.token?.expiresAt || me?.expiresAt || null;
    const payload = buildSessionPayload({
      cposBaseUrl,
      token,
      me,
      expiresAtFromCpos: expiresAt,
    });
    setCposSessionCookie(res, payload);
    logRedacted('token verified', {
      cposBaseUrl,
      subject: payload.subjectUserEmail,
      tokenPreview: payload.tokenPreview,
    });
    res.json({ ok: true, ...toPublicSessionView(payload) });
  } catch (err) {
    logRedacted('token verify failed', { cposBaseUrl, token, message: err?.message });
    handleCposError(err, res);
  }
});

app.get('/api/cpos-token/status', (req, res) => {
  const session = readCposSession(req);
  if (!session) {
    return res.json({ connected: false });
  }
  res.json(toPublicSessionView(session));
});

app.delete('/api/cpos-token', (_req, res) => {
  clearCposSessionCookie(res);
  res.json({ ok: true, connected: false });
});

app.post('/api/cpos-token/test', async (req, res) => {
  const session = readCposSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'not_connected' });
  try {
    const client = new CposClient({ baseUrl: session.cposBaseUrl, token: session.token });
    const me = await client.getMe();
    let facilityCount = 0;
    try {
      const facilities = await client.getPlatformFacilities();
      facilityCount = Array.isArray(facilities?.facilities)
        ? facilities.facilities.length
        : Array.isArray(facilities)
        ? facilities.length
        : 0;
    } catch (err) {
      // facilities が取れないだけでは fail しない
      logRedacted('facilities probe failed', { cposBaseUrl: session.cposBaseUrl, message: err?.message });
    }
    res.json({
      ok: true,
      me: { id: me?.user?.id || me?.id, email: me?.user?.email || me?.email },
      facilityCount,
    });
  } catch (err) {
    handleCposError(err, res);
  }
});

// ============================================================
// CPOS データ proxy（cookie PAT 利用・自分の権限範囲内）
// ============================================================
function requireCposSession(req, res) {
  const session = readCposSession(req);
  if (!session) {
    res.status(401).json({ ok: false, error: 'not_connected', message: 'CPOS に接続してください（PAT を入力）' });
    return null;
  }
  return session;
}

function checkFacilityAllowed(session, facilityId) {
  if (!facilityId) return true;
  const allow = session.allowedFacilityIds;
  if (!allow || !Array.isArray(allow) || allow.length === 0) return true; // 制限なし
  return allow.includes(facilityId);
}

app.get('/api/cpos/facilities', async (req, res) => {
  const session = requireCposSession(req, res);
  if (!session) return;
  try {
    const client = new CposClient({ baseUrl: session.cposBaseUrl, token: session.token });
    let facilities = [];
    try {
      const r = await client.getPlatformFacilities();
      facilities = Array.isArray(r?.facilities) ? r.facilities : Array.isArray(r) ? r : [];
    } catch (err) {
      // /api/platform/facilities が無ければ /api/kasan/v1/bootstrap で代替
      const b = await client.getBootstrap();
      facilities = b?.facilities || [];
    }
    res.json({ facilities });
  } catch (err) {
    handleCposError(err, res);
  }
});

// 加算分析: CPOS から bundle を取り、既存判定エンジンで判定 → Markdown を返す（指示書 §4.6 / §4.7）
app.post('/api/analyze/from-cpos', heavyLimiter, recaptchaMiddleware('cpos_analyze'), async (req, res) => {
  const session = requireCposSession(req, res);
  if (!session) return;
  const facilityId = String(req.body?.facilityId || '').trim();
  const serviceMonth = String(req.body?.serviceMonth || '').trim();
  const serviceKey = req.body?.serviceKey ? String(req.body.serviceKey) : null;
  if (!facilityId || !serviceMonth) {
    return res.status(400).json({ ok: false, error: 'bad_request', message: 'facilityId と serviceMonth は必須です' });
  }
  if (!checkFacilityAllowed(session, facilityId)) {
    return res.status(403).json({ ok: false, error: 'forbidden_facility', message: 'この事業所への権限がありません' });
  }
  try {
    const client = new CposClient({ baseUrl: session.cposBaseUrl, token: session.token });
    // CPOS が新エンドポイント /api/platform/kasan/export を持つ場合は優先、無ければ /api/kasan/v1/analysis-source
    let source;
    try {
      source = await client.getKasanExport({ facilityId, serviceMonth, serviceKey });
    } catch (err) {
      if (err?.statusCode === 404) {
        source = await client.getAnalysisSource({ facilityId, serviceMonth, includePii: false });
      } else {
        throw err;
      }
    }
    const validated = source.schemaVersion ? validateAnalysisSource(source) : source;
    const inputs = await toCposEngineInputs(validated);
    const judgeResult = await runJudge({
      service: serviceKey || inputs.service_key,
      office: inputs.facility?.id || facilityId,
      applyEvidence: true,
      inlineEvidence: inputs.claim_evidence,
    });
    const inlineFiles = {
      tenant_status_json: [{ buffer: Buffer.from(JSON.stringify(inputs.tenant_status), 'utf-8') }],
      staff_json: [{ buffer: Buffer.from(JSON.stringify(inputs.staff_data), 'utf-8') }],
      user_summary_json: [{ buffer: Buffer.from(JSON.stringify(inputs.user_summary), 'utf-8') }],
    };
    const enriched = await applyInlineFiles(judgeResult, serviceKey || inputs.service_key, inlineFiles);
    enriched.cpos_metadata = {
      ...inputs.metadata,
      serviceMonth,
      subjectUserEmail: session.subjectUserEmail,
    };
    res.json({
      ok: true,
      reportMarkdown: renderMarkdown(enriched),
      resultJson: enriched,
      cpos: { facilityId, serviceMonth, schemaVersion: validated.schemaVersion || null },
    });
  } catch (err) {
    handleCposError(err, res);
  }
});

// ============================================================
// 既存（手動入力 / PDF）— 互換維持
// ============================================================
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
    'office_name',
    'office_code',
    'region',
    'staff_summary',
    'user_summary',
    'current_kasans',
    'concerns',
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
  console.log(
    `[kasan-manager] rate_limit_enabled=${rateLimitConfig.enabled} (general=${rateLimitConfig.general.max}/${rateLimitConfig.general.window_ms}ms, heavy=${rateLimitConfig.heavy.max}/${rateLimitConfig.heavy.window_ms}ms)`,
  );
  console.log(`[kasan-manager] recaptcha_enabled=${recaptchaConfig.enabled} (min_score=${recaptchaConfig.min_score})`);
  console.log(
    `[kasan-manager] cpos_session_secret_configured=${isSessionSecretConfigured()} default_cpos_url=${defaultBaseUrl() || '-'}`,
  );
  console.log(`[kasan-manager] docs_available=${isDocsAvailable()}`);
});
