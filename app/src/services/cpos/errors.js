// CPOS API 呼び出しで発生するエラーの型。
// 指示書 §15.1 のメッセージに合わせて、ユーザに見せやすい日本語メッセージを保持する。

export class CposApiError extends Error {
  constructor(statusCode, message, { responseJson = null, requestPath = null, hint = null } = {}) {
    super(message);
    this.name = 'CposApiError';
    this.statusCode = statusCode;
    this.responseJson = responseJson;
    this.requestPath = requestPath;
    this.hint = hint;
  }

  toJSON() {
    return {
      error: 'cpos_api_error',
      status_code: this.statusCode,
      message: this.message,
      hint: this.hint,
      request_path: this.requestPath,
    };
  }
}

export class CposNotConfiguredError extends Error {
  constructor() {
    super(
      'CPOS 接続が設定されていません。.env に CPOS_BASE_URL と CPOS_API_TOKEN を設定してください。',
    );
    this.name = 'CposNotConfiguredError';
  }
}

export const CPOS_HTTP_HINTS = {
  401: 'CPOS にログインしてください（または CPOS_API_TOKEN を確認してください）。',
  403: 'この事業所または機能へのアクセス権限がありません。CPOS 管理者にスコープと事業所アクセスを確認してください。',
  404: '指定された事業所またはデータが見つかりません。事業所IDと対象月を確認してください。',
  409: '既存データと競合しています。重複ポリシーを選択してください。',
  422: '入力データを保存できません。CPOS から返された警告内容を確認してください。',
  429: 'CPOS 側でレート制限に達しました。しばらく時間をおいて再試行してください。',
  500: 'CPOS 側でエラーが発生しました。時間をおいて再実行するか、CPOS 管理者に確認してください。',
  502: 'CPOS のゲートウェイがエラーを返しました。CPOS の稼働状態を確認してください。',
  503: 'CPOS が一時的に利用できません。',
  504: 'CPOS への接続がタイムアウトしました。',
};
