// 加算分析の永続化（有料ユーザーのみ）。
//
// 保存先:
//   - Firestore `analysis_jobs/{analysis_id}`: メタ情報 + judge サマリ
//   - GCS `analyses/{uid}/{analysis_id}/result.json` + `report.md`: フルレポート
//
// 設計:
//   - 無料ユーザーや Firestore が無い環境では何もしない（quiet）。
//   - 失敗してもクライアント側の分析結果返却は止めない（背景でログを残す）。
//   - レビューア用に review_decisions も別コレクションで管理。

import { getDb, getStorageBucket } from './firebase-admin.js';
import { anonymizeAnalysisResult, assertStorageSafe } from './anonymize.js';

const COLLECTION_JOBS = 'analysis_jobs';
const COLLECTION_REVIEWS = 'review_decisions';
const COLLECTION_AUDIT = 'audit_logs';
const COLLECTION_ARTIFACTS = 'analysis_artifacts'; // GCS 非設定時のフォールバック保存先

function summarizeForFirestore(judgeResult) {
  const s = judgeResult?.summary || {};
  return {
    service: judgeResult?.service || null,
    office: judgeResult?.office || null,
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
    source_type: judgeResult?.source_type || null,
  };
}

export async function persistAnalysisIfPaid({ req, analysisId, judgeResult, markdown, sourceType, extra = {} }) {
  if (req?.user?.planTier !== 'paid' || !req?.user?.uid) return { persisted: false, reason: 'free_or_unauthenticated' };
  const db = getDb();
  if (!db) return { persisted: false, reason: 'firestore_unavailable' };
  const bucket = getStorageBucket();
  const uid = req.user.uid;
  const now = new Date();

  try {
    const jobRef = db.collection(COLLECTION_JOBS).doc(analysisId);
    await jobRef.set({
      analysis_id: analysisId,
      uid,
      ownerEmail: req.user.email || null,
      created_at: now,
      source_type: sourceType,
      review_status: judgeResult?.review_status || 'draft',
      ...summarizeForFirestore(judgeResult),
      ...extra,
    });
  } catch (err) {
    console.warn(`[persistence] Firestore save failed: ${err.message}`);
    return { persisted: false, reason: 'firestore_write_failed' };
  }

  // フルレポートは保存前に必ず匿名化（サーバ側の最終防衛線）。
  let safeResult = judgeResult;
  try {
    safeResult = anonymizeAnalysisResult(judgeResult);
    assertStorageSafe(safeResult);
  } catch (err) {
    console.warn(`[persistence] anonymize/assert failed, storing minimal meta only: ${err.message}`);
    safeResult = null; // PII 残存の疑い → フルレポートは保存しない（メタのみ残す）
  }

  if (bucket && safeResult) {
    try {
      const base = `analyses/${uid}/${analysisId}`;
      await bucket.file(`${base}/result.json`).save(JSON.stringify(safeResult, null, 2), {
        contentType: 'application/json; charset=utf-8',
        resumable: false,
      });
      if (markdown) {
        await bucket.file(`${base}/report.md`).save(markdown, {
          contentType: 'text/markdown; charset=utf-8',
          resumable: false,
        });
      }
    } catch (err) {
      console.warn(`[persistence] GCS save failed: ${err.message}`);
      // Firestore のメタは残っているので持続的失敗ではない
    }
  } else if (!bucket && safeResult) {
    // GCS 非設定環境（ローカルストア運用）: 永続化レイヤにフルレポートを保存
    try {
      await saveArtifact({ uid, analysisId, kind: 'result', content: JSON.stringify(safeResult, null, 2) });
      if (markdown) await saveArtifact({ uid, analysisId, kind: 'report', content: markdown });
    } catch (err) {
      console.warn(`[persistence] local artifact save failed: ${err.message}`);
    }
  }

  await logAudit({ uid, eventType: 'analysis_persisted', detail: { analysisId, sourceType } });
  return { persisted: true };
}

// ---- アーティファクト（GCS 非設定時の result.json / report.md フォールバック） ----
function artifactId(uid, analysisId, kind) {
  return `${uid}__${analysisId}__${kind}`;
}

async function saveArtifact({ uid, analysisId, kind, content }) {
  const db = getDb();
  if (!db) return;
  await db
    .collection(COLLECTION_ARTIFACTS)
    .doc(artifactId(uid, analysisId, kind))
    .set({ uid, analysis_id: analysisId, kind, content, saved_at: new Date() });
}

async function loadLocalArtifact({ uid, analysisId, kind }) {
  const db = getDb();
  if (!db) return null;
  const snap = await db.collection(COLLECTION_ARTIFACTS).doc(artifactId(uid, analysisId, kind)).get();
  return snap.exists ? snap.data().content : null;
}

export async function listAnalysisJobsForUser(uid, { limit = 50 } = {}) {
  const db = getDb();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTION_JOBS)
    .where('uid', '==', uid)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => serializeJob(d.data()));
}

export async function getAnalysisJob({ analysisId, uid, isAdmin = false }) {
  const db = getDb();
  if (!db) return null;
  const snap = await db.collection(COLLECTION_JOBS).doc(analysisId).get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (!isAdmin && d.uid !== uid) return null;
  return serializeJob(d);
}

export async function loadAnalysisArtifact({ analysisId, uid, kind = 'result' }) {
  const bucket = getStorageBucket();
  if (!bucket) {
    // GCS 非設定: ローカルストアのアーティファクトを返す
    return loadLocalArtifact({ uid, analysisId, kind });
  }
  const base = `analyses/${uid}/${analysisId}`;
  const path = kind === 'report' ? `${base}/report.md` : `${base}/result.json`;
  const [buf] = await bucket.file(path).download().catch(() => [null]);
  return buf ? buf.toString('utf-8') : null;
}

// レビュー判断の記録。
// - kasan_key 指定: その加算の per-kasan 判断を 1 件記録（履歴蓄積）
// - kasan_key 未指定: 解析全体に対する overall judgement として記録
//
// 副作用として、analysis_jobs に以下を denormalize 反映:
//   - per_kasan_status: { [kasan_key]: { decision, comment, decided_at, reviewer_email } }
//   - review_status: 全体集約。すべての判定済 kasan が approved → 'approved'、
//     1 つでも returned があれば 'returned'、awaiting_review があれば 'awaiting_review'、
//     全くなければ 'draft'。
export function aggregateReviewStatus(perKasanStatus) {
  const values = Object.values(perKasanStatus || {});
  if (values.length === 0) return 'draft';
  if (values.some((v) => v?.decision === 'returned')) return 'returned';
  if (values.some((v) => v?.decision === 'awaiting_review')) return 'awaiting_review';
  if (values.every((v) => v?.decision === 'approved')) return 'approved';
  return 'awaiting_review';
}

const VALID_DECISIONS = new Set(['approved', 'returned', 'awaiting_review']);

export async function recordReviewDecision({ analysisId, kasanKey, decision, comment, reviewerUid, reviewerEmail }) {
  const db = getDb();
  if (!db) throw new Error('firestore_unavailable');
  if (!VALID_DECISIONS.has(decision)) {
    throw new Error('invalid_decision');
  }
  const jobRef = db.collection(COLLECTION_JOBS).doc(analysisId);
  const decisionDoc = {
    analysis_id: analysisId,
    kasan_key: kasanKey || null,
    decision,
    comment: comment || null,
    reviewer_uid: reviewerUid,
    reviewer_email: reviewerEmail || null,
    decided_at: new Date(),
  };
  await db.collection(COLLECTION_REVIEWS).add(decisionDoc);
  // analysis_jobs に per_kasan_status を merge + 集約 review_status を更新
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) return;
    const data = snap.data();
    const perKasanStatus = { ...(data.per_kasan_status || {}) };
    const key = kasanKey || '__overall__';
    perKasanStatus[key] = {
      decision,
      comment: comment || null,
      decided_at: new Date(),
      reviewer_email: reviewerEmail || null,
    };
    // overall キーは集約には使わず、kasan キーのみで集約
    const forAggregate = { ...perKasanStatus };
    delete forAggregate.__overall__;
    const reviewStatus = aggregateReviewStatus(forAggregate);
    tx.update(jobRef, {
      per_kasan_status: perKasanStatus,
      review_status: reviewStatus,
      last_reviewed_at: new Date(),
    });
  });
  await logAudit({
    uid: reviewerUid,
    eventType: 'review_decision',
    detail: { analysisId, kasanKey, decision },
  });
  return { ok: true };
}

export async function listReviewDecisions({ analysisId, kasanKey = null }) {
  const db = getDb();
  if (!db) return [];
  let q = db.collection(COLLECTION_REVIEWS).where('analysis_id', '==', analysisId);
  if (kasanKey) q = q.where('kasan_key', '==', kasanKey);
  q = q.orderBy('decided_at', 'desc');
  const snap = await q.get();
  return snap.docs.map((d) => {
    const dd = d.data();
    return {
      ...dd,
      decided_at: dd.decided_at?.toDate?.() ? dd.decided_at.toDate().toISOString() : dd.decided_at,
    };
  });
}

export async function logAudit({ uid, eventType, detail }) {
  const db = getDb();
  if (!db) return;
  try {
    await db.collection(COLLECTION_AUDIT).add({
      uid,
      event_type: eventType,
      at: new Date(),
      detail: detail || null,
    });
  } catch (err) {
    console.warn(`[audit] write failed: ${err.message}`);
  }
}

function serializeJob(d) {
  const perKasanStatus = {};
  for (const [k, v] of Object.entries(d.per_kasan_status || {})) {
    perKasanStatus[k] = {
      ...v,
      decided_at: v?.decided_at?.toDate?.() ? v.decided_at.toDate().toISOString() : v?.decided_at || null,
    };
  }
  return {
    analysis_id: d.analysis_id,
    uid: d.uid,
    ownerEmail: d.ownerEmail,
    created_at: d.created_at?.toDate?.() ? d.created_at.toDate().toISOString() : d.created_at,
    last_reviewed_at: d.last_reviewed_at?.toDate?.() ? d.last_reviewed_at.toDate().toISOString() : d.last_reviewed_at,
    source_type: d.source_type,
    review_status: d.review_status,
    service: d.service,
    office: d.office,
    facility_id: d.facility_id,
    service_month: d.service_month,
    kasan_count: d.kasan_count,
    summary_counts: d.summary_counts,
    mapping_warnings: d.mapping_warnings,
    per_kasan_status: perKasanStatus,
  };
}
