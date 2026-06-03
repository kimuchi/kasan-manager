// 管理者メール判定（KASAN_ADMIN_EMAILS のカンマ区切り）。
// CPOS の role==='admin' に加え、運用上の override として残す小ユーティリティ。

export function isAdminEmail(email) {
  if (!email) return false;
  const raw = process.env.KASAN_ADMIN_EMAILS || '';
  const set = new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return set.has(String(email).toLowerCase());
}
