// CPOS app-data ストア — 加算マネージャの全永続化窓口。
//
// 旧（独自）保存:                          → 新（CPOS app-data:kasan）:
//   analysis_jobs                           analyses
//   review_decisions                        reviews
//   facility_profiles                       facility-profiles
//   staff_rosters                           staff-rosters
//   analysis_drafts                         drafts
//   access_codes / planTier                 entitlements
//   user_prefs                              user-prefs
//
// 設計:
//   - すべて `app-data:kasan:*` 配下に書く（CPOS の組織隔離・監査・webhook を共有）。
//   - 保存対象は **匿名化・要約済み** のみ（anonymize.js 多層防御は維持）。
//   - 一覧は CPOS の list を使い、集計は aggregate を試行 → 501 なら list で代替集計。
//   - CPOS 未設定（App Token 無し）は 'cpos_not_configured' で throw（呼び出し側で 503）。

import {
  anonymizeAnalysisResult,
  summarizeForStorage,
  scrubString,
  assertStorageSafe,
} from '../anonymize.js';
import { APP_ID, getAppCposClient } from './app-context.js';

const RESOURCES = {
  ANALYSES: 'analyses',
  REVIEWS: 'reviews',
  FACILITY_PROFILES: 'facility-profiles',
  STAFF_ROSTERS: 'staff-rosters',
  DRAFTS: 'drafts',
  ENTITLEMENTS: 'entitlements',
  USER_PREFS: 'user-prefs',
};

function client() {
  const c = getAppCposClient();
  if (!c) {
    const e = new Error('cpos_not_configured');
    e.statusCode = 503;
    throw e;
  }
  return c;
}

// 構造化データ（callers が組み立てた {label, count, ...}）を受け取り、
// **自由文相当の文字列値だけ** をスクラブして、最後に strict PII チェック。
// summarizeForStorage（EXPLICIT_DROP_KEYS で 'name' を破棄してしまう）は使わない。
// 個人氏名は callers 側が構造的に入れない設計（roster は職種別集計、profile.name は施設名）。
function scrubFreeStrings(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth > 12) return null;
  if (Array.isArray(value)) return value.map((v) => scrubFreeStrings(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubFreeStrings(v, depth + 1);
    return out;
  }
  return null;
}

function safeWrap(data) {
  const safe = scrubFreeStrings(data);
  assertStorageSafe(safe);
  return safe;
}

// ────────────────────────────────────────
// 解析履歴（analyses）
// ────────────────────────────────────────
export async function saveAnalysis({ organizationId, createdBy, payload }) {
  const safe = anonymizeAnalysisResult(payload);
  assertStorageSafe(safe);
  return client().createAppData(APP_ID, RESOURCES.ANALYSES, {
    organizationId,
    createdBy,
    status: 'submitted',
    data: safe,
  });
}

export async function listAnalyses({ organizationId, facilityId, from, to, limit = 50 } = {}) {
  const r = await client().listAppData(APP_ID, RESOURCES.ANALYSES, {
    organizationId,
    facilityId,
    from,
    to,
    limit,
  });
  return r.items || [];
}

export async function getAnalysis(id) {
  return client().getAppData(APP_ID, RESOURCES.ANALYSES, id);
}

// 集計（B5 PROPOSED）。CPOS が 501 を返したら、アプリ側で list を引いて集計する。
export async function aggregateAnalyses({ organizationId, from, to } = {}) {
  const c = client();
  try {
    return await c.aggregateAppData(APP_ID, RESOURCES.ANALYSES, { organizationId, from, to });
  } catch (err) {
    if (err.statusCode !== 501 && err.statusCode !== 404) throw err;
    // フォールバック: list 集計（最大 2000 件）
    const r = await c.listAppData(APP_ID, RESOURCES.ANALYSES, { organizationId, from, to, limit: 2000 });
    const items = r.items || [];
    const dayMs = 30 * 24 * 60 * 60 * 1000;
    const since = Date.now() - dayMs;
    const byService = {};
    const byMonth = {};
    let last30 = 0;
    for (const a of items) {
      const svc = a.data?.service || 'unknown';
      byService[svc] = (byService[svc] || 0) + 1;
      const cm = new Date(a.createdAt).getTime();
      if (cm > since) last30 += 1;
      if (Number.isFinite(cm)) {
        const d = new Date(cm);
        const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        byMonth[m] = (byMonth[m] || 0) + 1;
      }
    }
    return { total: items.length, last30Days: last30, byService, byMonth };
  }
}

// ────────────────────────────────────────
// レビュー判断（reviews）
// ────────────────────────────────────────
export async function recordReview({ organizationId, createdBy, analysisId, kasanKey, decision, comment }) {
  const data = safeWrap({ analysisId, kasanKey: kasanKey || null, decision, comment: comment || null });
  return client().createAppData(APP_ID, RESOURCES.REVIEWS, {
    organizationId,
    createdBy,
    status: 'submitted',
    data,
  });
}
export async function listReviews({ organizationId, analysisId, kasanKey, limit = 100 } = {}) {
  const r = await client().listAppData(APP_ID, RESOURCES.REVIEWS, {
    organizationId,
    limit,
  });
  return (r.items || []).filter((d) => {
    if (analysisId && d.data?.analysisId !== analysisId) return false;
    if (kasanKey && d.data?.kasanKey !== kasanKey) return false;
    return true;
  });
}

// ────────────────────────────────────────
// 施設プロフィール
// ────────────────────────────────────────
export async function listFacilityProfiles({ organizationId, createdBy } = {}) {
  const r = await client().listAppData(APP_ID, RESOURCES.FACILITY_PROFILES, {
    organizationId,
    createdBy,
    limit: 100,
  });
  return r.items || [];
}
export async function getFacilityProfile(id) {
  return client().getAppData(APP_ID, RESOURCES.FACILITY_PROFILES, id);
}
export async function saveFacilityProfile({ id, organizationId, createdBy, data }) {
  const safe = safeWrap(data);
  if (id) return client().updateAppData(APP_ID, RESOURCES.FACILITY_PROFILES, id, { data: safe });
  return client().createAppData(APP_ID, RESOURCES.FACILITY_PROFILES, {
    organizationId,
    createdBy,
    status: 'submitted',
    data: safe,
  });
}
export async function deleteFacilityProfile(id) {
  await client().deleteAppData(APP_ID, RESOURCES.FACILITY_PROFILES, id);
  return true;
}

// ────────────────────────────────────────
// 従業員名簿（保存時に匿名化されたサマリのみ）
// ────────────────────────────────────────
export async function listStaffRosters({ organizationId, createdBy } = {}) {
  const r = await client().listAppData(APP_ID, RESOURCES.STAFF_ROSTERS, {
    organizationId,
    createdBy,
    limit: 100,
  });
  return r.items || [];
}
export async function getStaffRoster(id) {
  return client().getAppData(APP_ID, RESOURCES.STAFF_ROSTERS, id);
}
export async function saveStaffRoster({ id, organizationId, createdBy, data }) {
  const safe = safeWrap(data);
  if (id) return client().updateAppData(APP_ID, RESOURCES.STAFF_ROSTERS, id, { data: safe });
  return client().createAppData(APP_ID, RESOURCES.STAFF_ROSTERS, {
    organizationId,
    createdBy,
    status: 'submitted',
    data: safe,
  });
}
export async function deleteStaffRoster(id) {
  await client().deleteAppData(APP_ID, RESOURCES.STAFF_ROSTERS, id);
  return true;
}

// ────────────────────────────────────────
// ドラフト（少しずつ取込の作業セット）
// ────────────────────────────────────────
export async function listDrafts({ organizationId, createdBy } = {}) {
  const r = await client().listAppData(APP_ID, RESOURCES.DRAFTS, { organizationId, createdBy, limit: 50 });
  return r.items || [];
}
export async function getDraft(id) {
  return client().getAppData(APP_ID, RESOURCES.DRAFTS, id);
}
export async function createDraft({ organizationId, createdBy, data }) {
  const safe = safeWrap(data);
  return client().createAppData(APP_ID, RESOURCES.DRAFTS, {
    organizationId,
    createdBy,
    status: 'draft',
    data: safe,
  });
}
export async function updateDraft(id, data) {
  return client().updateAppData(APP_ID, RESOURCES.DRAFTS, id, { data: safeWrap(data) });
}
export async function deleteDraft(id) {
  await client().deleteAppData(APP_ID, RESOURCES.DRAFTS, id);
  return true;
}

// ────────────────────────────────────────
// エンタイトルメント（A4 案 1: app-data に保存）
//   data: { product: 'kasan-manager', status: 'active'|'expired'|'none', expiresAt, grantedBy }
// 1 ユーザー (createdBy) につき 1 件想定（最新を有効と扱う）
// ────────────────────────────────────────
export async function getEntitlement({ organizationId, userId, product = 'kasan-manager' }) {
  const r = await client().listAppData(APP_ID, RESOURCES.ENTITLEMENTS, {
    organizationId,
    createdBy: userId,
    limit: 50,
  });
  const list = (r.items || []).filter((d) => (d.data?.product || product) === product);
  if (!list.length) return { product, status: 'none', expiresAt: null };
  // 最新 1 件を採用
  const latest = list[0];
  const exp = latest.data?.expiresAt ? new Date(latest.data.expiresAt).getTime() : 0;
  const active = latest.data?.status === 'active' && exp > Date.now();
  return {
    product,
    status: active ? 'active' : latest.data?.status === 'revoked' ? 'revoked' : 'expired',
    expiresAt: latest.data?.expiresAt || null,
    docId: latest.id,
  };
}

export async function setEntitlement({ organizationId, userId, action, days, grantedBy, product = 'kasan-manager' }) {
  const cur = await getEntitlement({ organizationId, userId, product });
  const now = Date.now();
  let status = cur.status;
  let expiresAt = cur.expiresAt;
  if (action === 'revoke') {
    status = 'revoked';
    expiresAt = null;
  } else if (action === 'grant' || action === 'extend') {
    const baseMs = cur.status === 'active' && cur.expiresAt ? new Date(cur.expiresAt).getTime() : now;
    expiresAt = new Date(baseMs + Number(days) * 24 * 60 * 60 * 1000).toISOString();
    status = 'active';
  } else {
    throw new Error('invalid_action');
  }
  const data = { product, status, expiresAt, grantedBy: grantedBy || null, updatedAt: new Date().toISOString() };
  const c = client();
  if (cur.docId) return c.updateAppData(APP_ID, RESOURCES.ENTITLEMENTS, cur.docId, { data });
  return c.createAppData(APP_ID, RESOURCES.ENTITLEMENTS, {
    organizationId,
    createdBy: userId,
    status: 'submitted',
    data,
  });
}

// ────────────────────────────────────────
// 管理ダッシュボード用ユーザー一覧（CPOS B3）
// ────────────────────────────────────────
export async function listOrganizationUsers({ organizationId, limit = 200 } = {}) {
  const r = await client().listPlatformUsers({ organizationId, limit });
  return r.users || [];
}

// 利用状況（B5 集計 + entitlements + ユーザー数）
export async function getUsageSummary({ organizationId } = {}) {
  const [users, analyses] = await Promise.all([
    listOrganizationUsers({ organizationId, limit: 1000 }).catch(() => []),
    aggregateAnalyses({ organizationId }),
  ]);
  return {
    users: { total: users.length },
    analyses,
  };
}
