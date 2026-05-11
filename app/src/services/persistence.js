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

import { getFirestoreClient, getStorageBucket } from './firebase-admin.js';

const COLLECTION_JOBS = 'analysis_jobs';
const COLLECTION_REVIEWS = 'review_decisions';
const COLLECTION_AUDIT = 'audit_logs';

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
  const db = getFirestoreClient();
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

  if (bucket) {
    try {
      const base = `analyses/${uid}/${analysisId}`;
      await bucket.file(`${base}/result.json`).save(JSON.stringify(judgeResult, null, 2), {
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
  }

  await logAudit({ uid, eventType: 'analysis_persisted', detail: { analysisId, sourceType } });
  return { persisted: true };
}

export async function listAnalysisJobsForUser(uid, { limit = 50 } = {}) {
  const db = getFirestoreClient();
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
  const db = getFirestoreClient();
  if (!db) return null;
  const snap = await db.collection(COLLECTION_JOBS).doc(analysisId).get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (!isAdmin && d.uid !== uid) return null;
  return serializeJob(d);
}

export async function loadAnalysisArtifact({ analysisId, uid, kind = 'result' }) {
  const bucket = getStorageBucket();
  if (!bucket) return null;
  const base = `analyses/${uid}/${analysisId}`;
  const path = kind === 'report' ? `${base}/report.md` : `${base}/result.json`;
  const [buf] = await bucket.file(path).download().catch(() => [null]);
  return buf ? buf.toString('utf-8') : null;
}

// レビュー判断の記録。review_status と紐づけて履歴を残す。
export async function recordReviewDecision({ analysisId, kasanKey, decision, comment, reviewerUid, reviewerEmail }) {
  const db = getFirestoreClient();
  if (!db) throw new Error('firestore_unavailable');
  if (!['approved', 'returned', 'awaiting_review'].includes(decision)) {
    throw new Error('invalid_decision');
  }
  const ref = db.collection(COLLECTION_REVIEWS).doc();
  await ref.set({
    analysis_id: analysisId,
    kasan_key: kasanKey || null,
    decision,
    comment: comment || null,
    reviewer_uid: reviewerUid,
    reviewer_email: reviewerEmail || null,
    decided_at: new Date(),
  });
  // analysis_jobs.review_status を最新に
  await db
    .collection(COLLECTION_JOBS)
    .doc(analysisId)
    .update({ review_status: decision, last_reviewed_at: new Date() });
  await logAudit({
    uid: reviewerUid,
    eventType: 'review_decision',
    detail: { analysisId, kasanKey, decision },
  });
  return { ok: true };
}

export async function listReviewDecisions({ analysisId }) {
  const db = getFirestoreClient();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTION_REVIEWS)
    .where('analysis_id', '==', analysisId)
    .orderBy('decided_at', 'desc')
    .get();
  return snap.docs.map((d) => {
    const dd = d.data();
    return {
      ...dd,
      decided_at: dd.decided_at?.toDate?.() ? dd.decided_at.toDate().toISOString() : dd.decided_at,
    };
  });
}

export async function logAudit({ uid, eventType, detail }) {
  const db = getFirestoreClient();
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
    kasan_count: d.kasan_count,
    summary_counts: d.summary_counts,
    mapping_warnings: d.mapping_warnings,
  };
}
