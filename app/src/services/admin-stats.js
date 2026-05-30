// 管理者向けの集計：全体ダッシュボード + ユーザごとの利用状況。
//
// 既存コレクションを横断集計するだけ（新規スキーマは追加しない）。
// 取得対象:
//   - users:               ログインユーザー全体
//   - analysis_jobs:       解析履歴（uid・service・created_at）
//   - analysis_drafts:     作業ドラフト（uid・contributedCount）
//   - facility_profiles:   施設プロフィール（uid）
//   - staff_rosters:       従業員名簿（uid）
//   - access_codes:        アクセスコード（redeemedByUid）
//   - audit_logs:          監査ログ（uid・event_type・at）
//
// すべて getDb()（Firestore or ローカルストア）に対して動く。
// Firestore で `where(uid) + orderBy(at)` を使う場合は複合インデックスが必要。
// ローカルストアは in-memory ソートなのでそのまま動く。

import { getDb } from './firebase-admin.js';
import { isAdminEmail } from './users.js';

function ts(t) {
  return t?.toDate?.() ? t.toDate().toISOString() : t || null;
}
function toMs(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  const v = new Date(t).getTime();
  return Number.isFinite(v) ? v : 0;
}

async function safeCollect(promise) {
  try {
    return (await promise).docs.map((d) => d.data());
  } catch {
    return [];
  }
}

function evalPlanTier(doc) {
  const tier = doc?.planTier || 'free';
  const expMs = toMs(doc?.planExpiresAt);
  if (tier === 'paid' && expMs > Date.now()) {
    return { planTier: 'paid', planExpiresAt: new Date(expMs).toISOString() };
  }
  return { planTier: 'free', planExpiresAt: null };
}

// ============================================================
// 全体ダッシュボード
// ============================================================
export async function getAdminAggregateStats() {
  const db = getDb();
  if (!db) return null;

  const [users, jobs] = await Promise.all([
    safeCollect(db.collection('users').limit(2000).get()),
    safeCollect(db.collection('analysis_jobs').orderBy('created_at', 'desc').limit(2000).get()),
  ]);

  const now = Date.now();
  const day30 = now - 30 * 24 * 60 * 60 * 1000;

  let paidActive = 0;
  let nativeUsers = 0;
  let firebaseUsers = 0;
  let activeLast30 = 0;
  for (const u of users) {
    const plan = evalPlanTier(u);
    if (plan.planTier === 'paid') paidActive += 1;
    if ((u.authProvider || 'firebase') === 'local') nativeUsers += 1;
    else firebaseUsers += 1;
    if (toMs(u.lastLoginAt) > day30) activeLast30 += 1;
  }

  const analysesByService = {};
  const analysesByMonth = {}; // YYYY-MM
  let analysesLast30 = 0;
  for (const j of jobs) {
    const k = j.service || 'unknown';
    analysesByService[k] = (analysesByService[k] || 0) + 1;
    const caMs = toMs(j.created_at);
    if (caMs > day30) analysesLast30 += 1;
    if (caMs) {
      const d = new Date(caMs);
      const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      analysesByMonth[m] = (analysesByMonth[m] || 0) + 1;
    }
  }

  return {
    users: {
      total: users.length,
      paid_active: paidActive,
      native: nativeUsers,
      firebase: firebaseUsers,
      active_last_30_days: activeLast30,
    },
    analyses: {
      total: jobs.length,
      last_30_days: analysesLast30,
      by_service: analysesByService,
      by_month: analysesByMonth,
    },
  };
}

// ============================================================
// ユーザーごとの利用状況詳細
// ============================================================
export async function getUserUsageDetail(uid) {
  const db = getDb();
  if (!db) return null;

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return null;
  const u = userSnap.data();
  const plan = evalPlanTier(u);

  const [jobs, drafts, facilities, rosters, codes, audits] = await Promise.all([
    safeCollect(
      db.collection('analysis_jobs').where('uid', '==', uid).orderBy('created_at', 'desc').limit(100).get(),
    ),
    safeCollect(db.collection('analysis_drafts').where('uid', '==', uid).limit(100).get()),
    safeCollect(db.collection('facility_profiles').where('uid', '==', uid).limit(100).get()),
    safeCollect(db.collection('staff_rosters').where('uid', '==', uid).limit(100).get()),
    safeCollect(db.collection('access_codes').where('redeemedByUid', '==', uid).limit(100).get()),
    safeCollect(db.collection('audit_logs').where('uid', '==', uid).orderBy('at', 'desc').limit(50).get()),
  ]);

  const analysesByService = {};
  const analysesByMonth = {};
  for (const j of jobs) {
    const k = j.service || 'unknown';
    analysesByService[k] = (analysesByService[k] || 0) + 1;
    const caMs = toMs(j.created_at);
    if (caMs) {
      const d = new Date(caMs);
      const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      analysesByMonth[m] = (analysesByMonth[m] || 0) + 1;
    }
  }

  return {
    user: {
      uid: u.uid,
      email: u.email,
      displayName: u.displayName || null,
      authProvider: u.authProvider || 'firebase',
      emailVerified: Boolean(u.emailVerified),
      isAdmin: isAdminEmail(u.email) || u.isAdmin === true,
      planTier: plan.planTier,
      planExpiresAt: plan.planExpiresAt,
      rawPlanTier: u.planTier || 'free',
      createdAt: ts(u.createdAt),
      lastLoginAt: ts(u.lastLoginAt),
    },
    counts: {
      analyses: jobs.length,
      drafts: drafts.length,
      facilities: facilities.length,
      rosters: rosters.length,
      redeemed_codes: codes.length,
    },
    analyses_by_service: analysesByService,
    analyses_by_month: analysesByMonth,
    last_analysis_at: jobs[0] ? ts(jobs[0].created_at) : null,
    recent_analyses: jobs.slice(0, 10).map((j) => ({
      analysis_id: j.analysis_id,
      created_at: ts(j.created_at),
      service: j.service,
      source_type: j.source_type,
      review_status: j.review_status,
      kasan_count: j.kasan_count,
      summary_counts: j.summary_counts || {},
    })),
    redeemed_codes: codes
      .map((c) => ({
        code: c.code,
        durationDays: c.durationDays,
        redeemedAt: ts(c.redeemedAt),
        note: c.note || null,
      }))
      .sort((a, b) => (a.redeemedAt < b.redeemedAt ? 1 : -1)),
    recent_audits: audits.map((a) => ({
      event_type: a.event_type,
      at: ts(a.at),
      detail: a.detail || null,
    })),
  };
}
