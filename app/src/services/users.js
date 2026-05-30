// ユーザー（Firestore `users/{uid}`）の lookup / create / plan 判定。
//
// レコード形:
//   {
//     uid: string,
//     email: string,
//     emailVerified: boolean,
//     displayName: string|null,
//     createdAt: Timestamp,
//     lastLoginAt: Timestamp,
//     planTier: 'free' | 'paid',
//     planExpiresAt: Timestamp|null,    // paid 期間の終了時刻。past だと free 扱い。
//     redeemedCodes: string[],          // 過去 redeem したアクセスコードの履歴
//   }
//
// 管理者判定:
//   - KASAN_ADMIN_EMAILS （カンマ区切り）に email が含まれていれば admin
//   - 該当しない場合、Firestore レコード上の isAdmin フィールドも見る（運用余地）

import { getDb } from './firebase-admin.js';

function adminEmailSet() {
  const raw = process.env.KASAN_ADMIN_EMAILS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(email) {
  if (!email) return false;
  return adminEmailSet().has(String(email).toLowerCase());
}

function evalPlanTier(doc) {
  const tier = doc?.planTier || 'free';
  const exp = doc?.planExpiresAt;
  if (tier === 'paid' && exp) {
    const expMs = typeof exp.toMillis === 'function' ? exp.toMillis() : new Date(exp).getTime();
    if (Number.isFinite(expMs) && expMs > Date.now()) {
      return { planTier: 'paid', planExpiresAt: new Date(expMs).toISOString() };
    }
    // 期限切れ
    return { planTier: 'free', planExpiresAt: null };
  }
  return { planTier: 'free', planExpiresAt: null };
}

export async function ensureUser({ uid, email, emailVerified, displayName }) {
  const db = getDb();
  if (!db) return null;
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  const now = new Date();
  if (!snap.exists) {
    const doc = {
      uid,
      email: email || null,
      emailLower: email ? String(email).toLowerCase() : null,
      emailVerified: Boolean(emailVerified),
      displayName: displayName || null,
      authProvider: 'firebase',
      createdAt: now,
      lastLoginAt: now,
      planTier: 'free',
      planExpiresAt: null,
      redeemedCodes: [],
    };
    await ref.set(doc);
    return doc;
  }
  const update = { lastLoginAt: now };
  if (email && snap.data().email !== email) update.email = email;
  if (typeof emailVerified === 'boolean' && snap.data().emailVerified !== emailVerified) {
    update.emailVerified = emailVerified;
  }
  if (displayName && snap.data().displayName !== displayName) update.displayName = displayName;
  await ref.update(update);
  return { ...snap.data(), ...update };
}

export async function getUserSummary(uid) {
  const db = getDb();
  if (!db) return { planTier: 'free', planExpiresAt: null };
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return { planTier: 'free', planExpiresAt: null };
  return evalPlanTier(snap.data());
}

export async function getUserFullView(uid) {
  const db = getDb();
  if (!db) return null;
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return null;
  const d = snap.data();
  const plan = evalPlanTier(d);
  return {
    uid: d.uid,
    email: d.email,
    emailVerified: d.emailVerified,
    displayName: d.displayName,
    createdAt: d.createdAt?.toDate?.() ? d.createdAt.toDate().toISOString() : d.createdAt,
    lastLoginAt: d.lastLoginAt?.toDate?.() ? d.lastLoginAt.toDate().toISOString() : d.lastLoginAt,
    planTier: plan.planTier,
    planExpiresAt: plan.planExpiresAt,
    redeemedCodes: d.redeemedCodes || [],
  };
}

// アクセスコード redeem に伴う plan 更新。
// 既存の planExpiresAt が未来なら延長、過去なら現在からスタート。
export async function extendPaidPeriod(uid, addDays, codeId) {
  const db = getDb();
  if (!db) throw new Error('firestore_unavailable');
  const ref = db.collection('users').doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('user_not_found');
    const data = snap.data();
    const now = Date.now();
    const currentExp = data.planExpiresAt
      ? typeof data.planExpiresAt.toMillis === 'function'
        ? data.planExpiresAt.toMillis()
        : new Date(data.planExpiresAt).getTime()
      : 0;
    const base = currentExp > now ? currentExp : now;
    const newExp = new Date(base + addDays * 24 * 60 * 60 * 1000);
    const codes = Array.from(new Set([...(data.redeemedCodes || []), codeId]));
    tx.update(ref, {
      planTier: 'paid',
      planExpiresAt: newExp,
      redeemedCodes: codes,
    });
    return { planExpiresAt: newExp.toISOString() };
  });
}

// ============================================================
// ネイティブ（ユーザー名/パスワード）アカウント
// ============================================================

// email から既存ユーザーを 1 件返す（無ければ null）。ネイティブログイン・重複登録防止に使用。
export async function findUserByEmail(email) {
  const db = getDb();
  if (!db || !email) return null;
  const lower = String(email).toLowerCase();
  const snap = await db.collection('users').where('emailLower', '==', lower).limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].data();
}

// ネイティブアカウントを作成（passwordHash は呼び出し側で生成済み）。
// email 重複時は throw。
export async function createLocalUser({ uid, email, displayName, passwordHash }) {
  const db = getDb();
  if (!db) throw new Error('store_unavailable');
  const existing = await findUserByEmail(email);
  if (existing) throw new Error('email_taken');
  const now = new Date();
  const doc = {
    uid,
    email: email || null,
    emailLower: email ? String(email).toLowerCase() : null,
    emailVerified: false,
    displayName: displayName || null,
    authProvider: 'local',
    passwordHash,
    createdAt: now,
    lastLoginAt: now,
    planTier: 'free',
    planExpiresAt: null,
    redeemedCodes: [],
  };
  await db.collection('users').doc(uid).set(doc);
  return doc;
}

// 生のユーザーレコード（passwordHash を含む）。認証内部用途のみ。
export async function getUserRecord(uid) {
  const db = getDb();
  if (!db) return null;
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

export async function touchLastLogin(uid) {
  const db = getDb();
  if (!db) return;
  try {
    await db.collection('users').doc(uid).update({ lastLoginAt: new Date() });
  } catch {
    /* noop */
  }
}

// ============================================================
// 管理者: 有料ユーザー管理
// ============================================================

function publicUserView(d) {
  const plan = evalPlanTier(d);
  const ts = (t) => (t?.toDate?.() ? t.toDate().toISOString() : t || null);
  return {
    uid: d.uid,
    email: d.email,
    displayName: d.displayName || null,
    authProvider: d.authProvider || 'firebase',
    emailVerified: Boolean(d.emailVerified),
    planTier: plan.planTier,
    planExpiresAt: plan.planExpiresAt,
    rawPlanTier: d.planTier || 'free',
    createdAt: ts(d.createdAt),
    lastLoginAt: ts(d.lastLoginAt),
    redeemedCodesCount: (d.redeemedCodes || []).length,
    isAdmin: isAdminEmail(d.email) || d.isAdmin === true,
  };
}

export async function listUsers({ limit = 200 } = {}) {
  const db = getDb();
  if (!db) return [];
  const snap = await db.collection('users').orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((doc) => publicUserView(doc.data()));
}

// 管理者によるプラン手動操作。
//   action: 'grant'  → 現在（または既存期限）から days 日付与し paid に
//           'extend' → grant と同じ（既存期限が未来なら延長）
//           'revoke' → 即時 free（planExpiresAt=null）
export async function adminSetPlan(uid, { action, days }) {
  const db = getDb();
  if (!db) throw new Error('store_unavailable');
  const ref = db.collection('users').doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('user_not_found');
    const data = snap.data();
    if (action === 'revoke') {
      tx.update(ref, { planTier: 'free', planExpiresAt: null });
      return { planTier: 'free', planExpiresAt: null };
    }
    const addDays = Number(days);
    if (!Number.isFinite(addDays) || addDays <= 0) throw new Error('invalid_duration');
    const now = Date.now();
    const currentExp = data.planExpiresAt
      ? typeof data.planExpiresAt.toMillis === 'function'
        ? data.planExpiresAt.toMillis()
        : new Date(data.planExpiresAt).getTime()
      : 0;
    const base = currentExp > now ? currentExp : now;
    const newExp = new Date(base + addDays * 24 * 60 * 60 * 1000);
    tx.update(ref, { planTier: 'paid', planExpiresAt: newExp });
    return { planTier: 'paid', planExpiresAt: newExp.toISOString() };
  });
}
