// CPOS アプリ実行コンテキスト（s2s 用 App Token + クライアント）。
//
// 加算マネージャは CPOS の App Platform にアプリ（appId=kasan）として登録される前提。
// 管理コンソール /app-tokens で発行された App Token（cpos_pat_…）を、
// **サーバ側 env (or Secret Manager)** に保持し、CPOS の `app-data:kasan:*` 等を呼ぶ。
//
// 関連 env:
//   - KASAN_CPOS_APP_TOKEN        App Token 平文（または Secret Manager 経由で hydrate）
//   - KASAN_CPOS_APP_CLIENT_ID    （任意）CPOS 側のアプリ識別。ログでの突合用
//   - KASAN_DEFAULT_CPOS_BASE_URL CPOS ベース URL（既存）
//
// テストではクライアントを差し替える: import { _setAppCposClient } from './app-context.js'

import { CposClient, defaultBaseUrl } from './client.js';

export const APP_ID = 'kasan';

let cached = null;

export function isAppCposConfigured() {
  return Boolean((process.env.KASAN_CPOS_APP_TOKEN || '').trim()) && Boolean(defaultBaseUrl());
}

// 本物の CPOS への HTTP クライアント。設定が無ければ null（呼び出し側で 503 を返す）。
export function getAppCposClient() {
  if (cached) return cached;
  if (!isAppCposConfigured()) return null;
  cached = new CposClient({ baseUrl: defaultBaseUrl(), token: process.env.KASAN_CPOS_APP_TOKEN });
  return cached;
}

// テスト用: フェイクを直接注入。production 経路では使わない。
export function _setAppCposClient(client) {
  cached = client;
}
export function _resetAppCposClient() {
  cached = null;
}

// ヘルスチェック・診断用
export function appCposStatus() {
  return {
    appId: APP_ID,
    configured: isAppCposConfigured(),
    baseUrl: defaultBaseUrl(),
    clientId: process.env.KASAN_CPOS_APP_CLIENT_ID || null,
  };
}
