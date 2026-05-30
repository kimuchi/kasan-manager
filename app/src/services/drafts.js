// 解析ドラフト（少しずつアップロードする作業セット）。
//
// 目的（ゴール: 少しずつ情報をアップロードすることもできる）:
//   - 1 回で全書類を揃えられなくても、ブラウザで匿名集計したバンドルを複数回に分けて
//     サーバ側ドラフトへ「合算（merge）」していける。
//   - 次回ログイン時に続きから解析を実行できる。
//
// 保存されるのは匿名集計値のみ（userSummary / staffSummary / claimEvidence の集計）。
// 生データ・氏名・被保険者番号は保存しない（サーバ側でも summarizeForStorage を通す）。

import { randomUUID } from 'node:crypto';

import { getDb } from './firebase-admin.js';
import { summarizeForStorage, assertStorageSafe } from './anonymize.js';
import { mergeUserSummaries, mergeStaffSummaries } from '../../public/local/aggregate.js';

const COLLECTION_DRAFTS = 'analysis_drafts';

function ts(t) {
  return t?.toDate?.() ? t.toDate().toISOString() : t || null;
}

// 2 つの claimEvidence をマージ（current_kasan_counts を加算し単一エントリに集約）
function mergeClaimEvidence(a, b) {
  const entries = [...(a?.evidence || []), ...(b?.evidence || [])];
  if (!entries.length) return a || b || null;
  const counts = {};
  const codes = new Set();
  let totalPages = 0;
  for (const e of entries) {
    for (const [k, v] of Object.entries(e.current_kasan_counts || {})) {
      counts[k] = (counts[k] || 0) + Number(v || 0);
    }
    for (const c of e.detected_service_codes || []) codes.add(c);
    totalPages += Number(e.total_pages || e.total_users_estimated || 0);
  }
  const base = entries[0];
  return {
    _meta: a?._meta || b?._meta || { schema: 'evidence', schema_version: '1.2' },
    evidence: [
      {
        ...base,
        current_kasan_counts: counts,
        detected_service_codes: [...codes].sort(),
        total_pages: totalPages,
        merged_entry_count: entries.length,
      },
    ],
  };
}

export async function listDrafts(uid) {
  const db = getDb();
  if (!db) return [];
  const snap = await db.collection(COLLECTION_DRAFTS).where('uid', '==', uid).limit(50).get();
  return snap.docs.map((d) => serialize(d.data())).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getDraft(uid, id) {
  const db = getDb();
  if (!db) return null;
  const snap = await db.collection(COLLECTION_DRAFTS).doc(id).get();
  if (!snap.exists || snap.data().uid !== uid) return null;
  return serialize(snap.data());
}

export async function createDraft(uid, { serviceKey = null, serviceMonth = null, facilityId = null, label = null } = {}) {
  const db = getDb();
  if (!db) throw new Error('store_unavailable');
  const now = new Date();
  const id = randomUUID();
  const doc = {
    id,
    uid,
    label: label ? String(label).slice(0, 80) : '作業中の解析',
    serviceKey: serviceKey ? String(serviceKey).slice(0, 60) : null,
    serviceMonth: serviceMonth && /^\d{4}-\d{2}$/.test(serviceMonth) ? serviceMonth : null,
    facilityId: facilityId ? String(facilityId).slice(0, 64) : null,
    userSummary: null,
    staffSummary: null,
    claimEvidence: null,
    fileTypeCounts: {},
    contributedCount: 0,
    warnings: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.collection(COLLECTION_DRAFTS).doc(id).set(doc);
  return serialize(doc);
}

// 新しい匿名バンドルの集計値をドラフトに合算する。
// bundle: { serviceKey?, serviceMonth?, userSummary?, staffSummary?, claimEvidence?, fileTypeCounts?, warnings? }
export async function mergeIntoDraft(uid, id, bundle = {}) {
  const db = getDb();
  if (!db) throw new Error('store_unavailable');
  const ref = db.collection(COLLECTION_DRAFTS).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data().uid !== uid) throw new Error('not_found');
  const cur = snap.data();

  // サーバ側でも匿名化（多層防御）
  const safe = summarizeForStorage(bundle);

  const userSummary = mergeUserSummaries([cur.userSummary, safe.userSummary].filter(Boolean));
  const staffSummary = mergeStaffSummaries([cur.staffSummary, safe.staffSummary].filter(Boolean));
  const claimEvidence = mergeClaimEvidence(cur.claimEvidence, safe.claimEvidence);

  const fileTypeCounts = { ...(cur.fileTypeCounts || {}) };
  for (const [k, v] of Object.entries(safe.fileTypeCounts || {})) {
    fileTypeCounts[k] = (fileTypeCounts[k] || 0) + Number(v || 0);
  }
  const warnings = Array.from(new Set([...(cur.warnings || []), ...(safe.warnings || [])])).slice(0, 50);

  const update = {
    serviceKey: cur.serviceKey || safe.serviceKey || null,
    serviceMonth: cur.serviceMonth || (safe.serviceMonth && /^\d{4}-\d{2}$/.test(safe.serviceMonth) ? safe.serviceMonth : null),
    userSummary: userSummary || null,
    staffSummary: staffSummary || null,
    claimEvidence: claimEvidence || null,
    fileTypeCounts,
    warnings,
    contributedCount: (cur.contributedCount || 0) + 1,
    updatedAt: new Date(),
  };
  assertStorageSafe(update);
  await ref.update(update);
  return serialize({ ...cur, ...update });
}

export async function deleteDraft(uid, id) {
  const db = getDb();
  if (!db) return false;
  const existing = await getDraft(uid, id);
  if (!existing) return false;
  await db.collection(COLLECTION_DRAFTS).doc(id).delete();
  return true;
}

// ドラフト → /api/analyze/from-local が受け取る analysis_source 互換バンドルへ。
export function draftToBundle(draft, { facility = null } = {}) {
  // analysis_source スキーマは facility.name が存在する場合 string を要求するため、
  // null は入れず、値があるときだけ name を付与する。
  const fac = { id: (facility?.id || draft.facilityId || 'local') };
  if (facility?.name) fac.name = String(facility.name);
  return {
    schemaVersion: '1.0',
    organizationId: 'local-pro',
    facility: fac,
    serviceMonth: draft.serviceMonth || null,
    serviceKey: draft.serviceKey || null,
    userSummary: draft.userSummary || undefined,
    staffSummary: draft.staffSummary || undefined,
    claimEvidence: draft.claimEvidence || undefined,
    dataCompleteness: {
      billing: draft.claimEvidence ? 'partial' : 'missing',
      users: draft.userSummary ? 'partial' : 'missing',
      staffing: draft.staffSummary ? 'partial' : 'missing',
    },
    warnings: ['プロ・ドラフトから実行（少しずつ取込んだ集計値）', ...(draft.warnings || [])],
    fileTypeCounts: draft.fileTypeCounts || {},
  };
}

function serialize(d) {
  return {
    id: d.id,
    label: d.label || null,
    serviceKey: d.serviceKey || null,
    serviceMonth: d.serviceMonth || null,
    facilityId: d.facilityId || null,
    userSummary: d.userSummary || null,
    staffSummary: d.staffSummary || null,
    claimEvidence: d.claimEvidence || null,
    fileTypeCounts: d.fileTypeCounts || {},
    contributedCount: d.contributedCount || 0,
    warnings: d.warnings || [],
    createdAt: ts(d.createdAt),
    updatedAt: ts(d.updatedAt),
  };
}
