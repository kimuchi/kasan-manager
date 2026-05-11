// アクセスコード（Firestore `access_codes/{code}`）の発行・redeem・失効。
//
// レコード形:
//   {
//     code: string,                 // 表示用（=ドキュメントID）
//     durationDays: number,         // redeem 時に planExpiresAt を延長する日数
//     issuedAt: Timestamp,
//     issuedBy: string,             // 管理者 uid
//     issuedByEmail: string|null,
//     note: string|null,            // 発行メモ（誰向け／何プランか）
//     status: 'issued' | 'redeemed' | 'revoked',
//     redeemedByUid: string|null,
//     redeemedByEmail: string|null,
//     redeemedAt: Timestamp|null,
//     revokedAt: Timestamp|null,
//     revokedBy: string|null,
//   }

import { randomBytes } from 'node:crypto';
import { getFirestoreClient } from './firebase-admin.js';
import { extendPaidPeriod } from './users.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい I/O/0/1 を除外

function generateCode(parts = 4, segLen = 4) {
  const segs = [];
  for (let i = 0; i < parts; i += 1) {
    let s = '';
    const bytes = randomBytes(segLen);
    for (let j = 0; j < segLen; j += 1) {
      s += CODE_ALPHABET[bytes[j] % CODE_ALPHABET.length];
    }
    segs.push(s);
  }
  return segs.join('-');
}

export async function issueAccessCode({ durationDays, note, issuedBy, issuedByEmail }) {
  const db = getFirestoreClient();
  if (!db) throw new Error('firestore_unavailable');
  if (!Number.isFinite(durationDays) || durationDays <= 0) throw new Error('invalid_duration');
  // 衝突回避: 最大 5 回 retry
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    const ref = db.collection('access_codes').doc(code);
    const snap = await ref.get();
    if (snap.exists) continue;
    const doc = {
      code,
      durationDays,
      issuedAt: new Date(),
      issuedBy,
      issuedByEmail: issuedByEmail || null,
      note: note || null,
      status: 'issued',
      redeemedByUid: null,
      redeemedByEmail: null,
      redeemedAt: null,
      revokedAt: null,
      revokedBy: null,
    };
    await ref.set(doc);
    return serializeCode(doc);
  }
  throw new Error('code_generation_failed');
}

export async function listAccessCodes({ limit = 100 } = {}) {
  const db = getFirestoreClient();
  if (!db) throw new Error('firestore_unavailable');
  const snap = await db.collection('access_codes').orderBy('issuedAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => serializeCode(d.data()));
}

export async function revokeAccessCode(code, { revokedBy }) {
  const db = getFirestoreClient();
  if (!db) throw new Error('firestore_unavailable');
  const ref = db.collection('access_codes').doc(code);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('code_not_found');
  const data = snap.data();
  if (data.status === 'redeemed') throw new Error('already_redeemed');
  if (data.status === 'revoked') return serializeCode(data);
  await ref.update({
    status: 'revoked',
    revokedAt: new Date(),
    revokedBy,
  });
  const updated = (await ref.get()).data();
  return serializeCode(updated);
}

export async function redeemAccessCode(code, { uid, email }) {
  const db = getFirestoreClient();
  if (!db) throw new Error('firestore_unavailable');
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) throw new Error('empty_code');
  const ref = db.collection('access_codes').doc(normalized);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('code_not_found');
    const data = snap.data();
    if (data.status === 'revoked') throw new Error('code_revoked');
    if (data.status === 'redeemed') throw new Error('code_already_redeemed');
    tx.update(ref, {
      status: 'redeemed',
      redeemedByUid: uid,
      redeemedByEmail: email || null,
      redeemedAt: new Date(),
    });
    return data.durationDays;
  });
  const planUpdate = await extendPaidPeriod(uid, result, normalized);
  return { code: normalized, durationDays: result, planExpiresAt: planUpdate.planExpiresAt };
}

function serializeCode(d) {
  const ts = (t) => (t?.toDate?.() ? t.toDate().toISOString() : t || null);
  return {
    code: d.code,
    durationDays: d.durationDays,
    status: d.status,
    issuedAt: ts(d.issuedAt),
    issuedBy: d.issuedBy,
    issuedByEmail: d.issuedByEmail,
    note: d.note,
    redeemedByUid: d.redeemedByUid,
    redeemedByEmail: d.redeemedByEmail,
    redeemedAt: ts(d.redeemedAt),
    revokedAt: ts(d.revokedAt),
    revokedBy: d.revokedBy,
  };
}
