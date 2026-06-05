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
import { defaultBaseUrl } from './services/cpos/client.js';
import { validateAnalysisSource, deriveCompletenessWarnings } from './services/cpos/schemas.js';
import { CposApiError, CposNotConfiguredError } from './services/cpos/errors.js';
import {
  toEngineInputs as toCposEngineInputs,
  normalizeCposAnalysisPayload,
} from './services/cpos/transform.js';
import { isSessionSecretConfigured } from './utils/cookie-seal.js';
import { buildAnalysisEnvelope } from './utils/analysis-envelope.js';
import { docsRouter, isDocsAvailable } from './routes/docs.js';
import { hydrateSecretsFromManager } from './services/secrets.js';
import { authMiddleware, requireAuth, requirePaid, requireAdmin } from './middleware/auth.js';
import {
  isCposLoginEnabled,
  buildConnectUrl,
  newState,
  setStateCookie,
  verifyStateCookie,
  clearStateCookie,
  loginWithCode,
  setSessionCookie,
  clearSessionCookie,
} from './services/cpos/app-auth.js';
import { isAppCposConfigured, appCposStatus, getAppCposClient } from './services/cpos/app-context.js';
import {
  saveAnalysis,
  listAnalyses,
  getAnalysis,
  recordReview,
  listReviews,
  listFacilityProfiles,
  getFacilityProfile,
  saveFacilityProfile,
  deleteFacilityProfile,
  listStaffRosters,
  getStaffRoster,
  saveStaffRoster,
  deleteStaffRoster,
  listDrafts,
  getDraft,
  createDraft,
  updateDraft,
  deleteDraft,
  getEntitlement,
  setEntitlement,
  listOrganizationUsers,
  getUsageSummary,
} from './services/cpos/store.js';
import { mergeDraftData, draftToBundle } from './services/cpos/draft-merge.js';
import { anonymizeStaffRoster, anonymizeAnalysisResult } from './services/anonymize.js';
import { summarizeReviewsForUser, attachLearningHints } from './services/review-hints.js';
import { optimizePortfolio } from './services/portfolio.js';
import { listGrades as listRegionalGrades, yenPerUnit as regionalYenPerUnit } from './services/regional-pricing.js';
import {
  listPackets as listMasterReviewPackets,
  getPriorityMatrix as getMasterPriorityMatrix,
  getFirstReviewBatch as getMasterFirstBatch,
  getSafeDefaultDecisions as getMasterSafeDefaults,
  getCioDecisionBrief as getMasterCioBrief,
  getDeferredItems as getMasterDeferredItems,
  getReviewWorkloadByRole as getMasterReviewWorkloadByRole,
  getRecommendedDecisionFor as getMasterRecommendedDecisionFor,
  summarizePerServiceWorkload as summarizeMasterWorkload,
  getMasterAuditFor,
} from './services/master-review.js';

// 起動前に Secret Manager から hydrate（失敗しても env だけで動く）
await hydrateSecretsFromManager().catch((err) => {
  console.warn(`[startup] Secret Manager hydration skipped: ${err?.message || err}`);
});

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
// index:false にして "/" は明示ルート（公開トップ = ローカルエンジン）に委ねる
app.use(express.static(path.join(APP_ROOT, 'public'), { maxAge: '5m', index: false }));

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

// /api/* で CPOS セッション cookie があれば検証し req.user を populate
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
      // PAT パネルは廃止。CPOS 連携はアプリ登録（App Token）+ ログイン受け渡しに一本化。
      panel_visible: false,
      ready: isAppCposConfigured(),
      session_secret_configured: isSessionSecretConfigured(),
      default_base_url: defaultBaseUrl(),
      app_configured: isAppCposConfigured(),
      not_ready_message: isAppCposConfigured()
        ? null
        : 'CPOS 連携にはサーバ管理者が KASAN_CPOS_APP_TOKEN と KASAN_SESSION_SECRET / KASAN_DEFAULT_CPOS_BASE_URL を設定する必要があります。',
    },
    csrf: {
      cookie_name: CSRF_COOKIE_NAME,
      header_name: CSRF_HEADER_NAME,
      token: req.csrfToken, // フロントが localStorage 不使用で読める。SameSite で守られる
    },
    docs: { available: isDocsAvailable() },
    auth: {
      // ログインは CPOS 一本化。これが true のとき「CPOS でログイン」を表示する。
      cpos_login_enabled: isCposLoginEnabled(),
      provider: 'cpos',
    },
    persistence: {
      // 保存バックエンドは CPOS app-data に一本化。
      backend: isAppCposConfigured() ? 'cpos_app_data' : 'none',
      app: appCposStatus(),
    },
  });
});

// ============================================================
// 認証（CPOS ログイン一本化）
// ============================================================
app.get('/api/me', (req, res) => {
  if (!req.user?.uid) return res.json({ authenticated: false });
  res.json({
    authenticated: true,
    uid: req.user.uid,
    email: req.user.email,
    displayName: req.user.displayName,
    role: req.user.role,
    organizationId: req.user.organizationId,
    planTier: req.user.planTier,
    planExpiresAt: req.user.planExpiresAt,
    isAdmin: req.user.isAdmin,
    authProvider: 'cpos',
  });
});

// 互換: /api/me/full は /api/me と同じ内容（独自ユーザーレコードは廃止）
app.get('/api/me/full', requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: {
      uid: req.user.uid,
      email: req.user.email,
      displayName: req.user.displayName,
      role: req.user.role,
      organizationId: req.user.organizationId,
      planTier: req.user.planTier,
      planExpiresAt: req.user.planExpiresAt,
      isAdmin: req.user.isAdmin,
    },
  });
});

function cposCallbackRedirectUri(req) {
  const base = (process.env.KASAN_PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/api/auth/cpos/callback`;
}

// CPOS ログイン開始 → CPOS の同意画面へ 302
app.get('/api/auth/cpos/start', (req, res) => {
  if (!isCposLoginEnabled()) {
    return res
      .status(503)
      .json({ ok: false, error: 'cpos_login_disabled', message: 'CPOS ログインが未設定です（管理者の設定が必要）。' });
  }
  try {
    const state = newState();
    setStateCookie(res, state);
    const url = buildConnectUrl({ redirectUri: cposCallbackRedirectUri(req), state });
    res.redirect(url);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// CPOS からのコールバック（code を交換してセッション cookie を発行）
app.get('/api/auth/cpos/callback', async (req, res) => {
  const code = String(req.query?.code || '');
  const state = String(req.query?.state || '');
  if (!code || !verifyStateCookie(req, state)) {
    clearStateCookie(res);
    return res.status(400).send('ログインに失敗しました（state 不一致）。お手数ですが再度お試しください。');
  }
  clearStateCookie(res);
  try {
    const { session } = await loginWithCode(code);
    setSessionCookie(res, session);
    res.redirect('/pro');
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).send(`CPOS ログインに失敗しました: ${err.message}`);
  }
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// 解析結果を CPOS app-data に保存（有料 + CPOS 設定時のみ）。失敗してもレスポンスは止めない。
async function persistAnalysisIfPaid({ req, analysisId, judgeResult, markdown, sourceType, extra = {} }) {
  if (req?.user?.planTier !== 'paid' || !req?.user?.organizationId) {
    return { persisted: false, reason: 'free_or_unauthenticated' };
  }
  if (!isAppCposConfigured()) return { persisted: false, reason: 'cpos_not_configured' };
  try {
    const s = judgeResult?.summary || {};
    const data = {
      analysisId,
      service: judgeResult?.service || null,
      serviceMonth: extra.service_month || null,
      facilityId: extra.facility_id || extra.office || null,
      source_type: sourceType || judgeResult?.source_type || null,
      review_status: judgeResult?.review_status || 'draft',
      kasan_count: judgeResult?.kasan_count ?? null,
      summary_counts: {
        clear: (s.clear || []).length,
        waiting: (s.waiting || []).length,
        not_clear: (s.not_clear || []).length,
        unknown: (s.unknown || []).length,
        currently_claimed: (s.currently_claimed || []).length,
        claimed_but_requirements_unknown: (s.claimed_but_requirements_unknown || []).length,
      },
      mapping_warnings: judgeResult?.mapping_warnings || [],
      reportMarkdown: markdown || null,
      resultJson: anonymizeAnalysisResult(judgeResult),
    };
    const saved = await saveAnalysis({ organizationId: req.user.organizationId, createdBy: req.user.uid, data });
    return { persisted: true, analysisId: saved.id };
  } catch (err) {
    console.warn(`[persist] CPOS save failed: ${err.message}`);
    return { persisted: false, reason: err.message };
  }
}

// ============================================================
// プロフィール / ドラフト / 管理 — すべて CPOS app-data に保存
// ============================================================

// app-data ドキュメント → フロント互換のフラットなビュー（{id, ...data, createdAt, updatedAt}）
function flattenDoc(doc) {
  if (!doc) return null;
  return { id: doc.id, ...(doc.data || {}), createdAt: doc.createdAt, updatedAt: doc.updatedAt };
}
// 取得 + 所有組織チェック（無所属/別組織は null）
async function loadOwned(getter, id, req) {
  let doc;
  try {
    doc = await getter(id);
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
  if (!doc || doc.organizationId !== req.user.organizationId) return null;
  return doc;
}
// CPOS 未設定（503）・その他のストアエラーを HTTP に変換
function storeError(res, err) {
  if (err.message === 'cpos_not_configured' || err.statusCode === 503) {
    return res
      .status(503)
      .json({ ok: false, error: 'cpos_not_configured', message: 'CPOS 連携が未設定です（保存できません）。' });
  }
  return res.status(err.statusCode || 500).json({ ok: false, error: err.message });
}

// ---- 施設プロフィール（組織内で共有・流用） ----
app.get('/api/profiles/facilities', requireAuth, async (req, res) => {
  try {
    const items = await listFacilityProfiles({ organizationId: req.user.organizationId });
    res.json({ ok: true, facilities: items.map(flattenDoc) });
  } catch (err) {
    storeError(res, err);
  }
});
app.post('/api/profiles/facilities', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const data = { name: b.name || null, officeCode: b.officeCode || null, serviceKey: b.serviceKey || null, regionGrade: b.regionGrade || null, note: b.note || null };
    const saved = await saveFacilityProfile({ organizationId: req.user.organizationId, createdBy: req.user.uid, data });
    res.json({ ok: true, facility: flattenDoc(saved) });
  } catch (err) {
    storeError(res, err);
  }
});
app.get('/api/profiles/facilities/:id', requireAuth, async (req, res) => {
  try {
    const doc = await loadOwned(getFacilityProfile, req.params.id, req);
    if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, facility: flattenDoc(doc) });
  } catch (err) {
    storeError(res, err);
  }
});
app.put('/api/profiles/facilities/:id', requireAuth, async (req, res) => {
  try {
    const doc = await loadOwned(getFacilityProfile, req.params.id, req);
    if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
    const b = req.body || {};
    const data = { ...(doc.data || {}), ...b };
    delete data.id;
    const saved = await saveFacilityProfile({ id: req.params.id, organizationId: req.user.organizationId, createdBy: req.user.uid, data });
    res.json({ ok: true, facility: flattenDoc(saved) });
  } catch (err) {
    storeError(res, err);
  }
});
app.delete('/api/profiles/facilities/:id', requireAuth, async (req, res) => {
  try {
    const doc = await loadOwned(getFacilityProfile, req.params.id, req);
    if (!doc) return res.status(404).json({ ok: false });
    await deleteFacilityProfile(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    storeError(res, err);
  }
});

// ---- 従業員名簿（保存時にサーバ側で匿名化集計に変換・氏名は保存しない） ----
function rosterDataFromBody(b = {}) {
  const anonymized = anonymizeStaffRoster(b.entries || []);
  return {
    label: b.label ? String(b.label).slice(0, 80) : '従業員名簿',
    serviceKey: b.serviceKey || null,
    facilityId: b.facilityId || null,
    ...anonymized,
  };
}
app.get('/api/profiles/staff-rosters', requireAuth, async (req, res) => {
  try {
    const items = await listStaffRosters({ organizationId: req.user.organizationId });
    res.json({ ok: true, rosters: items.map(flattenDoc) });
  } catch (err) {
    storeError(res, err);
  }
});
app.post('/api/profiles/staff-rosters', requireAuth, async (req, res) => {
  try {
    const saved = await saveStaffRoster({ organizationId: req.user.organizationId, createdBy: req.user.uid, data: rosterDataFromBody(req.body) });
    res.json({ ok: true, roster: flattenDoc(saved) });
  } catch (err) {
    storeError(res, err);
  }
});
app.get('/api/profiles/staff-rosters/:id', requireAuth, async (req, res) => {
  try {
    const doc = await loadOwned(getStaffRoster, req.params.id, req);
    if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, roster: flattenDoc(doc) });
  } catch (err) {
    storeError(res, err);
  }
});
app.put('/api/profiles/staff-rosters/:id', requireAuth, async (req, res) => {
  try {
    const doc = await loadOwned(getStaffRoster, req.params.id, req);
    if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
    const data = Array.isArray(req.body?.entries) ? rosterDataFromBody(req.body) : { ...(doc.data || {}), ...(req.body || {}) };
    const saved = await saveStaffRoster({ id: req.params.id, organizationId: req.user.organizationId, createdBy: req.user.uid, data });
    res.json({ ok: true, roster: flattenDoc(saved) });
  } catch (err) {
    storeError(res, err);
  }
});
app.delete('/api/profiles/staff-rosters/:id', requireAuth, async (req, res) => {
  try {
    const doc = await loadOwned(getStaffRoster, req.params.id, req);
    if (!doc) return res.status(404).json({ ok: false });
    await deleteStaffRoster(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    storeError(res, err);
  }
});

// ---- 解析ドラフト（少しずつ取込・個人の作業セット） ----
app.get('/api/drafts', requireAuth, async (req, res) => {
  try {
    const items = await listDrafts({ organizationId: req.user.organizationId, createdBy: req.user.uid });
    res.json({ ok: true, drafts: items.map(flattenDoc) });
  } catch (err) {
    storeError(res, err);
  }
});
app.post('/api/drafts', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const data = {
      label: b.label || '作業中の解析',
      serviceKey: b.serviceKey || null,
      serviceMonth: b.serviceMonth && /^\d{4}-\d{2}$/.test(b.serviceMonth) ? b.serviceMonth : null,
      facilityId: b.facilityId || null,
      contributedCount: 0,
      fileTypeCounts: {},
      warnings: [],
    };
    const d = await createDraft({ organizationId: req.user.organizationId, createdBy: req.user.uid, data });
    res.json({ ok: true, draft: flattenDoc(d) });
  } catch (err) {
    storeError(res, err);
  }
});
app.get('/api/drafts/:id', requireAuth, async (req, res) => {
  try {
    const doc = await loadOwned(getDraft, req.params.id, req);
    if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, draft: flattenDoc(doc) });
  } catch (err) {
    storeError(res, err);
  }
});
app.post('/api/drafts/:id/merge', heavyLimiter, requireAuth, async (req, res) => {
  try {
    const doc = await loadOwned(getDraft, req.params.id, req);
    if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
    const newData = mergeDraftData(doc.data || {}, req.body?.bundle || req.body || {});
    const saved = await updateDraft(req.params.id, newData);
    res.json({ ok: true, draft: flattenDoc(saved) });
  } catch (err) {
    storeError(res, err);
  }
});
// レセプトPDF をサーバ側で解析してドラフトへ反映する（ターミナル import_receipt_pdf 相当）。
// 生PDF はメモリ上で pdf-parse のテキスト抽出に使うだけで保存しない（OCR は行わない＝コンソール版と同等）。
// 抽出した加算件数（current_kasan_counts）は mergeDraftData で匿名化のうえ draft.claimEvidence に合算する。
app.post(
  '/api/drafts/:id/ingest-pdf',
  heavyLimiter,
  requireAuth,
  upload.fields([{ name: 'pdf', maxCount: 10 }]),
  async (req, res) => {
    try {
      const doc = await loadOwned(getDraft, req.params.id, req);
      if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
      const files = req.files?.pdf || [];
      if (!files.length) return res.status(400).json({ ok: false, error: 'no_pdf' });
      let data = doc.data || {};
      const serviceKey = String(req.body?.serviceKey || data.serviceKey || '').trim() || null;
      if (!serviceKey) {
        return res.status(400).json({
          ok: false,
          error: 'service_required',
          message: 'PDFのサーバ解析にはサービス種別が必要です。種別を選択してください。',
        });
      }
      const serviceMonth = data.serviceMonth || req.body?.serviceMonth || null;
      const ingested = [];
      for (const f of files) {
        try {
          const { evidence } = await runExtraction({
            office: data.facilityId || 'pro',
            service: serviceKey,
            pdfBuffer: f.buffer,
            sourceName: f.originalname,
          });
          data = mergeDraftData(data, {
            serviceKey,
            serviceMonth,
            claimEvidence: evidence,
            fileTypeCounts: { receipt: 1 },
            warnings: ['Pro: レセプトPDFをサーバ解析（pdf-parse / 生PDFは非保存）'],
          });
          const e = Array.isArray(evidence?.evidence) ? evidence.evidence[0] : null;
          ingested.push({
            file: f.originalname,
            kasanDetected: e ? Object.keys(e.current_kasan_counts || {}).length : 0,
            totalUsers: e?.total_users_estimated ?? null,
            warnings: e?.warnings || [],
          });
        } catch (err) {
          ingested.push({ file: f.originalname, error: err.message || 'PDF解析に失敗しました' });
        }
      }
      const saved = await updateDraft(req.params.id, data);
      res.json({ ok: true, draft: flattenDoc(saved), ingested });
    } catch (err) {
      storeError(res, err);
    }
  },
);
app.delete('/api/drafts/:id', requireAuth, async (req, res) => {
  try {
    const doc = await loadOwned(getDraft, req.params.id, req);
    if (!doc) return res.status(404).json({ ok: false });
    await deleteDraft(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    storeError(res, err);
  }
});
// ドラフトの集計値で加算チェックを実行（既存の from-local 経路を再利用）
app.post('/api/drafts/:id/analyze', heavyLimiter, requireAuth, async (req, res) => {
  try {
    const doc = await loadOwned(getDraft, req.params.id, req);
    if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
    let facility = null;
    if (doc.data?.facilityId) {
      const f = await loadOwned(getFacilityProfile, doc.data.facilityId, req);
      if (f) facility = { id: f.data?.officeCode || f.id, name: f.data?.name };
    }
    req.body = draftToBundle(doc.data || {}, { facility });
    return handleLocalAnalyze(req, res);
  } catch (err) {
    storeError(res, err);
  }
});

// ============================================================
// 管理者: 有料ユーザー管理（CPOS 組織・エンタイトルメント）
// ============================================================
const SERVICE_KEYS_FOR_STATS = ['tsusho_kaigo', 'houmon_kaigo', 'houmon_kango_kaigo', 'kyotaku_shien', 'sogoubu_tsusho'];

function userView(u) {
  const ent = u.entitlements?.['kasan-manager'] || null;
  const active = ent?.status === 'active' && (!ent.expiresAt || new Date(ent.expiresAt).getTime() > Date.now());
  return {
    uid: u.id,
    email: u.email || null,
    displayName: u.name || null,
    role: u.role || 'staff',
    authProvider: 'cpos',
    planTier: active ? 'paid' : 'free',
    planExpiresAt: active ? ent.expiresAt : null,
    createdAt: u.createdAt || null,
    lastLoginAt: u.lastLoginAt || null,
    isAdmin: u.role === 'admin',
  };
}

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await listOrganizationUsers({ organizationId: req.user.organizationId, limit: 1000 });
    res.json({ ok: true, users: users.map(userView) });
  } catch (err) {
    storeError(res, err);
  }
});

// 全体ダッシュボード（CPOS 組織のユーザー数 + app-data 解析集計）
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const usage = await getUsageSummary({ organizationId: req.user.organizationId });
    const stats = {
      users: {
        total: usage.users.total,
        paid_active: null, // CPOS エンタイトルメント横断集計は per-user 詳細で確認
        active_last_30_days: null,
        firebase: usage.users.total,
        native: 0,
      },
      analyses: {
        total: usage.analyses.total,
        last_30_days: usage.analyses.last30Days,
        by_service: usage.analyses.byService,
        by_month: usage.analyses.byMonth,
      },
    };
    res.json({ ok: true, stats });
  } catch (err) {
    storeError(res, err);
  }
});

// ユーザー単位の利用状況詳細（組織内 app-data から集計）
app.get('/api/admin/users/:uid', requireAdmin, async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const uid = req.params.uid;
    const users = await listOrganizationUsers({ organizationId: orgId, limit: 1000 });
    const u = users.find((x) => x.id === uid);
    if (!u) return res.status(404).json({ ok: false, error: 'not_found' });
    const [allAnalyses, ent] = await Promise.all([
      listAnalyses({ organizationId: orgId, limit: 500 }),
      getEntitlement({ organizationId: orgId, userId: uid }).catch(() => ({ status: 'none', expiresAt: null })),
    ]);
    const mine = allAnalyses.filter((a) => a.createdBy === uid);
    const byService = {};
    for (const a of mine) {
      const k = a.data?.service || 'unknown';
      byService[k] = (byService[k] || 0) + 1;
    }
    const active = ent.status === 'active' && (!ent.expiresAt || new Date(ent.expiresAt).getTime() > Date.now());
    res.json({
      ok: true,
      detail: {
        user: { ...userView(u), planTier: active ? 'paid' : 'free', planExpiresAt: active ? ent.expiresAt : null },
        counts: { analyses: mine.length },
        analyses_by_service: byService,
        last_analysis_at: mine[0]?.createdAt || null,
        recent_analyses: mine.slice(0, 10).map((a) => ({
          analysis_id: a.id,
          created_at: a.createdAt,
          service: a.data?.service,
          source_type: a.data?.source_type,
          review_status: a.data?.review_status,
          kasan_count: a.data?.kasan_count,
          summary_counts: a.data?.summary_counts || {},
        })),
      },
    });
  } catch (err) {
    storeError(res, err);
  }
});

// エンタイトルメント付与/延長/取消（旧 access-code + plan 操作を統合）
app.post('/api/admin/users/:uid/plan', heavyLimiter, requireAdmin, async (req, res) => {
  try {
    const action = String(req.body?.action || '');
    if (!['grant', 'extend', 'revoke'].includes(action)) {
      return res.status(400).json({ ok: false, error: 'invalid_action' });
    }
    const days = action === 'revoke' ? 0 : Number(req.body?.days);
    if (action !== 'revoke' && (!Number.isFinite(days) || days <= 0)) {
      return res.status(400).json({ ok: false, error: 'invalid_duration' });
    }
    const ent = await setEntitlement({
      organizationId: req.user.organizationId,
      userId: req.params.uid,
      action,
      days,
      grantedBy: req.user.uid,
    });
    const data = ent.data || ent;
    const active = data.status === 'active';
    res.json({ ok: true, planTier: active ? 'paid' : 'free', planExpiresAt: active ? data.expiresAt : null });
  } catch (err) {
    storeError(res, err);
  }
});

// ============================================================
// 分析履歴・レビュー（有料プラン専用）— CPOS app-data
// ============================================================
function analysisJobView(doc) {
  const d = doc.data || {};
  return {
    analysis_id: doc.id,
    uid: doc.createdBy,
    created_at: doc.createdAt,
    source_type: d.source_type || null,
    review_status: d.review_status || 'draft',
    service: d.service || null,
    facility_id: d.facilityId || null,
    service_month: d.serviceMonth || null,
    kasan_count: d.kasan_count ?? null,
    summary_counts: d.summary_counts || {},
    mapping_warnings: d.mapping_warnings || [],
  };
}
// 解析の取得 + 権限チェック（管理者は組織内、一般は自分のもの）
async function loadOwnedAnalysis(id, req) {
  let doc;
  try {
    doc = await getAnalysis(id);
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
  if (!doc || doc.organizationId !== req.user.organizationId) return null;
  if (!req.user.isAdmin && doc.createdBy !== req.user.uid) return null;
  return doc;
}
// レビュー一覧 → per_kasan_status + 集約 review_status
function aggregateReviews(reviews) {
  const perKasan = {};
  for (const r of reviews) {
    const k = r.data?.kasanKey || '__overall__';
    perKasan[k] = { decision: r.data?.decision, comment: r.data?.comment || null, decided_at: r.createdAt };
  }
  const decisions = Object.entries(perKasan).filter(([k]) => k !== '__overall__').map(([, v]) => v.decision);
  let status = 'draft';
  if (decisions.length) {
    if (decisions.includes('returned')) status = 'returned';
    else if (decisions.every((d) => d === 'approved')) status = 'approved';
    else status = 'awaiting_review';
  }
  return { perKasan, status };
}

app.get('/api/analyses', requirePaid, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 50));
    const all = await listAnalyses({ organizationId: req.user.organizationId, limit: 500 });
    const mine = req.user.isAdmin ? all : all.filter((a) => a.createdBy === req.user.uid);
    res.json({ ok: true, jobs: mine.slice(0, limit).map(analysisJobView) });
  } catch (err) {
    storeError(res, err);
  }
});

app.get('/api/analyses/:id', requirePaid, async (req, res) => {
  try {
    const doc = await loadOwnedAnalysis(req.params.id, req);
    if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
    const reviews = await listReviews({ organizationId: req.user.organizationId, analysisId: req.params.id }).catch(() => []);
    const agg = aggregateReviews(reviews);
    res.json({
      ok: true,
      job: { ...analysisJobView(doc), review_status: agg.status, per_kasan_status: agg.perKasan },
      result: doc.data?.resultJson || null,
      report: doc.data?.reportMarkdown || null,
      review_decisions: reviews.map((r) => ({ ...r.data, decided_at: r.createdAt })),
    });
  } catch (err) {
    storeError(res, err);
  }
});

const VALID_DECISIONS = new Set(['approved', 'returned', 'awaiting_review']);
app.post('/api/analyses/:id/review', heavyLimiter, requirePaid, async (req, res) => {
  try {
    const doc = await loadOwnedAnalysis(req.params.id, req);
    if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
    const decision = String(req.body?.decision || '');
    if (!VALID_DECISIONS.has(decision)) return res.status(400).json({ ok: false, error: 'invalid_decision' });
    const kasanKey = req.body?.kasan_key ? String(req.body.kasan_key) : null;
    const comment = req.body?.comment ? String(req.body.comment).slice(0, 2000) : null;
    await recordReview({
      organizationId: req.user.organizationId,
      createdBy: req.user.uid,
      analysisId: req.params.id,
      kasanKey,
      decision,
      comment,
    });
    const reviews = await listReviews({ organizationId: req.user.organizationId, analysisId: req.params.id });
    const agg = aggregateReviews(reviews);
    res.json({ ok: true, review_status: agg.status, per_kasan_status: agg.perKasan });
  } catch (err) {
    storeError(res, err);
  }
});

app.get('/api/analyses/:id/decisions', requirePaid, async (req, res) => {
  try {
    const doc = await loadOwnedAnalysis(req.params.id, req);
    if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
    const kasanKey = req.query?.kasan_key ? String(req.query.kasan_key) : null;
    const reviews = await listReviews({ organizationId: req.user.organizationId, analysisId: req.params.id, kasanKey });
    const agg = aggregateReviews(reviews);
    res.json({ ok: true, decisions: reviews.map((r) => ({ ...r.data, decided_at: r.createdAt })), per_kasan_status: agg.perKasan });
  } catch (err) {
    storeError(res, err);
  }
});

// ============================================================
// ポートフォリオ最適化 PoC
// ============================================================
app.get('/api/analyses/:id/portfolio', requirePaid, async (req, res) => {
  try {
    const doc = await loadOwnedAnalysis(req.params.id, req);
    if (!doc) return res.status(404).json({ ok: false, error: 'not_found' });
    const result = doc.data?.resultJson;
    if (!result) return res.status(404).json({ ok: false, error: 'result_not_persisted' });
    const regionGrade = req.query?.region_grade ? String(req.query.region_grade) : null;
    let portfolio = optimizePortfolio({ judgeResult: result, regionGrade });
    // 学習ヒント（自分の過去判断）を付与
    const reviews = await listReviews({ organizationId: req.user.organizationId, limit: 1000 }).catch(() => []);
    const learning = summarizeReviewsForUser(reviews, req.user.uid);
    portfolio = attachLearningHints(portfolio, learning);
    res.json({ ok: true, portfolio });
  } catch (err) {
    storeError(res, err);
  }
});

// 無料ユーザーでも分析の生 JSON を渡せば最適化候補を返す（保存はしない）
app.post('/api/portfolio/optimize', heavyLimiter, async (req, res) => {
  try {
    const judgeResult = req.body?.judge || req.body?.result_json || req.body;
    if (!judgeResult || typeof judgeResult !== 'object' || !judgeResult.judgements) {
      return res.status(400).json({ ok: false, error: 'bad_request', message: 'judge 結果（judgements を含む JSON）が必要です' });
    }
    const regionGrade = req.body?.region_grade || judgeResult.region_grade || null;
    let portfolio = optimizePortfolio({ judgeResult, regionGrade });
    if (req.user?.uid) {
      const reviews = await listReviews({ organizationId: req.user.organizationId, limit: 1000 }).catch(() => []);
      portfolio = attachLearningHints(portfolio, summarizeReviewsForUser(reviews, req.user.uid));
    }
    res.json({ ok: true, portfolio });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 地域単価表（公開）
app.get('/api/regional-grades', (_req, res) => {
  res.json({ ok: true, grades: listRegionalGrades() });
});

// 自分のレビュー履歴サマリ（CPOS reviews から集計）
app.get('/api/me/review-learning', requireAuth, async (req, res) => {
  try {
    const reviews = await listReviews({ organizationId: req.user.organizationId, limit: 1000 }).catch(() => []);
    res.json({ ok: true, ...summarizeReviewsForUser(reviews, req.user.uid) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// マスタ整合性レビュー（alpha.5.9 〜 alpha.5.13 packets）
// ============================================================
// 公開:
//   - GET /api/master-review/packets            … パケット一覧（メタのみ）
//   - GET /api/master-review/priority-matrix    … 全 38 件の REVIEW_PRIORITY_MATRIX
//   - GET /api/master-review/first-batch        … 初回バッチ 8 件
//   - GET /api/master-review/workload           … サービス × ロール × バケットの集計
//   - GET /api/master-review/decision/:service/:kasan
//                                                … 加算 1 件の推奨判断 + master audit
//   - GET /api/master-review/brief/cio          … CIO 30 分用 brief（Markdown）
//   - GET /api/master-review/safe-defaults      … safe default decisions（Markdown）
//   - GET /api/master-review/deferred           … 後送り項目（Markdown）
//   - GET /api/master-review/workload-by-role   … ロール別 workload（Markdown）
//
// すべて読み取り専用。public release pack には影響しない。
app.get('/api/master-review/packets', (_req, res) => {
  res.json({ ok: true, packets: listMasterReviewPackets() });
});

app.get('/api/master-review/priority-matrix', (req, res) => {
  let rows = getMasterPriorityMatrix();
  const service = req.query?.service ? String(req.query.service) : null;
  const bucket = req.query?.bucket ? String(req.query.bucket) : null;
  const firstBatchOnly = req.query?.first_batch_only === '1';
  if (service) rows = rows.filter((r) => r.service === service);
  if (bucket) rows = rows.filter((r) => r.review_bucket === bucket);
  if (firstBatchOnly) rows = rows.filter((r) => r.can_be_first_batch === 'yes');
  res.json({ ok: true, count: rows.length, rows });
});

app.get('/api/master-review/first-batch', (_req, res) => {
  res.json({ ok: true, rows: getMasterFirstBatch() });
});

app.get('/api/master-review/workload', (_req, res) => {
  res.json({ ok: true, summary: summarizeMasterWorkload() });
});

app.get('/api/master-review/decision/:service/:kasan', (req, res) => {
  const decision = getMasterRecommendedDecisionFor(req.params.service, req.params.kasan);
  const audit = getMasterAuditFor(req.params.service, req.params.kasan);
  if (!decision && !audit) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, decision, audit });
});

const MASTER_REVIEW_MARKDOWN = {
  'brief/cio': getMasterCioBrief,
  'safe-defaults': getMasterSafeDefaults,
  deferred: getMasterDeferredItems,
  'workload-by-role': getMasterReviewWorkloadByRole,
};
for (const [name, fn] of Object.entries(MASTER_REVIEW_MARKDOWN)) {
  app.get(`/api/master-review/${name}`, (_req, res) => {
    const md = fn();
    if (!md) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, markdown: md });
  });
}

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

// ============================================================
// CPOS データ proxy（App Token + ログインユーザーの権限範囲内）
// ============================================================
// PAT 個人トークンは廃止。s2s は CPOS アプリ登録の App Token（getAppCposClient）を使い、
// 「誰の操作か」はログイン済みセッション（req.user.organizationId / allowedFacilityIds）で判断する。

function requireAppCpos(res) {
  const client = getAppCposClient();
  if (!client) {
    res.status(503).json({
      ok: false,
      error: 'cpos_not_configured',
      message: 'CPOS 連携が未設定です（KASAN_CPOS_APP_TOKEN / CPOS URL）。',
    });
    return null;
  }
  return client;
}

function checkFacilityAllowed(req, facilityId) {
  if (!facilityId) return true;
  const allow = req.user?.allowedFacilityIds;
  if (!allow || !Array.isArray(allow) || allow.length === 0) return true; // 制限なし
  return allow.includes(facilityId);
}

app.get('/api/cpos/facilities', requireAuth, async (req, res) => {
  const client = requireAppCpos(res);
  if (!client) return;
  try {
    let facilities = [];
    try {
      const r = await client.getPlatformFacilities();
      facilities = Array.isArray(r?.facilities) ? r.facilities : Array.isArray(r) ? r : [];
    } catch (err) {
      const b = await client.getBootstrap();
      facilities = b?.facilities || [];
    }
    // allowedFacilityIds がある場合はその範囲だけに絞る
    const allow = req.user?.allowedFacilityIds;
    if (Array.isArray(allow) && allow.length) {
      facilities = facilities.filter((f) => allow.includes(f.id || f.facilityId));
    }
    res.json({ facilities });
  } catch (err) {
    handleCposError(err, res);
  }
});

// 加算分析: CPOS から bundle を取り、既存判定エンジンで判定 → Markdown を返す
async function handleCposAnalyze(req, res) {
  const client = requireAppCpos(res);
  if (!client) return;
  const facilityId = String(req.body?.facilityId || '').trim();
  const serviceMonth = String(req.body?.serviceMonth || '').trim();
  const serviceKey = req.body?.serviceKey ? String(req.body.serviceKey) : null;
  if (!facilityId || !serviceMonth) {
    return res.status(400).json({ ok: false, error: 'bad_request', message: 'facilityId と serviceMonth は必須です' });
  }
  if (!checkFacilityAllowed(req, facilityId)) {
    return res.status(403).json({ ok: false, error: 'forbidden_facility', message: 'この事業所への権限がありません' });
  }

  console.log('[cpos] analyze from cpos start', {
    organizationId: req.user?.organizationId,
    subjectUserEmail: req.user?.email,
    facilityId,
    serviceMonth,
    serviceKey,
  });

  try {
    // 第一候補: /api/kasan/v1/analysis-source（schemaVersion=1.0）
    // 第二候補: /api/platform/kasan/export（formatVersion=1）。analysis-source が 404 のときだけ fallback。
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
          organizationId: req.user?.organizationId,
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
      organizationId: req.user?.organizationId,
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
      subjectUserEmail: req.user?.email || null,
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
        organizationId: req.user?.organizationId,
        message: err.message,
      });
    }
    handleCposUpstreamError(err, res);
  }
}

app.post('/api/analyze/from-cpos', heavyLimiter, requireAuth, recaptchaMiddleware('cpos_analyze'), handleCposAnalyze);
// 正規エンドポイント別名。挙動は /api/analyze/from-cpos と同一。
app.post('/api/cpos/facility/analyze', heavyLimiter, requireAuth, recaptchaMiddleware('cpos_analyze'), handleCposAnalyze);

// ============================================================
// ローカル前処理エンジン（ブラウザ完結 /local-import）からの集計バンドル受け口
// ============================================================
// クライアント（ブラウザ）が OCR/分類/PII除去/集計まで済ませた analysis-source 互換
// バンドルを受け取り、CPOS と同一の変換・判定経路で加算チェックする。
// 生ファイルは送られてこない（集計値・フラグのみ）。MVP は無認証（無料枠）。
async function handleLocalAnalyze(req, res) {
  try {
    const bundle = req.body;
    if (!bundle || typeof bundle !== 'object') {
      return res.status(400).json({ error: 'バンドル（JSON）が空です。' });
    }
    const normalized = normalizeCposAnalysisPayload(bundle);
    const validated = normalized.schemaVersion ? validateAnalysisSource(normalized) : normalized;
    const inputs = await toCposEngineInputs(validated);
    const serviceKey = inputs.service_key;

    // ローカル抽出の claimEvidence（kasan_key ベース）があればそれを優先して inlineEvidence に使う。
    // 無ければ CPOS 経路と同じく claimSummary 由来の evidence にフォールバック。
    const localEvidence =
      bundle.claimEvidence &&
      Array.isArray(bundle.claimEvidence.evidence) &&
      bundle.claimEvidence.evidence.length
        ? bundle.claimEvidence
        : inputs.claim_evidence;

    // データ系統をローカル由来として明示
    if (inputs.user_summary) inputs.user_summary.data_source_type = 'local_aggregate';

    const judgeResult = await runJudge({
      service: serviceKey,
      office: inputs.facility?.id || 'local',
      applyEvidence: true,
      inlineEvidence: localEvidence,
    });
    const inlineFiles = {
      tenant_status_json: [{ buffer: Buffer.from(JSON.stringify(inputs.tenant_status), 'utf-8') }],
      staff_json: [{ buffer: Buffer.from(JSON.stringify(inputs.staff_data), 'utf-8') }],
      user_summary_json: [{ buffer: Buffer.from(JSON.stringify(inputs.user_summary), 'utf-8') }],
    };
    const enriched = await applyInlineFiles(judgeResult, serviceKey, inlineFiles);
    enriched.cpos_metadata = {
      ...inputs.metadata,
      source: 'local.engine',
      serviceMonth: validated.serviceMonth,
    };
    const completenessWarnings = deriveCompletenessWarnings(validated);
    const envelope = buildAnalysisEnvelope({
      sourceType: 'local_engine',
      cposMetadata: inputs.metadata,
      extraWarnings: [...completenessWarnings, ...(Array.isArray(bundle.warnings) ? bundle.warnings : [])],
    });
    enriched.analysis_id = envelope.analysis_id;
    enriched.source_type = envelope.source_type;
    enriched.review_status = envelope.review_status;
    enriched.mapping_warnings = envelope.mapping_warnings;
    const reportMarkdown = renderMarkdown(enriched);
    const persistInfo = await persistAnalysisIfPaid({
      req,
      analysisId: envelope.analysis_id,
      judgeResult: enriched,
      markdown: reportMarkdown,
      sourceType: envelope.source_type,
      extra: { service_key: serviceKey, service_month: validated.serviceMonth },
    }).catch((err) => ({ persisted: false, reason: err.message }));
    res.json({
      ok: true,
      ...envelope,
      persisted: persistInfo.persisted,
      reportMarkdown,
      resultJson: enriched,
      local: { serviceKey, serviceMonth: validated.serviceMonth },
    });
  } catch (err) {
    console.error('[local] analyze error:', err);
    res.status(400).json({ error: err.message || 'ローカルバンドルの解析に失敗しました。' });
  }
}

app.post('/api/analyze/from-local', heavyLimiter, recaptchaMiddleware('local_analyze'), handleLocalAnalyze);

// 公開トップ = ローカル前処理エンジン（ブラウザ完結・ログイン不要・無料）
app.get('/', (_req, res) => {
  res.sendFile(path.join(APP_ROOT, 'public', 'local-import.html'));
});
// 旧 URL 互換のエイリアス
app.get('/local-import', (_req, res) => {
  res.sendFile(path.join(APP_ROOT, 'public', 'local-import.html'));
});
// 高精度版（AI 補完 / CPOS 連携 / 判定履歴・レビュー）= 有料・ログイン導線
app.get('/pro', (_req, res) => {
  res.sendFile(path.join(APP_ROOT, 'public', 'index.html'));
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

  // CPOS / アップロード由来の tenant_status に inquiry（確認待ち項目）があれば
  // レポートの「§3 確認待ち項目（テナント側）」「🎯 すぐ確認すべき項目 TOP5」へ配線する。
  // ターミナルの --status 相当: tenant_status をロード済みとして扱う（「🗓️ 今月やること」も整合）。
  // （CPOS 変換は inquiry を生成済みだが、これまで judgeResult に渡されず死にセクション化していた）
  if (tenantInline) {
    judgeResult.tenant_status_loaded = true;
    if (tenantInline.inquiry && Object.keys(tenantInline.inquiry).length) {
      judgeResult.tenant_status_inquiry = tenantInline.inquiry;
    }
  }

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
      const regionGrade = (req.body.region_grade || '').toString().trim() || null;

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
      if (regionGrade) judgeResult.region_grade = regionGrade;
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
    'region_grade',
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
