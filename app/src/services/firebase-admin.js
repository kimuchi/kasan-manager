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

import { getLocalStore } from './local-store.js';

let initialized = false;
let lastInitError = null;

// Firebase / Firestore を実際に使える構成か（プロジェクト ID か資格情報が揃っているか）。
// これが false の環境では Firestore クライアントを作らず、ローカルストアにフォールバックする。
// （資格情報なしで initializeApp すると、利用時に「Unable to detect a Project Id」で落ちるため）
export function isFirebaseConfigured() {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      process.env.GCP_PROJECT_ID ||
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
  );
}

export function initFirebase() {
  if (initialized) return true;
  if (getApps().length > 0) {
    initialized = true;
    return true;
  }
  if (!isFirebaseConfigured()) {
    // 未設定環境（ローカル開発 / CI / 自前ホスティング）: ローカルストアで動作させる
    return false;
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

// 永続化レイヤの統一エントリポイント。
// Firestore が使えればそれを、無ければローカルストア（Firestore 互換サブセット）を返す。
// これにより、ユーザー/プラン/プロフィール/履歴は Firebase 未設定でも保存・テストできる。
// 本番で Firestore を設定している場合は従来どおり Firestore を返す（挙動不変）。
export function getDb() {
  const fs = getFirestoreClient();
  if (fs) return fs;
  return getLocalStore();
}

// 永続化が「ローカルストア」で動いているか（health 表示・診断用）
export function isUsingLocalStore() {
  return !getFirestoreClient() && Boolean(getLocalStore());
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
