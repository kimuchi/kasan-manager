// ユーザーごとの再利用プロフィール（施設情報・従業員名簿）。
//
// 目的（ゴール: 従業員情報などは以前の情報を流用できる・編集できる）:
//   - 施設プロフィール（事業所名・地域区分・サービス種別）を保存して次回流用
//   - 従業員名簿を保存して編集・流用。ただし保存時に必ず匿名化（氏名は持たない）
//
// すべて getDb()（Firestore or ローカルストア）に保存。所有者 uid でアクセス制御。

import { randomUUID } from 'node:crypto';

import { getDb } from './firebase-admin.js';
import { anonymizeStaffRoster, scrubString, assertStorageSafe } from './anonymize.js';

const COLLECTION_FACILITIES = 'facility_profiles';
const COLLECTION_ROSTERS = 'staff_rosters';

function ts(t) {
  return t?.toDate?.() ? t.toDate().toISOString() : t || null;
}

// ---- 施設プロフィール ----

export async function listFacilities(uid) {
  const db = getDb();
  if (!db) return [];
  const snap = await db.collection(COLLECTION_FACILITIES).where('uid', '==', uid).limit(100).get();
  return snap.docs.map((d) => serializeFacility(d.data())).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getFacility(uid, id) {
  const db = getDb();
  if (!db) return null;
  const snap = await db.collection(COLLECTION_FACILITIES).doc(id).get();
  if (!snap.exists || snap.data().uid !== uid) return null;
  return serializeFacility(snap.data());
}

export async function saveFacility(uid, input = {}) {
  const db = getDb();
  if (!db) throw new Error('store_unavailable');
  const now = new Date();
  const id = input.id && typeof input.id === 'string' ? input.id : randomUUID();
  let createdAt = now;
  if (input.id) {
    const existing = await getFacility(uid, id);
    if (!existing) throw new Error('not_found');
    createdAt = existing.createdAt || now;
  }
  const doc = {
    id,
    uid,
    name: input.name ? scrubString(String(input.name)).slice(0, 120) : null,
    officeCode: input.officeCode ? String(input.officeCode).replace(/[^0-9A-Za-z-]/g, '').slice(0, 20) : null,
    serviceKey: input.serviceKey ? String(input.serviceKey).slice(0, 60) : null,
    regionGrade: input.regionGrade ? String(input.regionGrade).slice(0, 20) : null,
    note: input.note ? scrubString(String(input.note)).slice(0, 500) : null,
    createdAt,
    updatedAt: now,
  };
  assertStorageSafe(doc);
  await db.collection(COLLECTION_FACILITIES).doc(id).set(doc);
  return serializeFacility(doc);
}

export async function deleteFacility(uid, id) {
  const db = getDb();
  if (!db) return false;
  const existing = await getFacility(uid, id);
  if (!existing) return false;
  await db.collection(COLLECTION_FACILITIES).doc(id).delete();
  return true;
}

function serializeFacility(d) {
  return {
    id: d.id,
    name: d.name || null,
    officeCode: d.officeCode || null,
    serviceKey: d.serviceKey || null,
    regionGrade: d.regionGrade || null,
    note: d.note || null,
    createdAt: ts(d.createdAt),
    updatedAt: ts(d.updatedAt),
  };
}

// ---- 従業員名簿（匿名化して保存） ----

export async function listStaffRosters(uid) {
  const db = getDb();
  if (!db) return [];
  const snap = await db.collection(COLLECTION_ROSTERS).where('uid', '==', uid).limit(100).get();
  return snap.docs.map((d) => serializeRoster(d.data())).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getStaffRoster(uid, id) {
  const db = getDb();
  if (!db) return null;
  const snap = await db.collection(COLLECTION_ROSTERS).doc(id).get();
  if (!snap.exists || snap.data().uid !== uid) return null;
  return serializeRoster(snap.data());
}

// input: { id?, label?, facilityId?, serviceKey?, entries: [...個人単位（氏名含むかもしれない）] }
// → 匿名化集計に変換して保存（氏名は保持しない）。
export async function saveStaffRoster(uid, input = {}) {
  const db = getDb();
  if (!db) throw new Error('store_unavailable');
  const now = new Date();
  const id = input.id && typeof input.id === 'string' ? input.id : randomUUID();
  let createdAt = now;
  if (input.id) {
    const existing = await getStaffRoster(uid, id);
    if (!existing) throw new Error('not_found');
    createdAt = existing.createdAt || now;
  }
  const anonymized = anonymizeStaffRoster(input.entries || []);
  const doc = {
    id,
    uid,
    label: input.label ? scrubString(String(input.label)).slice(0, 80) : '従業員名簿',
    facilityId: input.facilityId ? String(input.facilityId).slice(0, 64) : null,
    serviceKey: input.serviceKey ? String(input.serviceKey).slice(0, 60) : null,
    ...anonymized,
    createdAt,
    updatedAt: now,
  };
  assertStorageSafe(doc); // 氏名・PII が残っていないか最終チェック
  await db.collection(COLLECTION_ROSTERS).doc(id).set(doc);
  return serializeRoster(doc);
}

export async function deleteStaffRoster(uid, id) {
  const db = getDb();
  if (!db) return false;
  const existing = await getStaffRoster(uid, id);
  if (!existing) return false;
  await db.collection(COLLECTION_ROSTERS).doc(id).delete();
  return true;
}

function serializeRoster(d) {
  return {
    id: d.id,
    label: d.label || null,
    facilityId: d.facilityId || null,
    serviceKey: d.serviceKey || null,
    headcount: d.headcount ?? (d.entries || []).length,
    joukinCount: d.joukinCount ?? null,
    qualifiedPersonCountByProfession: d.qualifiedPersonCountByProfession || {},
    fteByProfession: d.fteByProfession || {},
    entries: d.entries || [],
    createdAt: ts(d.createdAt),
    updatedAt: ts(d.updatedAt),
  };
}

// 保存済み従業員名簿 → judge エンジンが使う staffSummary 形へ。
export function rosterToStaffSummary(roster) {
  if (!roster) return null;
  return {
    qualifiedPersonCountByProfession: roster.qualifiedPersonCountByProfession || {},
    fteByProfession: roster.fteByProfession || {},
    hasExternalPtOtSt: false,
  };
}
