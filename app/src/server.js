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
import { validateAnalysisSource, deriveCompletenessWarnings } from './services/cpos/schemas.js';
import { CposApiError, CposNotConfiguredError } from './services/cpos/errors.js';
import {
  toEngineInputs as toCposEngineInputs,
  normalizeCposAnalysisPayload,
} from './services/cpos/transform.js';
import {
  readCposSession,
  readCposSessionDetailed,
  buildSessionPayload,
  setCposSessionCookie,
  clearCposSessionCookie,
  toPublicSessionView,
} from './services/cpos/auth.js';
import { isSessionSecretConfigured, redactSecret } from './utils/cookie-seal.js';
import { buildAnalysisEnvelope } from './utils/analysis-envelope.js';
import { docsRouter, isDocsAvailable } from './routes/docs.js';
import { hydrateSecretsFromManager } from './services/secrets.js';
import { initFirebase, isFirebaseInitialized } from './services/firebase-admin.js';
import { authMiddleware, requireAuth, requirePaid, requireAdmin } from './middleware/auth.js';
import { getUserFullView } from './services/users.js';
import {
  issueAccessCode,
  listAccessCodes,
  revokeAccessCode,
  redeemAccessCode,
} from './services/access-codes.js';
import {
  persistAnalysisIfPaid,
  listAnalysisJobsForUser,
  getAnalysisJob,
  loadAnalysisArtifact,
  recordReviewDecision,
  listReviewDecisions,
} from './services/persistence.js';
import { optimizePortfolio } from './services/portfolio.js';

// 起動前に Secret Manager から hydrate（失敗しても env だけで動く）
await hydrateSecretsFromManager().catch((err) => {
  console.warn(`[startup] Secret Manager hydration skipped: ${err?.message || err}`);
});
// Firebase Admin（Firestore / Auth / Storage）を初期化（失敗しても無料モードのみで動く）
initFirebase();

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

// /api/* で Firebase ID トークンがあれば検証し req.user を populate
app.use('/api', authMiddleware);

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
    auth: {
      // クライアントが Firebase ログイン UI を出すための条件:
      // - サーバ側で Firebase Admin SDK が初期化されている（ID トークン検証可能）
      // - かつ Firebase Web SDK の public config が env に設定されている
      firebase_enabled: isFirebaseInitialized() && Boolean(buildFirebaseWebConfig()),
      web_config: buildFirebaseWebConfig(),
    },
  });
});

function buildFirebaseWebConfig() {
  // これらはすべて public な値（Firebase の API key は同一プロジェクト内の認証用で機密ではない）
  const cfg = {
    apiKey: process.env.FIREBASE_WEB_API_KEY || null,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || null,
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCP_PROJECT_ID || null,
    appId: process.env.FIREBASE_APP_ID || null,
  };
  if (!cfg.apiKey || !cfg.authDomain || !cfg.projectId) return null;
  return cfg;
}

// ============================================================
// 認証・プラン・アクセスコード API
// ============================================================
app.get('/api/me', (req, res) => {
  if (!req.user?.uid) return res.json({ authenticated: false });
  res.json({
    authenticated: true,
    uid: req.user.uid,
    email: req.user.email,
    displayName: req.user.displayName,
    planTier: req.user.planTier,
    planExpiresAt: req.user.planExpiresAt,
    isAdmin: req.user.isAdmin,
  });
});

app.get('/api/me/full', requireAuth, async (req, res) => {
  try {
    const view = await getUserFullView(req.user.uid);
    res.json({ ok: true, user: view });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/access-codes/redeem', heavyLimiter, requireAuth, async (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!code) return res.status(400).json({ ok: false, error: 'empty_code', message: 'アクセスコードを入力してください' });
  try {
    const r = await redeemAccessCode(code, { uid: req.user.uid, email: req.user.email });
    res.json({ ok: true, ...r });
  } catch (err) {
    const map = {
      code_not_found: { status: 404, message: 'コードが見つかりません' },
      code_revoked: { status: 410, message: 'このコードは失効しています' },
      code_already_redeemed: { status: 409, message: 'このコードは使用済みです' },
      empty_code: { status: 400, message: 'コードが空です' },
      firestore_unavailable: { status: 503, message: 'バックエンドが利用できません' },
    };
    const m = map[err.message] || { status: 500, message: err.message };
    res.status(m.status).json({ ok: false, error: err.message, message: m.message });
  }
});

app.post('/api/admin/access-codes', heavyLimiter, requireAdmin, async (req, res) => {
  const durationDays = Number(req.body?.durationDays);
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
  try {
    const doc = await issueAccessCode({
      durationDays,
      note,
      issuedBy: req.user.uid,
      issuedByEmail: req.user.email,
    });
    res.json({ ok: true, code: doc });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/admin/access-codes', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 100));
    const codes = await listAccessCodes({ limit });
    res.json({ ok: true, codes });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/admin/access-codes/:code', requireAdmin, async (req, res) => {
  try {
    const doc = await revokeAccessCode(req.params.code, { revokedBy: req.user.uid });
    res.json({ ok: true, code: doc });
  } catch (err) {
    const map = {
      code_not_found: 404,
      already_redeemed: 409,
    };
    res.status(map[err.message] || 500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// 分析履歴・レビュー（有料プラン専用）
// ============================================================
app.get('/api/analyses', requirePaid, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 50));
    const jobs = await listAnalysisJobsForUser(req.user.uid, { limit });
    res.json({ ok: true, jobs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/analyses/:id', requirePaid, async (req, res) => {
  try {
    const job = await getAnalysisJob({
      analysisId: req.params.id,
      uid: req.user.uid,
      isAdmin: req.user.isAdmin,
    });
    if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
    const result = await loadAnalysisArtifact({ analysisId: req.params.id, uid: job.uid, kind: 'result' });
    const report = await loadAnalysisArtifact({ analysisId: req.params.id, uid: job.uid, kind: 'report' });
    const decisions = await listReviewDecisions({ analysisId: req.params.id });
    res.json({
      ok: true,
      job,
      result: result ? JSON.parse(result) : null,
      report,
      review_decisions: decisions,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/analyses/:id/review', heavyLimiter, requirePaid, async (req, res) => {
  try {
    const job = await getAnalysisJob({
      analysisId: req.params.id,
      uid: req.user.uid,
      isAdmin: req.user.isAdmin,
    });
    if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
    const decision = String(req.body?.decision || '');
    const kasanKey = req.body?.kasan_key ? String(req.body.kasan_key) : null;
    const comment = req.body?.comment ? String(req.body.comment).slice(0, 2000) : null;
    const r = await recordReviewDecision({
      analysisId: req.params.id,
      kasanKey,
      decision,
      comment,
      reviewerUid: req.user.uid,
      reviewerEmail: req.user.email,
    });
    res.json(r);
  } catch (err) {
    const map = { invalid_decision: 400, firestore_unavailable: 503 };
    res.status(map[err.message] || 500).json({ ok: false, error: err.message });
  }
});

// 加算別レビュー履歴。kasan_key を渡せばその加算の決定一覧、未指定なら解析全体。
app.get('/api/analyses/:id/decisions', requirePaid, async (req, res) => {
  try {
    const job = await getAnalysisJob({
      analysisId: req.params.id,
      uid: req.user.uid,
      isAdmin: req.user.isAdmin,
    });
    if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
    const kasanKey = req.query?.kasan_key ? String(req.query.kasan_key) : null;
    const decisions = await listReviewDecisions({ analysisId: req.params.id, kasanKey });
    res.json({ ok: true, decisions, per_kasan_status: job.per_kasan_status || {} });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// ポートフォリオ最適化 PoC
// ============================================================
// 有料ユーザー専用: 保存済 analysis から「あと一歩で取れる加算」を ROI で並べる
app.get('/api/analyses/:id/portfolio', requirePaid, async (req, res) => {
  try {
    const job = await getAnalysisJob({
      analysisId: req.params.id,
      uid: req.user.uid,
      isAdmin: req.user.isAdmin,
    });
    if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
    const resultText = await loadAnalysisArtifact({
      analysisId: req.params.id,
      uid: job.uid,
      kind: 'result',
    });
    if (!resultText) return res.status(404).json({ ok: false, error: 'result_not_persisted' });
    const result = JSON.parse(resultText);
    const portfolio = optimizePortfolio({ judgeResult: result });
    res.json({ ok: true, portfolio });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 無料ユーザーでも分析の生 JSON を渡せば最適化候補を返す（保存はしない）
app.post('/api/portfolio/optimize', heavyLimiter, async (req, res) => {
  try {
    const judgeResult = req.body?.judge || req.body?.result_json || req.body;
    if (!judgeResult || typeof judgeResult !== 'object' || !judgeResult.judgements) {
      return res.status(400).json({ ok: false, error: 'bad_request', message: 'judge 結果（judgements を含む JSON）が必要です' });
    }
    const portfolio = optimizePortfolio({ judgeResult });
    res.json({ ok: true, portfolio });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
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
      // 診断情報: ユーザに「CPOS が何を返したか」を見せて切り分けを助ける
      // 機微情報（リクエストヘッダの Authorization 等）は含めない
      diagnostics: {
        request_url: err.requestUrl,
        request_path: err.requestPath,
        response_body: err.responseJson || err.responseBodyText || null,
        response_headers: err.responseHeaders || null,
      },
    });
  }
  if (err instanceof CposNotConfiguredError) {
    return res.status(503).json({ ok: false, error: 'cpos_not_configured', message: err.message });
  }
  console.error('[cpos] unexpected:', err?.message || err);
  return res.status(500).json({ ok: false, error: 'cpos_unexpected_error', message: err?.message || String(err) });
}

// CPOS upstream のエラーを「加算マネージャ自身の認証エラー」と区別して返す。
// upstream の 401/403 はクライアントから見ると本アプリのセッション切れに見えてしまうため
// 502 (Bad Gateway) でラップし、`upstream_status_code` を別フィールドで保持する。
function handleCposUpstreamError(err, res) {
  if (err instanceof CposApiError) {
    const upstreamStatus = err.statusCode || 500;
    const wrappedStatus = upstreamStatus === 401 || upstreamStatus === 403 ? 502 : upstreamStatus;
    return res.status(wrappedStatus).json({
      ok: false,
      error: 'cpos_upstream_error',
      upstream_status_code: upstreamStatus,
      message: err.message,
      hint: err.hint,
      diagnostics: {
        request_url: err.requestUrl,
        request_path: err.requestPath,
        response_body: err.responseJson || err.responseBodyText || null,
        response_headers: err.responseHeaders || null,
      },
    });
  }
  if (err instanceof CposNotConfiguredError) {
    return res.status(503).json({ ok: false, error: 'cpos_not_configured', message: err.message });
  }
  console.error('[cpos] unexpected upstream:', err?.message || err);
  return res
    .status(500)
    .json({ ok: false, error: 'cpos_unexpected_error', message: err?.message || String(err) });
}

// normalizeCposAnalysisPayload は services/cpos/transform.js から import 済み

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
  const { session, reason, detail } = readCposSessionDetailed(req);
  if (!session) {
    console.warn('[cpos] local sealed cookie not available', {
      reason,
      hasCookieHeader: Boolean(req.headers.cookie),
      cookieHeaderLength: req.headers.cookie?.length ?? 0,
      detail: detail ? { reason: detail.reason, expiredAt: detail.expiredAt } : null,
    });
    res.status(401).json({
      ok: false,
      error: 'not_connected',
      reason,
      message:
        reason === 'expired'
          ? 'CPOS 接続セッションの有効期限が切れました。PAT を再入力してください。'
          : reason === 'decrypt_or_auth_tag_failed'
          ? 'CPOS 接続情報を復号できませんでした。サーバ側の暗号鍵が変わった可能性があります。再接続してください。'
          : 'CPOS 接続情報が見つかりません。PAT を再入力してください。',
    });
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
async function handleCposAnalyze(req, res) {
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

  // 切り分け用ログ（PAT 平文は出さず tokenPreview のみ）
  logRedacted('analyze from cpos start', {
    cposBaseUrl: session.cposBaseUrl,
    subjectUserEmail: session.subjectUserEmail,
    tokenPreview: session.tokenPreview,
    hasToken: Boolean(session.token),
    facilityId,
    serviceMonth,
    serviceKey,
  });

  try {
    const client = new CposClient({ baseUrl: session.cposBaseUrl, token: session.token });
    // 第一候補: /api/kasan/v1/analysis-source（schemaVersion=1.0、scope は kasan:read 系で広く通る）
    // 第二候補: /api/platform/kasan/export（formatVersion=1、kasan-export:read 必須・PATの scope 構成によっては 401/403）
    // 旧仕様への後方互換のため、analysis-source が 404 のときだけ kasan/export に fallback する。
    let source;
    let sourceEndpoint = null;
    let sourceTypeForEnvelope = 'cpos_analysis_source';
    try {
      sourceEndpoint = '/api/kasan/v1/analysis-source';
      source = await client.getAnalysisSource({ facilityId, serviceMonth, includePii: false });
    } catch (err) {
      if (err?.statusCode === 404) {
        console.warn('[cpos] analysis-source not found; fallback to platform/kasan/export', {
          facilityId,
          serviceMonth,
          tokenPreview: session.tokenPreview,
        });
        sourceEndpoint = '/api/platform/kasan/export';
        source = await client.getKasanExport({ facilityId, serviceMonth, serviceKey });
        sourceTypeForEnvelope = 'cpos_kasan_export';
      } else {
        throw err;
      }
    }
    console.log('[cpos] analysis source loaded', {
      sourceEndpoint,
      facilityId,
      serviceMonth,
      tokenPreview: session.tokenPreview,
      schemaVersion: source?.schemaVersion ?? null,
      formatVersion: source?.formatVersion ?? null,
    });
    const normalized = normalizeCposAnalysisPayload(source);
    const validated = normalized.schemaVersion ? validateAnalysisSource(normalized) : normalized;
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
    // dataCompleteness=missing/partial 由来の警告を mapping_warnings に集約
    const completenessWarnings = deriveCompletenessWarnings(validated);
    // unmapped_cpos_addons を mapping_warnings に集約
    const unmappedWarnings = [];
    for (const ev of enriched.evidence?.evidence || enriched.cpos_metadata?.evidence || []) {
      const um = ev.unmapped_cpos_addons || [];
      for (const k of um) unmappedWarnings.push(`CPOS addOnKey 未マッピング: ${k}`);
    }
    const envelope = buildAnalysisEnvelope({
      sourceType: sourceTypeForEnvelope,
      cposMetadata: inputs.metadata,
      extraWarnings: [...completenessWarnings, ...unmappedWarnings],
    });
    enriched.analysis_id = envelope.analysis_id;
    enriched.source_type = envelope.source_type;
    enriched.review_status = envelope.review_status;
    enriched.mapping_warnings = envelope.mapping_warnings;
    const reportMarkdown = renderMarkdown(enriched);
    // 有料ユーザーなら Firestore + GCS に保存（失敗してもレスポンスは止めない）
    const persistInfo = await persistAnalysisIfPaid({
      req,
      analysisId: envelope.analysis_id,
      judgeResult: enriched,
      markdown: reportMarkdown,
      sourceType: envelope.source_type,
      extra: { facility_id: facilityId, service_month: serviceMonth },
    }).catch((err) => ({ persisted: false, reason: err.message }));
    res.json({
      ok: true,
      ...envelope,
      persisted: persistInfo.persisted,
      reportMarkdown,
      resultJson: enriched,
      cpos: { facilityId, serviceMonth, schemaVersion: validated.schemaVersion || null, sourceEndpoint },
    });
  } catch (err) {
    if (err instanceof CposApiError) {
      console.warn('[cpos] analyze upstream failed', {
        endpoint: err.requestPath,
        upstreamStatus: err.statusCode,
        facilityId,
        serviceMonth,
        tokenPreview: session.tokenPreview,
        message: err.message,
      });
    }
    handleCposUpstreamError(err, res);
  }
}

app.post('/api/analyze/from-cpos', heavyLimiter, recaptchaMiddleware('cpos_analyze'), handleCposAnalyze);
// 正規エンドポイント別名（指示書 §6 命名統一）。挙動は /api/analyze/from-cpos と同一。
app.post('/api/cpos/facility/analyze', heavyLimiter, recaptchaMiddleware('cpos_analyze'), handleCposAnalyze);

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
      const sourceType = inlineEvidence ? 'manual_pdf' : 'manual_inputs';
      const envelope = buildAnalysisEnvelope({ sourceType });
      judgeResult.analysis_id = envelope.analysis_id;
      judgeResult.source_type = envelope.source_type;
      judgeResult.review_status = envelope.review_status;
      judgeResult.mapping_warnings = envelope.mapping_warnings;
      const markdown = renderMarkdown(judgeResult);
      const persistInfo = await persistAnalysisIfPaid({
        req,
        analysisId: envelope.analysis_id,
        judgeResult,
        markdown,
        sourceType: envelope.source_type,
      }).catch((err) => ({ persisted: false, reason: err.message }));
      res.json({ ...envelope, persisted: persistInfo.persisted, judge: judgeResult, markdown });
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
