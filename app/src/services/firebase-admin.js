// Firebase Admin SDK の初期化。
//
// 優先順位:
//   1. FIREBASE_SERVICE_ACCOUNT_JSON （Secret Manager から hydrate された生 JSON 文字列）
//   2. Application Default Credentials (Cloud Run 上ではサービスアカウントが自動付与される)
//
// Firestore / Auth / Storage のクライアントは遅延ロード。

import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

let initialized = false;
let lastInitError = null;

export function initFirebase() {
  if (initialized) return true;
  if (getApps().length > 0) {
    initialized = true;
    return true;
  }
  try {
    const projectId = process.env.GCP_PROJECT_ID || process.env.GCLOUD_PROJECT || null;
    const storageBucket = process.env.KASAN_GCS_BUCKET || null;
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (saJson) {
      const parsed = JSON.parse(saJson);
      initializeApp({
        credential: cert(parsed),
        projectId: projectId || parsed.project_id,
        storageBucket,
      });
    } else {
      initializeApp({
        credential: applicationDefault(),
        projectId,
        storageBucket,
      });
    }
    initialized = true;
    return true;
  } catch (err) {
    lastInitError = err;
    console.warn(`[firebase-admin] init 失敗: ${err.message}（無料モードのみで動作します）`);
    return false;
  }
}

export function isFirebaseInitialized() {
  return initialized;
}

export function firebaseInitError() {
  return lastInitError;
}

export function getAuthClient() {
  if (!initFirebase()) return null;
  return getAuth();
}

export function getFirestoreClient() {
  if (!initFirebase()) return null;
  return getFirestore();
}

export function getStorageBucket() {
  if (!initFirebase()) return null;
  const name = process.env.KASAN_GCS_BUCKET;
  if (!name) return null;
  try {
    return getStorage().bucket(name);
  } catch (err) {
    console.warn(`[firebase-admin] storage bucket 取得失敗: ${err.message}`);
    return null;
  }
}
